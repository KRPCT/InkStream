import { history } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doPaste, doRedo, doSelectAll, doUndo } from './editCommands';
import { useEditorStore } from '../stores/useEditorStore';
import { setView } from './viewHandle';

const mockReadText = vi.mocked(readText);
/** isMarkdownFamily() === (activeRenderMode !== null)：true=markdown 家族文档，null=代码文件。 */
function setMarkdownFamily(on: boolean): void {
  useEditorStore.setState({ activeRenderMode: on ? 'source' : null });
}

let view: EditorView;

function mount(doc: string): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [history()] }),
  });
  setView(view);
  return view;
}

beforeEach(() => setView(null));
afterEach(() => {
  setView(null);
  view?.destroy();
});

describe('编辑命令经 getView 派发到单内核', () => {
  it('全选选中整篇文档', () => {
    mount('hello world');
    doSelectAll();
    const r = view.state.selection.main;
    expect(r.from).toBe(0);
    expect(r.to).toBe('hello world'.length);
  });

  it('撤销/重做走 CM6 history', () => {
    mount('a');
    view.dispatch({ changes: { from: 1, insert: 'b' } });
    expect(view.state.doc.toString()).toBe('ab');
    doUndo();
    expect(view.state.doc.toString()).toBe('a');
    doRedo();
    expect(view.state.doc.toString()).toBe('ab');
  });

  it('无活动 view：命令静默 no-op（不抛错）', () => {
    setView(null);
    expect(() => {
      doSelectAll();
      doUndo();
      doRedo();
    }).not.toThrow();
  });
});

describe('右键菜单粘贴读系统剪贴板（v1.2.1）', () => {
  beforeEach(() => {
    mockReadText.mockReset();
    setMarkdownFamily(true);
  });
  afterEach(() => useEditorStore.setState(useEditorStore.getInitialState(), true));

  it('把系统剪贴板文本插入到光标处（替换选区）', async () => {
    mount('ab');
    view.dispatch({ selection: EditorSelection.cursor(2) });
    mockReadText.mockResolvedValue('外部文本');
    await doPaste();
    expect(view.state.doc.toString()).toBe('ab外部文本');
  });

  it('剪贴板为空：no-op，不改文档', async () => {
    mount('ab');
    mockReadText.mockResolvedValue('');
    await doPaste();
    expect(view.state.doc.toString()).toBe('ab');
  });

  it('markdown 家族文档：http(s) URL + 选区 → 包成 Markdown 链接（与 Ctrl+V 一致）', async () => {
    setMarkdownFamily(true);
    mount('标题');
    view.dispatch({ selection: EditorSelection.range(0, 2) });
    mockReadText.mockResolvedValue('https://example.com');
    await doPaste();
    expect(view.state.doc.toString()).toBe('[标题](https://example.com)');
  });

  it('代码文件（非 markdown 家族）：URL + 选区 → 纯文本替换，不注入链接语法', async () => {
    setMarkdownFamily(false);
    mount('code');
    view.dispatch({ selection: EditorSelection.range(0, 4) });
    mockReadText.mockResolvedValue('https://example.com');
    await doPaste();
    expect(view.state.doc.toString()).toBe('https://example.com');
  });

  it('无活动 view：粘贴静默 no-op（不抛错）', async () => {
    setView(null);
    mockReadText.mockResolvedValue('x');
    await expect(doPaste()).resolves.toBeUndefined();
  });
});

describe('全选不预设光标位置（默认起点 0）', () => {
  it('从空选区起也覆盖全文', () => {
    mount('xyz');
    view.dispatch({ selection: EditorSelection.cursor(1) });
    doSelectAll();
    expect(view.state.selection.main.to).toBe(3);
  });
});
