import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { createFile, readFile } from '../../ipc/files';
import { useConfirmStore } from '../../stores/useConfirmStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useToastStore } from '../../stores/useToastStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { makeTestView } from '../../test/composition';
import { __clearCacheForTest } from '../editorState';
import { openFileByPath } from '../fileOpenFlow';
import { setView } from '../viewHandle';
import { handleLinkMousedown } from './linkGesture';

// Only the filesystem boundary is replaced; gestures, stores, opening and CM states are real.
vi.mock('../../ipc/files', async (original) => ({
  ...await original<typeof import('../../ipc/files')>(),
  readFile: vi.fn(),
  createFile: vi.fn(),
}));
vi.mock('../../ipc/vault', async (original) => ({
  ...await original<typeof import('../../ipc/vault')>(),
  listDir: vi.fn(async () => []),
  listFiles: vi.fn(async () => [...disk.keys()].map((path) => ({ path, name: path.split('/').pop()! }))),
}));

let view: EditorView;
let disk: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  __clearCacheForTest();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useSettingsStore.setState({ autosaveEnabled: false });
  useVaultStore.getState().openVault({ root: '/v', repoRoot: null, name: 'v' }, []);
  disk = new Map();
  vi.mocked(readFile).mockReset().mockImplementation(async (root, path) => {
    if (root !== '/v' || !disk.has(path)) throw new Error('missing file');
    return disk.get(path)!;
  });
  vi.mocked(createFile).mockReset().mockImplementation(async (_root, path) => {
    if (disk.has(path)) throw new Error('already exists');
    disk.set(path, '');
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
  __clearCacheForTest();
  vi.clearAllTimers();
  vi.useRealTimers();
  useSettingsStore.setState({ autosaveEnabled: true });
});

async function openSource(source: string, targets: Record<string, string>): Promise<void> {
  disk.set('source.md', source);
  for (const [path, content] of Object.entries(targets)) disk.set(path, content);
  useVaultStore.getState().setFiles([...disk.keys()].map((path) => ({
    path, name: path.split('/').pop()!,
  })));
  await openFileByPath('source.md');
  await vi.advanceTimersByTimeAsync(40);
}

async function clickWiki(): Promise<void> {
  const pos = view.state.doc.toString().indexOf('[[') + 3;
  Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => pos });
  const event = new MouseEvent('mousedown', { ctrlKey: true, cancelable: true });
  expect(handleLinkMousedown(event, view)).toBe(true);
  await vi.advanceTimersByTimeAsync(80);
}

describe('Wiki 点击导航到真实文档位置', () => {
  it('打开确定路径后定位正文标题，不命中代码围栏中的同名示例', async () => {
    const target = '```md\n## 研究方法\n```\n\n前言。\n\n## 研究方法\n正文。';
    await openSource('[[笔记/目标#研究方法|方法]]', { '笔记/目标.md': target });

    await clickWiki();

    expect(useEditorStore.getState().activePath).toBe('笔记/目标.md');
    expect(view.state.doc.toString()).toBe(target);
    expect(view.state.selection.main.head).toBe(target.lastIndexOf('## 研究方法'));
  });

  it('块链接把光标放到所引段落开头，Unicode 块标识可定位', async () => {
    const target = '# 目标页\n\n前文。\n\n被引用的段落 ^关键证据\n\n尾声。';
    await openSource('[[目标#^关键证据]]', { '目标.md': target });

    await clickWiki();

    expect(useEditorStore.getState().activePath).toBe('目标.md');
    expect(view.state.selection.main.head).toBe(target.indexOf('被引用的段落'));
  });

  it('当前文档的标题链接直接定位，保留原文并兼容 Unicode 规范等价', async () => {
    const source = '[[#Cafe\u0301 研究]]\n\n## Café 研究\n内容。';
    await openSource(source, {});

    await clickWiki();

    expect(useEditorStore.getState().activePath).toBe('source.md');
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.head).toBe(source.indexOf('## Café 研究'));
  });

  it('标题不存在时明确提示，不把打开文件误报为精确定位成功', async () => {
    await openSource('[[目标#不存在的标题]]', { '目标.md': '# 另一个标题\n内容。' });

    await clickWiki();

    expect(useEditorStore.getState().activePath).toBe('目标.md');
    expect(useToastStore.getState().toasts.some((toast) => toast.message.includes('未找到标题'))).toBe(true);
    expect(createFile).not.toHaveBeenCalled();
  });

  it('目标已经打开时基于未保存正文定位，不用磁盘旧版覆盖编辑缓冲', async () => {
    await openSource('[[目标#新增标题]]', { '目标.md': '# 原标题\n' });
    await openFileByPath('目标.md');
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n## 新增标题\n未保存内容。' } });
    const latest = view.state.doc.toString();
    await openFileByPath('source.md');

    await clickWiki();

    expect(view.state.doc.toString()).toBe(latest);
    expect(view.state.selection.main.head).toBe(latest.indexOf('## 新增标题'));
    expect(useEditorStore.getState().dirty['目标.md']).toBe(true);
  });

  it('裸名有歧义时不打开第一个文件，也不当作缺失文件创建', async () => {
    await openSource('[[重复]]', { '甲/重复.md': '# 甲', '乙/重复.md': '# 乙' });

    await clickWiki();

    expect(useEditorStore.getState().activePath).toBe('source.md');
    expect(useToastStore.getState().toasts.some((toast) => toast.message.includes('多个同名目标'))).toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
    expect(createFile).not.toHaveBeenCalled();
  });

  it('不存在的文件先提示创建，取消不写文件也不离开原文档', async () => {
    await openSource('[[尚未存在]]', {});

    await clickWiki();

    expect(useConfirmStore.getState().request?.confirmLabel).toBe('创建并打开');
    expect(createFile).not.toHaveBeenCalled();
    useConfirmStore.getState().request?.resolve(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(disk.has('尚未存在.md')).toBe(false);
    expect(useEditorStore.getState().activePath).toBe('source.md');
    expect(view.state.doc.toString()).toBe('[[尚未存在]]');
  });

  it('确认创建后才写入并打开新文件，来源文档保持原文', async () => {
    await openSource('[[新文稿]]', {});
    await clickWiki();
    useConfirmStore.getState().request?.resolve(true);
    await vi.advanceTimersByTimeAsync(80);

    expect(disk.get('新文稿.md')).toBe('');
    expect(useEditorStore.getState().activePath).toBe('新文稿.md');
    expect(view.state.doc.toString()).toBe('');
    expect(disk.get('source.md')).toBe('[[新文稿]]');
  });
});
