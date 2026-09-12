// Intended destination: src/editor/documentBudget.integration.test.tsx.
// Run serially with the repository's normal jsdom setup; native CPU/rAF verification is separate.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { language } from '@codemirror/language';
import { redo, undo } from '@codemirror/commands';
import { findNext, SearchQuery, setSearchQuery } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RenderModeIndicator from '../components/workbench/RenderModeIndicator';
import WordCountIndicator from '../components/workbench/WordCountIndicator';
import { readText } from '../ipc/clipboard';
import { readFile, writeFileAtomic } from '../ipc/files';
import { flushAutosave, resetAutosave } from '../stores/autosave';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useToastStore } from '../stores/useToastStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useWordCountStore } from '../stores/useWordCountStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { dispatchComposition, makeTestView, mockComposing } from '../test/composition';
import { __clearCacheForTest, switchToTab } from './editorState';
import { doPaste } from './editCommands';
import { openFileByPath } from './fileOpenFlow';
import { setView } from './viewHandle';
import { resetWordCount } from './wordCount';

// Only the OS boundary is replaced. The production open pipeline, CodeMirror, history,
// composition gate, derived-state listeners and save pipeline remain real.
vi.mock('../ipc/files', async (original) => ({
  ...await original<typeof import('../ipc/files')>(),
  readFile: vi.fn(), writeFileAtomic: vi.fn(),
}));
vi.mock('../ipc/clipboard', () => ({ readText: vi.fn() }));

const LIMIT = 1_000_000;
const TAIL = '\n\n终点😀TAIL_MARKER';
let view: EditorView;
let disk: Map<string, string>;

function mediumDocument(): string {
  const prefix = '# Budget fixture\n\n';
  const length = LIMIT + 1 - prefix.length - TAIL.length;
  const paragraph = '普通正文 English。\n\n';
  return prefix + paragraph.repeat(Math.floor(length / paragraph.length)) + 'x'.repeat(length % paragraph.length) + TAIL;
}

function document25MiB(): string {
  const prefix = '# Budget fixture\n\n';
  const line = '这是一段大文档测试正文，保留中文、English 和 emoji 😀。\n';
  const encoder = new TextEncoder();
  const remaining = 25 * 1024 * 1024 - encoder.encode(prefix + TAIL).byteLength;
  const lineBytes = encoder.encode(line).byteLength;
  return prefix + line.repeat(Math.floor(remaining / lineBytes)) + 'x'.repeat(remaining % lineBytes) + TAIL;
}

async function open(path: string, contents: string): Promise<void> {
  disk.set(path, contents);
  await act(async () => { await openFileByPath(path); });
  expect(useEditorStore.getState().activePath).toBe(path);
}

function expectTail(text: string = TAIL): void {
  expect(view.state.doc.sliceString(view.state.doc.length - text.length)).toBe(text);
}

beforeEach(() => {
  resetAutosave();
  resetWordCount();
  __clearCacheForTest();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useWordCountStore.setState(useWordCountStore.getInitialState(), true);
  useWorkbenchStore.setState({ mode: 'creative' });
  useSettingsStore.setState({ autosaveEnabled: false, simpleMode: false, dailyWordGoal: 1000 });
  useVaultStore.getState().openVault({ root: '/budget-vault', repoRoot: null, name: 'Budget fixture' }, []);
  disk = new Map();
  vi.mocked(readFile).mockReset().mockImplementation(async (_root, path) => {
    const text = disk.get(path);
    if (text === undefined) throw new Error(`Fixture missing: ${path}`);
    return text;
  });
  vi.mocked(writeFileAtomic).mockReset().mockImplementation(async (_root, path, content) => {
    disk.set(path, content);
    return null;
  });
  vi.mocked(readText).mockReset();
  view = makeTestView();
  setView(view);
});

afterEach(() => {
  cleanup();
  setView(null);
  view.destroy();
  resetAutosave();
  resetWordCount();
  __clearCacheForTest();
  vi.restoreAllMocks();
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
  disk.clear();
  useWorkbenchStore.setState({ mode: 'standard' });
  useSettingsStore.setState({ autosaveEnabled: true });
});

