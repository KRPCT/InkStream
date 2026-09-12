import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { readFile, writeFileAtomic } from '../ipc/files';
import { resetAutosave, flushAutosave } from '../stores/autosave';
import { useEditorStore } from '../stores/useEditorStore';
import { useGitStore } from '../stores/useGitStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useToastStore } from '../stores/useToastStore';
import { useVaultStore } from '../stores/useVaultStore';
import { makeTestView } from '../test/composition';
import { __clearCacheForTest, getDocForPath, switchToTab } from './editorState';
import { serializeDocumentTransition } from './documentTransitions';
import { openFileByPath } from './fileOpenFlow';
import { captureGitWorktreeScope, runGitWorktreeMutation } from './gitWorktreeMutation';
import { setView } from './viewHandle';

vi.mock('../ipc/files', async (original) => ({
  ...await original<typeof import('../ipc/files')>(), readFile: vi.fn(), writeFileAtomic: vi.fn(),
}));
vi.mock('../ipc/events', () => ({ startWatch: vi.fn().mockResolvedValue(null), stopWatch: vi.fn().mockResolvedValue(null) }));
vi.mock('../ipc/git', () => ({
  gitStatus: vi.fn().mockResolvedValue({ branch: 'topic', files: [] }), gitBranchList: vi.fn().mockResolvedValue([]),
  gitLog: vi.fn().mockResolvedValue([]), gitRefs: vi.fn().mockResolvedValue([]),
}));
vi.mock('../ipc/indexService', async (original) => ({
  ...await original<typeof import('../ipc/indexService')>(),
  indexUpsertDoc: vi.fn().mockResolvedValue(null), indexRefreshFile: vi.fn().mockResolvedValue(null), indexRebuild: vi.fn().mockResolvedValue(null),
  pauseIndexSession: vi.fn().mockResolvedValue(async () => {}),
}));
vi.mock('../ipc/vault', async (original) => ({
  ...await original<typeof import('../ipc/vault')>(),
  listDir: vi.fn(async () => []),
  listFiles: vi.fn(async () => [...disk.keys()].map((path) => ({ path, name: path.split('/').pop()! }))),
}));

let view: EditorView;
let disk: Map<string, string>;

beforeEach(() => {
  resetAutosave();
  __clearCacheForTest();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState({ vault: { root: '/repo', repoRoot: '/repo', name: 'repo' }, tree: [], files: [] });
  useGitStore.setState({ repoRoot: '/repo', status: null, branches: [] });
  useSettingsStore.setState({ autosaveEnabled: false, simpleMode: false });
  disk = new Map();
  vi.mocked(readFile).mockReset().mockImplementation(async (_root, path) => {
    if (!disk.has(path)) throw new Error('missing');
    return disk.get(path)!;
  });
  vi.mocked(writeFileAtomic).mockReset().mockImplementation(async (_root, path, content) => {
    disk.set(path, content);
    return null;
  });
  view = makeTestView();
  setView(view);
});

afterEach(() => {
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
  setView(null);
  view.destroy();
  resetAutosave();
  __clearCacheForTest();
  useSettingsStore.setState({ autosaveEnabled: true, simpleMode: false });
});

async function open(path: string, body: string): Promise<void> {
  disk.set(path, body);
  await openFileByPath(path);
}

