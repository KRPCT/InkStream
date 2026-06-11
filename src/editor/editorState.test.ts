import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { disposeState, openFile, snapshotBeforeSwitch, __clearCacheForTest } from './editorState';
import { baseExtensions } from './extensions';

/** 在 jsdom 中建一个挂载好的 EditorView（空 doc）。 */
function mountView(): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc: '', extensions: baseExtensions() }),
    parent,
  });
}

describe('editorState cache', () => {
  beforeEach(() => {
    __clearCacheForTest();
  });

  it('openFile creates a fresh state for an uncached path', () => {
    const view = mountView();
    openFile(view, 'a.md', '# Hello', baseExtensions());
    expect(view.state.doc.toString()).toBe('# Hello');
    view.destroy();
  });

  it('openFile reuses the cached state on second open (含光标/历史)', () => {
    const view = mountView();
    openFile(view, 'a.md', 'first', baseExtensions());
    // 用户编辑 a.md
    view.dispatch({ changes: { from: 5, insert: ' edited' } });
    expect(view.state.doc.toString()).toBe('first edited');
    // 切走前快照
    snapshotBeforeSwitch(view, 'a.md');
    // 打开另一文件
    openFile(view, 'b.md', 'second', baseExtensions());
    expect(view.state.doc.toString()).toBe('second');
    // 切回 a.md：缓存命中，恢复编辑后内容（doc 不是重读的 'first'）
    openFile(view, 'a.md', 'first', baseExtensions());
    expect(view.state.doc.toString()).toBe('first edited');
    view.destroy();
  });

  it('在文件 A 撤销不还原文件 B 内容（Pitfall 3 undo 不串味）', () => {
    const view = mountView();
    // 打开 A，做一次编辑（产生可撤销历史）
    openFile(view, 'A.md', 'AAA', baseExtensions());
    view.dispatch({ changes: { from: 3, insert: 'X' } });
    expect(view.state.doc.toString()).toBe('AAAX');
    snapshotBeforeSwitch(view, 'A.md');
    // 打开 B，做一次编辑
    openFile(view, 'B.md', 'BBB', baseExtensions());
    view.dispatch({ changes: { from: 3, insert: 'Y' } });
    expect(view.state.doc.toString()).toBe('BBBY');
    // 在 B 上 undo：只应撤销 B 自己的编辑，绝不还原出 A 的内容
    undo(view);
    expect(view.state.doc.toString()).toBe('BBB');
    view.destroy();
  });

  it('disposeState releases the cached state for a path', () => {
    const view = mountView();
    openFile(view, 'c.md', 'ccc', baseExtensions());
    view.dispatch({ changes: { from: 3, insert: '!' } });
    snapshotBeforeSwitch(view, 'c.md');
    disposeState('c.md');
    // 释放后重开：回到磁盘内容（编辑丢失，因缓存已删）
    openFile(view, 'c.md', 'ccc', baseExtensions());
    expect(view.state.doc.toString()).toBe('ccc');
    view.destroy();
  });
});