describe('大文档基础编辑与显式完整排版', () => {
  it('25MiB正文完整打开，尾部可搜索、中文输入可选择撤销重做并完整保存', async () => {
    const original = document25MiB();
    await open('large.md', original);
    // This checks the costly real language boundary, rather than a mirrored budget boolean.
    expect(view.state.facet(language)).toBeNull();
    expect(view.state.doc.length).toBe(original.length);
    expectTail();
    render(<RenderModeIndicator />);
    expect(screen.getByText(/大文档模式/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /启用完整排版.*可能较慢/ })).toBeInTheDocument();

    act(() => {
      view.dispatch({ selection: { anchor: 0 }, effects: setSearchQuery.of(new SearchQuery({ search: 'TAIL_MARKER' })) });
      expect(findNext(view)).toBe(true);
    });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('TAIL_MARKER');
    const addition = '\n中文输入😀';
    const end = view.state.doc.length;
    act(() => view.dispatch({ changes: { from: end, insert: addition }, selection: { anchor: end, head: end + addition.length }, userEvent: 'input.type' }));
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(addition);
    expect(useEditorStore.getState().dirty['large.md']).toBe(true);
    act(() => { expect(undo(view)).toBe(true); });
    expect(view.state.doc.length).toBe(original.length);
    expectTail();
    act(() => { expect(redo(view)).toBe(true); });
    expectTail(TAIL + addition);
    expect(view.state.facet(language)).toBeNull();
    expect(await flushAutosave('large.md')).toMatchObject({ kind: 'saved' });
    expect(disk.get('large.md')).toBe(original + addition);
  }, 20_000);

  it('跨1,000,000 UTF-16门限的真实粘贴事务在解析前切基础编辑，并保留undo/redo', async () => {
    const original = '短文\n';
    await open('paste.md', original);
    const parser = view.state.facet(language)?.parser;
    expect(parser).toBeDefined();
    const parse = vi.spyOn(parser!, 'startParse');
    const payload = mediumDocument();
    vi.mocked(readText).mockResolvedValue(payload);
    act(() => view.dispatch({ selection: { anchor: original.length } }));
    await act(async () => { await doPaste(); });
    expect(view.state.doc.length).toBe(original.length + payload.length);
    expectTail();
    expect(view.state.facet(language)).toBeNull();
    // The accepted paste must not first run the previous Markdown parser and only disable it later.
    expect(parse).not.toHaveBeenCalled();
    act(() => { expect(undo(view)).toBe(true); });
    expect(view.state.doc.toString()).toBe(original);
    act(() => { expect(redo(view)).toBe(true); });
    expect(view.state.doc.length).toBe(original.length + payload.length);
    expectTail();
    expect(view.state.facet(language)).toBeNull();
  }, 10_000);

  it('大文档与普通文档往返保留各自正文、选区和history，普通文档仍可实时排版', async () => {
    const large = mediumDocument();
    await open('large.md', large);
    expect(view.state.facet(language)).toBeNull();
    const addition = '\n保留的大文档修改';
    act(() => view.dispatch({ changes: { from: large.length, insert: addition }, selection: { anchor: large.length, head: large.length + addition.length }, userEvent: 'input.type' }));
    const selection = view.state.selection.main;
    await open('small.md', '# 普通标题\n\n**普通正文**');
    expect(view.state.facet(language)).not.toBeNull();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '小文档修改' }, userEvent: 'input.type' }));
    await act(async () => { await switchToTab('large.md'); });
    expect(view.state.facet(language)).toBeNull();
    expect(view.state.selection.main.eq(selection)).toBe(true);
    expectTail(TAIL + addition);
    act(() => { expect(undo(view)).toBe(true); });
    expectTail();
    await act(async () => { await switchToTab('small.md'); });
    expect(view.state.doc.toString()).toContain('小文档修改');
    act(() => { expect(undo(view)).toBe(true); });
    expect(view.state.doc.toString()).toBe('# 普通标题\n\n**普通正文**');
  }, 10_000);

  it('暂停统计不显示为真实0，用户可启用完整排版并按文档记住，再恢复基础编辑', async () => {
    const contents = mediumDocument();
    await open('override.md', contents);
    render(<><RenderModeIndicator /><WordCountIndicator /></>);
    expect(screen.getByTestId('word-count-indicator')).toHaveTextContent(/统计已暂停/);
    expect(screen.getByTestId('word-count-indicator')).not.toHaveTextContent('0/1000');
    const enable = screen.getByRole('button', { name: /启用完整排版.*可能较慢/ });
    act(() => { fireEvent.click(enable); });
    expect(view.state.facet(language)).not.toBeNull();
    expect(screen.getByRole('button', { name: /恢复基础编辑/ })).toBeInTheDocument();
    const addition = '\n显式完整排版中的修改';
    act(() => view.dispatch({ changes: { from: contents.length, insert: addition }, userEvent: 'input.type' }));
    await open('other.md', '# Another document');
    await act(async () => { await switchToTab('override.md'); });
    expect(view.state.facet(language)).not.toBeNull();
    expectTail(TAIL + addition);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /恢复基础编辑/ })); });
    expect(view.state.facet(language)).toBeNull();
    expect(screen.getByTestId('word-count-indicator')).toHaveTextContent(/统计已暂停/);
    act(() => { expect(undo(view)).toBe(true); });
    expectTail();
    expect(view.state.doc.length).toBe(contents.length);
  }, 15_000);

  it('组合期点击完整排版会等待组合结束，正文与选区始终保留', async () => {
    const contents = mediumDocument();
    await open('composition.md', contents);
    render(<RenderModeIndicator />);
    act(() => view.dispatch({ selection: { anchor: contents.length - TAIL.length, head: contents.length } }));
    const selection = view.state.selection.main;
    mockComposing(view, true);
    dispatchComposition(view, { phase: 'compositionstart', data: '中文' });
    try {
      act(() => { fireEvent.click(screen.getByRole('button', { name: /启用完整排版.*可能较慢/ })); });
      expect(view.state.facet(language)).toBeNull();
      expect(view.state.selection.main.eq(selection)).toBe(true);
      expectTail();
    } finally {
      mockComposing(view, false);
      await act(async () => {
        dispatchComposition(view, { phase: 'compositionend', data: '中文' });
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(view.state.facet(language)).not.toBeNull();
    expect(view.state.selection.main.eq(selection)).toBe(true);
    expectTail();
  }, 10_000);
});
