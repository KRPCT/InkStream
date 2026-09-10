import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { createFileTreeOps } from '../components/workbench/fileTreeOps';
import { readFile, renamePath, movePath, trashPath, writeFileAtomic } from '../ipc/files';
import { consumeSuppressedWatch, resetAutosave, flushAutosave } from '../stores/autosave';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useToastStore } from '../stores/useToastStore';
import { useConfirmStore } from '../stores/useConfirmStore';
import { useVaultStore } from '../stores/useVaultStore';
import { makeTestView } from '../test/composition';
import { __clearCacheForTest, getDocForPath, switchToTab } from './editorState';
import { serializeDocumentTransition } from './documentTransitions';
import { openFileByPath } from './fileOpenFlow';
import { setView } from './viewHandle';

// All document state and autosave collaboration is real; only OS-facing adapters use an in-memory disk.
vi.mock('../ipc/files', async (original) => ({
  ...await original<typeof import('../ipc/files')>(),
  readFile: vi.fn(), renamePath: vi.fn(), movePath: vi.fn(), trashPath: vi.fn(), writeFileAtomic: vi.fn(),
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
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useVaultStore.getState().openVault({ root: '/v', repoRoot: null, name: 'v' }, []);
  useSettingsStore.setState({ autosaveEnabled: false, simpleMode: true });
  disk = new Map();
  vi.mocked(readFile).mockReset().mockImplementation(async (_root, path) => {
    if (!disk.has(path)) throw new Error('missing');
    return disk.get(path)!;
  });
  const relocate = async (_root: string, from: string, to: string) => {
    if (disk.has(to)) throw new Error('target exists');
    const entries = [...disk].filter(([path]) => path === from || path.startsWith(`${from}/`));
    if (!entries.length) throw new Error('source missing');
    for (const [path, content] of entries) { disk.delete(path); disk.set(to + path.slice(from.length), content); }
    return null;
  };
  vi.mocked(renamePath).mockReset().mockImplementation(relocate);
  vi.mocked(movePath).mockReset().mockImplementation(relocate);
  vi.mocked(trashPath).mockReset().mockImplementation(async (_root, from) => {
    for (const path of disk.keys()) if (path === from || path.startsWith(`${from}/`)) disk.delete(path);
    return null;
  });
  vi.mocked(writeFileAtomic).mockReset().mockImplementation(async (_root, path, content) => {
    disk.set(path, content);
    return null;
  });
  view = makeTestView();
  setView(view);
});

afterEach(() => {
  useConfirmStore.getState().request?.resolve(false);
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
  setView(null);
  view.destroy();
  resetAutosave();
  __clearCacheForTest();
  useSettingsStore.setState({ autosaveEnabled: true, simpleMode: false });
});

async function editFile(path: string, content: string, addition: string): Promise<string> {
  disk.set(path, content);
  await openFileByPath(path);
  view.dispatch({ changes: { from: view.state.doc.length, insert: addition } });
  return view.state.doc.toString();
}

describe('文件树修改与打开文档的身份迁移', () => {
  it('重命名后活动身份、显示名、缓存和未保存正文一致，后续只写新路径', async () => {
    const latest = await editFile('章节/初稿.md', '# 初稿\n', '尚未保存的中文正文。');
    const cursor = view.state.selection.main.head;

    await createFileTreeOps().rename({ id: '章节/初稿.md', name: '初稿.md', isDir: false }, '终稿.md');

    expect(useEditorStore.getState().activePath).toBe('章节/终稿.md');
    expect(useEditorStore.getState().tabs).toContainEqual({ path: '章节/终稿.md', name: '终稿.md', external: false });
    expect(getDocForPath('章节/终稿.md')).toBe(latest);
    expect(getDocForPath('章节/初稿.md')).toBeNull();
    expect(useEditorStore.getState().dirty['章节/终稿.md']).toBe(true);
    expect(view.state.selection.main.head).toBe(cursor);
    expect(await flushAutosave('章节/终稿.md')).toMatchObject({ kind: 'saved' });
    expect(disk.get('章节/终稿.md')).toBe(latest);
    expect(disk.has('章节/初稿.md')).toBe(false);
  });

  it('删除打开的脏文档后保留最新正文为明确标记的草稿，旧路径不被保存复活', async () => {
    const latest = await editFile('待删除.md', '# 原文\n', '不能丢失的未保存内容。');
    useEditorStore.getState().freezeAutosave('待删除.md');
    useEditorStore.getState().markExternalChange('待删除.md');
    const pending = createFileTreeOps().remove({ id: '待删除.md', name: '待删除.md', isDir: false });
    useConfirmStore.getState().request?.resolve(true);

    await pending;

    const draft = useEditorStore.getState().activePath!;
    expect(draft).toMatch(/^draft:\/\//);
    expect(getDocForPath(draft)).toBe(latest);
    expect(getDocForPath('待删除.md')).toBeNull();
    expect(view.state.doc.toString()).toBe(latest);
    expect(useEditorStore.getState().tabs.find((tab) => tab.path === draft)?.name).toContain('草稿');
    expect(useEditorStore.getState().dirty[draft]).toBe(true);
    expect(useEditorStore.getState().frozen[draft]).toBeFalsy();
    expect(useEditorStore.getState().externalChanged[draft]).toBeFalsy();
    expect(await flushAutosave(draft)).toMatchObject({ kind: 'blocked', reason: 'draft' });
    expect(disk.has('待删除.md')).toBe(false);
    expect(useToastStore.getState().toasts.some((toast) => toast.message.includes('草稿'))).toBe(true);
  });

  it('父目录移动及撤销迁移全部子文档，前缀相似的其它目录不受影响', async () => {
    const a = await editFile('chapter/a.md', '# A\n', '未保存 A');
    const b = await editFile('chapter/nested/b.py', 'value = 1\n', 'value += 2\n');
    const other = await editFile('chapter-two/c.md', '# C\n', '其它目录');
    await createFileTreeOps().move({ id: 'chapter', name: 'chapter', isDir: true }, 'archive');

    expect(getDocForPath('archive/chapter/a.md')).toBe(a);
    expect(getDocForPath('archive/chapter/nested/b.py')).toBe(b);
    expect(getDocForPath('chapter/a.md')).toBeNull();
    expect(getDocForPath('chapter-two/c.md')).toBe(other);
    expect(useEditorStore.getState().activePath).toBe('chapter-two/c.md');
    await switchToTab('archive/chapter/nested/b.py');
    expect(view.state.doc.toString()).toBe(b);

    const undo = useToastStore.getState().toasts.find((toast) => toast.message.includes('已移动到'))?.action;
    expect(undo).toBeDefined();
    undo!();
    await vi.waitFor(() => expect(useEditorStore.getState().activePath).toBe('chapter/nested/b.py'));
    expect(getDocForPath('chapter/a.md')).toBe(a);
    expect(getDocForPath('archive/chapter/a.md')).toBeNull();
    expect(useEditorStore.getState().tabs.map((tab) => tab.name)).toEqual(['a.md', 'b.py', 'c.md']);
  });

  it('先排空旧路径的在途保存，再迁移等待期间继续编辑的最新正文', async () => {
    await editFile('waiting.md', 'A', 'B');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(writeFileAtomic).mockImplementationOnce(async (_root, path, content) => {
      await gate;
      disk.set(path, content);
      return null;
    });
    const saving = flushAutosave('waiting.md');
    await vi.waitFor(() => expect(writeFileAtomic).toHaveBeenCalledTimes(1));
    const moving = createFileTreeOps().rename({ id: 'waiting.md', name: 'waiting.md', isDir: false }, 'moved.md');
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(renamePath).not.toHaveBeenCalled();
      expect(disk.has('waiting.md')).toBe(true);
      view.dispatch({ changes: { from: view.state.doc.length, insert: 'C' } });
    } finally {
      release();
      await Promise.all([saving, moving]);
    }
    expect(getDocForPath('moved.md')).toBe('ABC');
    expect(useEditorStore.getState().dirty['moved.md']).toBe(true);
    expect(await flushAutosave('moved.md')).toMatchObject({ kind: 'saved' });
    expect(disk.get('moved.md')).toBe('ABC');
    expect(disk.has('waiting.md')).toBe(false);
  });

  it('磁盘重命名失败保留身份和缓冲，并恢复后续保存与真实外部事件', async () => {
    const latest = await editFile('original.md', '原文', '待保存');
    disk.set('occupied.md', '不能覆盖');
    const result = await createFileTreeOps().rename({ id: 'original.md', name: 'original.md', isDir: false }, 'occupied.md');
    expect(result.conflict).toBe(true);
    expect(useEditorStore.getState().activePath).toBe('original.md');
    expect(getDocForPath('original.md')).toBe(latest);
    expect(consumeSuppressedWatch('original.md')).toBe(false);
    expect(await flushAutosave('original.md')).toMatchObject({ kind: 'saved' });
    expect(disk.get('occupied.md')).toBe('不能覆盖');
  });

  it('等待其它文档transition期间切库后，旧文件树操作不会改到新工作区', async () => {
    await editFile('same.md', 'A 库', '的未保存内容');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const switching = serializeDocumentTransition(async () => {
      await gate;
      useVaultStore.getState().openVault({ root: '/b', repoRoot: null, name: 'b' }, []);
    });
    const renaming = createFileTreeOps().rename({ id: 'same.md', name: 'same.md', isDir: false }, 'new.md');
    release();
    await Promise.all([switching, renaming]);
    expect(renamePath).not.toHaveBeenCalled();
    expect(disk.has('same.md')).toBe(true);
    expect(disk.has('new.md')).toBe(false);
  });
});
