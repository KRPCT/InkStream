/**
 * Document session acceptance regression: issues #2 and #3.
 * Real EditorTabs, EditorView, EditorState cache, Zustand stores and autosave.
 * Only filesystem I/O is replaced. Assertions describe required correct behavior;
 * only filesystem I/O is simulated. No files are written by these tests.
 */
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditorTabs from '../components/workbench/EditorTabs';
import ExternalChangeBar from '../components/workbench/ExternalChangeBar';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { saveDraftAs } from '../editor/draftFlow';
import { openFileByPath } from '../editor/fileOpenFlow';
import { pickSavePath } from '../ipc/dialog';
import { __clearCacheForTest, getDocForPath, openFile, snapshotBeforeSwitch, switchToTab } from '../editor/editorState';
import { arbitrateVaultChange } from '../editor/externalChange';
import { baseExtensions } from '../editor/extensions';
import { setView } from '../editor/viewHandle';
import { readFile, writeFileAtomic, writeFileToPath } from '../ipc/files';
import { flushAutosave, resetAutosave } from '../stores/autosave';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useToastStore } from '../stores/useToastStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';

vi.mock('../ipc/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ipc/files')>()),
  writeFileAtomic: vi.fn().mockResolvedValue(null),
  writeFileToPath: vi.fn().mockResolvedValue(null),
  readFile: vi.fn().mockResolvedValue('From disk'),
}));
vi.mock('../ipc/dialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ipc/dialog')>()),
  pickSavePath: vi.fn().mockResolvedValue('/audit-vault/new.md'),
}));

let view: EditorView;
let mount: HTMLDivElement;

function activate(path: string, content: string): void {
  const previous = useEditorStore.getState().activePath;
  if (previous) snapshotBeforeSwitch(view, previous);
  openFile(view, path, content, baseExtensions());
  useEditorStore.getState().openTab({ path, name: path });
  useEditorStore.getState().setActive(path);
}

async function closeThroughUi(path: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`close-tab-${path}`));
    // Drain the actual fulfilled/rejected write chain and close continuation.
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writeFileAtomic).mockResolvedValue(null);
  resetAutosave();
  __clearCacheForTest();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  // Disable scheduled writes and indexing: this test exercises explicit tab-close writes.
  useSettingsStore.setState({ autosaveEnabled: false, simpleMode: true });
  useToastStore.setState({ toasts: [] });
  useVaultStore.setState({ vault: { root: '/audit-vault', repoRoot: null, name: 'audit' } });
  mount = document.createElement('div');
  document.body.appendChild(mount);
  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: baseExtensions() }),
    parent: mount,
  });
  setView(view);
});

