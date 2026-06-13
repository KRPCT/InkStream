import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { __clearCacheForTest, openFile } from './editorState';
import { baseExtensions } from './extensions';
import { useEditorStore } from '../stores/useEditorStore';
import { scheduleAutosave } from '../stores/autosave';

vi.mock('../stores/autosave', () => ({ scheduleAutosave: vi.fn() }));

/**
 * P0 换装存活回归（PROD-RELAY-DESIGN §0）。
 *
 * 病灶：镜像 listener 原先只拼进 useCodeMirror 初始 EditorState，而 openFile/switchToTab/
 * reloadFromDisk 换装用裸 baseExtensions——updateListener 是 state 级 facet，第一次打开文件后
 * markDirty/scheduleAutosave/语言热切/richtext 镜像全部失联。修复 = mirrorListener 下沉
 * baseExtensions。本套锁：初始 state 镜像 + 一次/两次换装后镜像仍存活。
 */

function mountView(): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc: '', extensions: baseExtensions() }),
    parent,
  });
}

let view: EditorView | null = null;

beforeEach(() => {
  __clearCacheForTest();
  useEditorStore.setState({ tabs: [], activePath: null, dirty: {}, cursor: 0 });
  vi.mocked(scheduleAutosave).mockClear();
});

afterEach(() => {
  view?.destroy();
  view = null;
});

describe('mirrorListener（baseExtensions 内的 store 单向镜像）', () => {
  it('初始 state：docChanged → markDirty + scheduleAutosave + setCursor', () => {
    view = mountView();
    useEditorStore.setState({ activePath: 'a.md' });
    view.dispatch({ changes: { from: 0, insert: 'x' }, selection: { anchor: 1 } });
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    expect(scheduleAutosave).toHaveBeenCalledWith('a.md');
    expect(useEditorStore.getState().cursor).toBe(1);
  });

  it('P0：openFile 裸 baseExtensions 换装后 docChanged 仍 markDirty/scheduleAutosave', () => {
    view = mountView();
    openFile(view, 'a.md', 'hello', baseExtensions('markdown'));
    useEditorStore.setState({ activePath: 'a.md' });
    view.dispatch({ changes: { from: 5, insert: '!' } });
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    expect(scheduleAutosave).toHaveBeenCalledWith('a.md');
  });

  it('P0：连续两次换装（a→b）后镜像仍存活，且按各自 activePath 记账', () => {
    view = mountView();
    openFile(view, 'a.md', 'aaa', baseExtensions('markdown'));
    useEditorStore.setState({ activePath: 'a.md' });
    view.dispatch({ changes: { from: 0, insert: '1' } });
    openFile(view, 'b.md', 'bbb', baseExtensions('markdown'));
    useEditorStore.setState({ activePath: 'b.md' });
    view.dispatch({ changes: { from: 0, insert: '2' } });
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    expect(useEditorStore.getState().dirty['b.md']).toBe(true);
    expect(scheduleAutosave).toHaveBeenCalledWith('b.md');
  });

  it('换装后 selectionSet 仍镜像 cursor（setCursor 链路同存活）', () => {
    view = mountView();
    openFile(view, 'a.md', 'hello', baseExtensions('markdown'));
    view.dispatch({ selection: { anchor: 3 } });
    expect(useEditorStore.getState().cursor).toBe(3);
  });

  it('原生输入：换装后 contenteditable 落子（input.type 事务）仍 markDirty/scheduleAutosave', () => {
    view = mountView();
    openFile(view, 'r.md', '', baseExtensions('markdown'));
    useEditorStore.setState({ activePath: 'r.md' });
    // CM6 原生 contenteditable 落子等价于带 input.type userEvent 的事务（DOM observer → dispatch）。
    view.dispatch({ changes: { from: 0, insert: '中' }, userEvent: 'input.type' });
    expect(useEditorStore.getState().dirty['r.md']).toBe(true);
    expect(scheduleAutosave).toHaveBeenCalledWith('r.md');
    expect(view.state.doc.toString()).toBe('中');
  });
});