describe('Git worktree writes and document authority', () => {
  it('save failure keeps the dirty authoritative buffer and never invokes Git', async () => {
    await open('a.md', 'before');
    view.dispatch({ changes: { from: 6, insert: ' unsaved' } });
    const body = view.state.doc.toString();
    vi.mocked(writeFileAtomic).mockRejectedValue(new Error('permission denied'));
    const write = vi.fn().mockResolvedValue({ outcome: 'completed' });
    await runGitWorktreeMutation(captureGitWorktreeScope()!, write);
    expect(write).not.toHaveBeenCalled();
    expect(useEditorStore.getState().activePath).toBe('a.md');
    expect(getDocForPath('a.md')).toBe(body);
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    expect(disk.get('a.md')).toBe('before');
  });

  it('a newer edit during save prevents the Git operation', async () => {
    await open('a.md', 'A');
    view.dispatch({ changes: { from: 1, insert: ' first' } });
    let saved!: () => void;
    vi.mocked(writeFileAtomic).mockImplementation((_root, path, content) => new Promise((resolve) => {
      saved = () => { disk.set(path, content); resolve(null); };
    }));
    const write = vi.fn().mockResolvedValue({ outcome: 'completed' });
    const pending = runGitWorktreeMutation(captureGitWorktreeScope()!, write);
    await vi.waitFor(() => expect(saved).toBeTypeOf('function'));
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' newer' } });
    saved();
    await pending;
    expect(write).not.toHaveBeenCalled();
    expect(getDocForPath('a.md')).toBe('A first newer');
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
  });

  it('a queued A request cannot acquire B after a prior workspace transition', async () => {
    const scope = captureGitWorktreeScope()!;
    let release!: () => void;
    const previous = serializeDocumentTransition(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      useVaultStore.setState({ vault: { root: '/other', repoRoot: '/other', name: 'other' } });
      useGitStore.setState({ repoRoot: '/other' });
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const write = vi.fn().mockResolvedValue({ outcome: 'completed' });
    const pending = runGitWorktreeMutation(scope, write);
    release();
    await previous;
    await pending;
    expect(write).not.toHaveBeenCalled();
    expect(useVaultStore.getState().vault?.root).toBe('/other');
  });

  it('a tree rewrite refreshes active and background documents before future saves', async () => {
    await open('b.md', 'old B');
    await open('a.md', 'old A');
    await runGitWorktreeMutation(captureGitWorktreeScope()!, async () => {
      disk.set('a.md', 'rebased A');
      disk.set('b.md', 'rebased B');
      return { outcome: 'completed' };
    });
    expect(getDocForPath('a.md')).toBe('rebased A');
    await switchToTab('b.md');
    expect(getDocForPath('b.md')).toBe('rebased B');
    expect(await flushAutosave('b.md')).toMatchObject({ kind: 'saved' });
    expect(disk.get('b.md')).toBe('rebased B');
  });

  it('edits made while Git is pending remain recoverable after its abort result', async () => {
    await open('a.md', 'original A');
    let finish!: () => void;
    const pending = runGitWorktreeMutation(captureGitWorktreeScope()!, () => new Promise((resolve) => {
      finish = () => { disk.set('a.md', 'restored Git A'); resolve({ outcome: 'aborted' }); };
    }), { preserveDirty: true });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' newly typed' } });
    const body = view.state.doc.toString();
    finish();
    await pending;
    expect(getDocForPath('a.md')).toBe(body);
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    expect(useEditorStore.getState().frozen['a.md']).toBe(true);
    expect(await flushAutosave('a.md')).toMatchObject({ kind: 'blocked', reason: 'conflict' });
    expect(disk.get('a.md')).toBe('restored Git A');
  });

  it('resolving one conflict file keeps unrelated dirty writing available', async () => {
    await open('a.md', 'conflict A');
    await open('b.md', 'original B');
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' unsaved B' } });
    await runGitWorktreeMutation(captureGitWorktreeScope()!, async () => { disk.set('a.md', 'resolved A'); }, { paths: ['a.md'], preserveDirty: true });
    expect(getDocForPath('b.md')).toBe('original B unsaved B');
    expect(useEditorStore.getState().dirty['b.md']).toBe(true);
    expect(useEditorStore.getState().frozen['b.md']).not.toBe(true);
    expect(useEditorStore.getState().externalChanged['b.md']).not.toBe(true);
    expect(disk.get('b.md')).toBe('original B');
  });

  it('a failed stage preserves the accepted frozen buffer after a partial disk write', async () => {
    await open('a.md', 'visible conflict A');
    useEditorStore.getState().markDirty('a.md');
    useEditorStore.getState().freezeAutosave('a.md');
    const accepted = new Map([['a.md', getDocForPath('a.md')!]]);
    await expect(runGitWorktreeMutation(captureGitWorktreeScope()!, async () => {
      disk.set('a.md', 'resolved on disk');
      throw new Error('git add failed');
    }, { paths: ['a.md'], preserveDirty: true, acceptedBuffers: accepted })).rejects.toThrow('git add failed');
    expect(getDocForPath('a.md')).toBe('visible conflict A');
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    expect(useEditorStore.getState().frozen['a.md']).toBe(true);
    expect(disk.get('a.md')).toBe('resolved on disk');
  });
});
