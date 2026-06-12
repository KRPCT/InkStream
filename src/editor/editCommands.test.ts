import { history } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { doRedo, doSelectAll, doUndo } from './editCommands';
import { setView } from './viewHandle';

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

describe('全选不预设光标位置（默认起点 0）', () => {
  it('从空选区起也覆盖全文', () => {
    mount('xyz');
    view.dispatch({ selection: EditorSelection.cursor(1) });
    doSelectAll();
    expect(view.state.selection.main.to).toBe(3);
  });
});