afterEach(() => {
  cleanup();
  resetAutosave();
  view.destroy();
  setView(null);
  mount.remove();
  __clearCacheForTest();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

describe('document session integrity', () => {
  it('a newer navigation cancels an unfinished file transfer and preserves its own active body', async () => {
    activate('current.md', 'Current');
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    vi.mocked(readFile).mockImplementationOnce((_root, _path, options) => {
      signal = options?.signal;
      return new Promise((resolve) => { finish = () => resolve('Late body'); });
    });
    const opening = openFileByPath('slow.md');
    await switchToTab('current.md');
    finish();
    await opening;
    expect(signal?.aborted).toBe(true);
    expect(useEditorStore.getState().activePath).toBe('current.md');
    expect(view.state.doc.toString()).toBe('Current');
  });
  it('FE-01: closing active A must activate B content before B can be saved', async () => {
    activate('b.md', 'B original body');
    activate('a.md', 'A distinct body');
    render(<EditorTabs />);

    await closeThroughUi('a.md');

    expect(useEditorStore.getState().activePath).toBe('b.md');
    expect.soft(view.state.doc.toString()).toBe('B original body');
    expect.soft(getDocForPath('b.md')).toBe('B original body');

    await act(async () => { await flushAutosave('b.md'); });
    expect.soft(writeFileAtomic).toHaveBeenLastCalledWith('/audit-vault', 'b.md', 'B original body');
  });

  it('FE-02: a failed close-save must preserve the dirty background A buffer and tab', async () => {
    activate('a.md', 'A original');
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' UNSAVED' } });
    activate('b.md', 'B untouched');
    render(<EditorTabs />);
    vi.mocked(writeFileAtomic).mockRejectedValue(new Error('AUDIT simulated permission denied'));

    await closeThroughUi('a.md');

    expect(writeFileAtomic).toHaveBeenCalledWith('/audit-vault', 'a.md', 'A original UNSAVED');
    expect.soft(getDocForPath('a.md')).toBe('A original UNSAVED');
    expect.soft(useEditorStore.getState().tabs.some((tab) => tab.path === 'a.md')).toBe(true);
    expect.soft(useEditorStore.getState().dirty['a.md']).toBe(true);
    expect(view.state.doc.toString()).toBe('B untouched');
  });

  it('a failed explicit conflict overwrite keeps the conflict and the unsaved buffer', async () => {
    activate('a.md', 'Mine');
    useEditorStore.getState().markDirty('a.md');
    useEditorStore.getState().freezeAutosave('a.md');
    useEditorStore.getState().markExternalChange('a.md');
    render(<><ExternalChangeBar /><ConfirmDialog /></>);
    fireEvent.click(screen.getByRole('button', { name: '保留我的（覆盖磁盘）' }));
    vi.mocked(writeFileAtomic).mockRejectedValue(new Error('permission denied'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '覆盖磁盘' })); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(useEditorStore.getState().frozen['a.md']).toBe(true);
    expect(view.state.doc.toString()).toBe('Mine');
  });

  it('a successful older write leaves edits made while saving dirty', async () => {
    activate('a.md', 'v1');
    useEditorStore.getState().markDirty('a.md');
    let complete!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    vi.mocked(writeFileAtomic).mockImplementationOnce(() => new Promise((resolve) => { complete = () => resolve(null); signalStarted(); }));
    const saving = flushAutosave('a.md');
    await started;
    view.dispatch({ changes: { from: 0, to: 2, insert: 'v2' } });
    complete();
    expect((await saving).kind).toBe('changed');
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    expect(view.state.doc.toString()).toBe('v2');
    await flushAutosave('a.md');
    expect(useEditorStore.getState().dirty['a.md']).toBe(false);
  });

  it('a clean background document reloads external content before activation and saving', async () => {
    activate('a.md', 'Old disk text');
    activate('b.md', 'Other document');
    vi.mocked(readFile).mockResolvedValue('External replacement');
    await arbitrateVaultChange({ path: '/audit-vault/a.md', kind: 'modify' });
    await switchToTab('a.md');
    expect(view.state.doc.toString()).toBe('External replacement');
    await flushAutosave('a.md');
    expect(writeFileAtomic).toHaveBeenLastCalledWith('/audit-vault', 'a.md', 'External replacement');
  });

  it('Save As retains edits made while the chosen file is being written', async () => {
    activate('draft://save', 'Draft');
    useEditorStore.getState().markDirty('draft://save');
    vi.mocked(pickSavePath).mockResolvedValue('/audit-vault/new.md');
    vi.mocked(readFile).mockResolvedValue('Draft');
    let complete!: () => void;
    vi.mocked(writeFileToPath).mockImplementationOnce(() => new Promise((resolve) => { complete = () => resolve(null); }));
    const saving = saveDraftAs('draft://save');
    await Promise.resolve();
    view.dispatch({ changes: { from: 5, insert: ' plus new edits' } });
    complete();
    await saving;
    expect(view.state.doc.toString()).toBe('Draft plus new edits');
    expect(useEditorStore.getState().activePath).toBe('new.md');
    expect(useEditorStore.getState().dirty['new.md']).toBe(true);
  });

  it('Save As cannot replace another target buffer opened while the disk write is in flight', async () => {
    activate('draft://save', 'Draft to save');
    vi.mocked(pickSavePath).mockResolvedValue('/audit-vault/new.md');
    let complete!: () => void;
    vi.mocked(writeFileToPath).mockImplementationOnce(() => new Promise((resolve) => { complete = () => resolve(null); }));
    const saving = saveDraftAs('draft://save');
    await Promise.resolve();
    activate('new.md', 'Target with newer edits');
    useEditorStore.getState().markDirty('new.md');
    complete();
    await saving;
    expect(useEditorStore.getState().tabs.filter((tab) => tab.path === 'new.md')).toHaveLength(1);
    expect(getDocForPath('draft://save')).toBe('Draft to save');
    expect(getDocForPath('new.md')).toBe('Target with newer edits');
    expect(useEditorStore.getState().dirty['new.md']).toBe(true);
  });
});
