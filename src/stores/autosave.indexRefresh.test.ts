import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';

const ipc = vi.hoisted(() => vi.fn<(command: string, args?: unknown) => Promise<unknown>>());
vi.mock('../ipc/invoke', () => ({ invoke: ipc, invokeStreamed: vi.fn() }));
vi.mock('../ipc/files', async (original) => ({
  ...await original<typeof import('../ipc/files')>(), readFile: vi.fn(), writeFileAtomic: vi.fn(),
}));
vi.mock('../ipc/vault', async (original) => ({
  ...await original<typeof import('../ipc/vault')>(), listDir: vi.fn(async () => []), listFiles: vi.fn(async () => []),
}));

import { readFile, writeFileAtomic } from '../ipc/files';
import { captureIndexScope, indexSwitchVault } from '../ipc/indexService';
import { __clearCacheForTest } from '../editor/editorState';
import { arbitrateVaultChange } from '../editor/externalChange';
import { openFileByPath } from '../editor/fileOpenFlow';
import { setView } from '../editor/viewHandle';
import { resetWordCount } from '../editor/wordCount';
import { makeTestView } from '../test/composition';
import { flushAutosave, resetAutosave, writeProjectFile } from './autosave';
import { useEditorStore } from './useEditorStore';
import { useIndexStore } from './useIndexStore';
import { useGitStore } from './useGitStore';
import { useSettingsStore } from './useSettingsStore';
import { useToastStore } from './useToastStore';
import { useVaultStore } from './useVaultStore';
import { nativeIndexReply } from '../test/indexLocationFixture';

let view: EditorView;
let disk: Map<string, string>;
let root: string;
let generation = 0;

function indexCalls() {
  return ipc.mock.calls.filter(([command]) => command === 'index_upsert_doc' || command === 'index_refresh_file');
}

async function expectPathOnly(path: string): Promise<void> {
  await vi.waitFor(() => expect(indexCalls()).toHaveLength(1));
  const [command, args] = indexCalls()[0];
  // Check the command name before payload assertions, so a RED run never prints a giant document.
  expect(command).toBe('index_refresh_file');
  expect(Object.keys(args as object).sort()).toEqual(['path', 'root', 'sessionId']);
  expect(args).toEqual({ ...captureIndexScope(), path });
  expect(JSON.stringify(args).length).toBeLessThan(4096);
}

beforeEach(async () => {
  resetAutosave();
  resetWordCount();
  __clearCacheForTest();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useIndexStore.setState(useIndexStore.getInitialState(), true);
  vi.spyOn(useGitStore.getState(), 'scheduleRefresh').mockImplementation(() => {});
  useSettingsStore.setState({ simpleMode: false, autosaveEnabled: false });
  root = `/index-refresh-${++generation}`;
  useVaultStore.setState({ vault: { root, name: root, repoRoot: null }, tree: [], files: [], expanded: new Set() });
  disk = new Map([['note.md', '原正文']]);
  ipc.mockReset().mockImplementation(async (command, args) => nativeIndexReply(command, args));
  vi.mocked(readFile).mockReset().mockImplementation(async (_root, path) => {
    if (!disk.has(path)) throw new Error('fixture file missing');
    return disk.get(path)!;
  });
  vi.mocked(writeFileAtomic).mockReset().mockImplementation(async (_root, path, content) => {
    disk.set(path, content);
    return null;
  });
  view = makeTestView();
  setView(view);
  await indexSwitchVault(root);
  ipc.mockClear();
});

afterEach(() => {
  resetAutosave();
  setView(null);
  view.destroy();
  __clearCacheForTest();
  resetWordCount();
  disk.clear();
  vi.restoreAllMocks();
  useSettingsStore.setState({ simpleMode: true, autosaveEnabled: true });
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
});

