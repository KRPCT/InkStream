import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('editorState 滚动位置缓存/还原（D-03）', () => {
  beforeEach(() => {
    __clearCacheForTest();
    // jsdom 无真实布局：用可写桩替换 view.scrollDOM.scrollTop 的 getter/setter，
    // 并同步刷新 requestAnimationFrame（openFile 推迟一帧设置滚动）。
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 给 view.scrollDOM.scrollTop 装可读写桩。 */
  function stubScrollTop(view: EditorView, initial: number): { get: () => number } {
    let value = initial;
    Object.defineProperty(view.scrollDOM, 'scrollTop', {
      configurable: true,
      get: () => value,
      set: (v: number) => {
        value = v;
      },
    });
    return { get: () => value };
  }

  it('snapshotBeforeSwitch 记录当前 scrollTop，切回该路径时还原', () => {
    const view = mountView();
    openFile(view, 'long.md', 'x'.repeat(100), baseExtensions());
    const scroll = stubScrollTop(view, 0);
    // 用户在 long.md 滚动到 250
    view.scrollDOM.scrollTop = 250;
    snapshotBeforeSwitch(view, 'long.md');
    // 切到另一文件（滚动重置为 0）
    openFile(view, 'other.md', 'short', baseExtensions());
    view.scrollDOM.scrollTop = 0;
    // 切回 long.md：缓存命中 + scrollTop 被还原为离开时的 250（D-03 滚动位置恢复）
    openFile(view, 'long.md', 'x'.repeat(100), baseExtensions());
    expect(scroll.get()).toBe(250);
    view.destroy();
  });

  it('首次打开无缓存则 scrollTop 置 0', () => {
    const view = mountView();
    const scroll = stubScrollTop(view, 999);
    openFile(view, 'fresh.md', 'hi', baseExtensions());
    expect(scroll.get()).toBe(0);
    view.destroy();
  });

  it('disposeState 同时清除该 path 的滚动缓存（关 tab 后不残留）', () => {
    const view = mountView();
    openFile(view, 'd.md', 'ddd', baseExtensions());
    const scroll = stubScrollTop(view, 0);
    view.scrollDOM.scrollTop = 120;
    snapshotBeforeSwitch(view, 'd.md');
    disposeState('d.md');
    // 释放后重开：滚动缓存已清，回到 0（不残留 120）
    openFile(view, 'd.md', 'ddd', baseExtensions());
    expect(scroll.get()).toBe(0);
    view.destroy();
  });
});