describe('落盘后的索引刷新不再把完整正文传回原生', () => {
  it('活动大文档先原子落盘，再只发送所属scope和路径', async () => {
    disk.set('note.md', '大文档正文\n'.repeat(180_000));
    await openFileByPath('note.md');
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'TAIL' }, userEvent: 'input.type' });
    let persisted = false;
    vi.mocked(writeFileAtomic).mockImplementation(async (_root, path, content) => {
      disk.set(path, content);
      persisted = true;
      return null;
    });
    ipc.mockImplementation(async (command, args) => {
      if (command === 'index_refresh_file' || command === 'index_upsert_doc') expect(persisted).toBe(true);
      return nativeIndexReply(command, args);
    });
    expect(await flushAutosave('note.md')).toMatchObject({ kind: 'saved' });
    expect(disk.get('note.md')?.endsWith('TAIL')).toBe(true);
    await expectPathOnly('note.md');
  });

  it('replace-all等未打开文件的直接持久化也只提交已落盘路径', async () => {
    const content = '尚未打开的正文\n'.repeat(100_000);
    expect(await writeProjectFile('unopened.md', content)).toBe(true);
    expect(disk.get('unopened.md')).toBe(content);
    await expectPathOnly('unopened.md');
  });

  it('已采纳的外部文件变更直接刷新原生索引，不做前端读取再JSON回传', async () => {
    disk.set('external.md', '新的磁盘正文');
    await arbitrateVaultChange({ path: `${root}/external.md`, kind: 'modify' });
    await vi.waitFor(() => expect(indexCalls()).toHaveLength(1));
    expect(readFile).not.toHaveBeenCalled();
    await expectPathOnly('external.md');
  });

  it('原子落盘失败不刷新索引且保留dirty', async () => {
    await openFileByPath('note.md');
    view.dispatch({ changes: { from: view.state.doc.length, insert: '未保存' }, userEvent: 'input.type' });
    vi.mocked(writeFileAtomic).mockRejectedValue(new Error('fixture write denied'));
    expect(await flushAutosave('note.md')).toMatchObject({ kind: 'failed' });
    expect(indexCalls()).toHaveLength(0);
    expect(useEditorStore.getState().dirty['note.md']).toBe(true);
    expect(disk.get('note.md')).toBe('原正文');
  });

  it('索引读盘或提交失败明确置error，不把成功文件保存回滚成失败', async () => {
    await openFileByPath('note.md');
    view.dispatch({ changes: { from: view.state.doc.length, insert: '已保存' }, userEvent: 'input.type' });
    ipc.mockImplementation(async (command, args) => {
      if (command === 'index_refresh_file' || command === 'index_upsert_doc') throw new Error('fixture index read failed');
      return nativeIndexReply(command, args);
    });
    expect(await flushAutosave('note.md')).toMatchObject({ kind: 'saved' });
    await vi.waitFor(() => expect(useIndexStore.getState().status).toBe('error'));
    expect(useIndexStore.getState().error).toContain('fixture index read failed');
    expect(disk.get('note.md')).toBe('原正文已保存');
  });

  it('等待文件保存时已切到B，迟到A刷新不能投给B或污染其索引状态', async () => {
    await openFileByPath('note.md');
    view.dispatch({ changes: { from: view.state.doc.length, insert: '属于A' }, userEvent: 'input.type' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(writeFileAtomic).mockImplementation(async (_root, path, content) => {
      await gate;
      disk.set(path, content);
      return null;
    });
    const saving = flushAutosave('note.md');
    await vi.waitFor(() => expect(writeFileAtomic).toHaveBeenCalledTimes(1));
    const otherRoot = `${root}-b`;
    useVaultStore.setState({ vault: { root: otherRoot, name: 'B', repoRoot: null }, tree: [], files: [] });
    await indexSwitchVault(otherRoot);
    ipc.mockClear();
    release();
    await saving;
    await Promise.resolve();
    await Promise.resolve();
    expect(indexCalls()).toHaveLength(0);
    expect(useIndexStore.getState().status).toBe('ready');
    expect(useIndexStore.getState().error).toBeNull();
  });
});
