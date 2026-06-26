import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import {
  disposeState,
  openFile,
  scrollContainer,
  snapshotBeforeSwitch,
  switchToTab,
  __clearCacheForTest,
} from './editorState';
import { __resetCompositionForTest } from './composition';
import { setView } from './viewHandle';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { dispatchComposition } from '../test/composition';
import { baseExtensions } from './extensions';
import { imageVaultFacet } from './livepreview/inlinePlugin';

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

describe('scrollContainer 选真实滚动容器（#17：.cm-scroller 恒 0，真滚在外层 overflow-auto）', () => {
  it('选中最近的可滚外层祖先（overflow-y:auto 且内容溢出）', () => {
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
    document.body.appendChild(scroller);
    const view = new EditorView({
      state: EditorState.create({ doc: '', extensions: baseExtensions() }),
      parent: scroller,
    });
    expect(scrollContainer(view)).toBe(scroller); // 命中外层 div，而非 view.scrollDOM。
    view.destroy();
    scroller.remove();
  });

  it('无可滚外层（无 overflow / 无溢出，含 jsdom 无布局）时回退 view.scrollDOM', () => {
    const view = mountView(); // parent 默认 overflow:visible、jsdom scrollHeight=clientHeight=0。
    expect(scrollContainer(view)).toBe(view.scrollDOM);
    view.destroy();
  });
});

describe('openFile 注入 imageVaultFacet（WR-07 注入侧，per-view vault 上下文）', () => {
  beforeEach(() => {
    __clearCacheForTest();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    useVaultStore.setState({ vault: null });
    vi.unstubAllGlobals();
  });

  it('有 vault 时新建 state 携带 {root, docPath}（装饰层据此解析本地图，不读全局 store）', () => {
    useVaultStore.setState({
      vault: { root: 'D:/vault', repoRoot: null, name: 'vault' },
    });
    const view = mountView();
    openFile(view, 'notes/a.md', '![](img.png)', baseExtensions());
    expect(view.state.facet(imageVaultFacet)).toEqual({ root: 'D:/vault', docPath: 'notes/a.md' });
    view.destroy();
  });

  it('无 vault 时回落 null（消费侧按无上下文处理，本地图不解析）', () => {
    useVaultStore.setState({ vault: null });
    const view = mountView();
    openFile(view, 'b.md', 'hi', baseExtensions());
    expect(view.state.facet(imageVaultFacet)).toBeNull();
    view.destroy();
  });
});

describe('openFile 不程序化抢焦点（WebView2 IME 平台限制，点击编辑器再输入）', () => {
  beforeEach(() => {
    __clearCacheForTest();
    // openFile 内 restoreScroll 仍走 rAF：同步桩让其立即执行，便于断言焦点自始至终未被调用。
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('openFile 打开文件后不调用 view.focus（不给假光标，避免首次中文组合丢字）', () => {
    const view = mountView();
    const focusSpy = vi.spyOn(view, 'focus');
    openFile(view, 'focus.md', 'hello', baseExtensions());
    // WebView2 只在真实指针进入编辑器时武装 OS IME/TSF；任何 programmatic 聚焦（view.focus /
    // MoveFocus / EditContext）都不武装中文输入、反诱导吞字（真机 CDP 证）。故打开文件不抢焦点，
    // 由用户点击编辑器自然落焦（见 CONSTRAINTS §8 / specs 03）。
    expect(focusSpy).not.toHaveBeenCalled();
    view.destroy();
  });
});

describe('换装过统一冻结门（§4.1：组合期排队、compositionend 后执行一次）', () => {
  let view: EditorView;

  beforeEach(() => {
    __clearCacheForTest();
    view = mountView();
    setView(view);
    useEditorStore.setState({ activePath: null });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    __resetCompositionForTest(view);
    setView(null);
    view.destroy();
    vi.unstubAllGlobals();
  });

  it('组合期 openFile：setState 不立即跑，compositionend 后恰好一次且 doc 为目标文件', async () => {
    openFile(view, 'a.md', 'AAA', baseExtensions());
    const setStateSpy = vi.spyOn(view, 'setState');
    // 用户开始组合中文，期间点别的文件触发 openFile：换装应排队、不撕 DocView。
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    openFile(view, 'b.md', 'BBB', baseExtensions());
    expect(setStateSpy).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('AAA');

    // compositionend → drain：换装恰好执行一次，doc 切到目标 b.md。
    dispatchComposition(view, { phase: 'compositionend', data: '你好' });
    await Promise.resolve();
    expect(setStateSpy).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe('BBB');
  });

  it('组合期先切 A 后切 B（不同 key 各排）→ drain 按入队序，最终停 B', async () => {
    openFile(view, 'start.md', 'START', baseExtensions());
    dispatchComposition(view, { phase: 'compositionstart', data: '咕' });
    // 组合期连续切两个不同文件：各排一个 swap task。
    openFile(view, 'A.md', 'AAA', baseExtensions());
    openFile(view, 'B.md', 'BBB', baseExtensions());
    expect(view.state.doc.toString()).toBe('START');

    dispatchComposition(view, { phase: 'compositionend', data: '咕咕咕' });
    await Promise.resolve();
    // 入队序 A→B，drain 顺序执行，最终停在最后入队的 B（取最后一次语义）。
    expect(view.state.doc.toString()).toBe('BBB');
  });

  it('组合期 switchToTab（已缓存 tab）：换装排队，end 后切到目标且 setActive 已同步', async () => {
    // 先开 A 并快照入缓存，再切到 B（B 成为活动文件）。
    openFile(view, 'A.md', 'AAA', baseExtensions());
    useEditorStore.setState({ activePath: 'A.md' });
    snapshotBeforeSwitch(view, 'A.md');
    openFile(view, 'B.md', 'BBB', baseExtensions());
    useEditorStore.setState({ activePath: 'B.md' });
    snapshotBeforeSwitch(view, 'B.md');

    // 组合期点回 A（缓存命中）：setActive 门外同步、换装排队、doc 仍是 B。
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    switchToTab('A.md');
    expect(useEditorStore.getState().activePath).toBe('A.md');
    expect(view.state.doc.toString()).toBe('BBB');

    dispatchComposition(view, { phase: 'compositionend', data: '你好' });
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe('AAA');
  });

  it('非组合期 openFile：换装立即执行（行为同今天，不排队）', () => {
    openFile(view, 'now.md', 'NOW', baseExtensions());
    expect(view.state.doc.toString()).toBe('NOW');
  });

  it('switchToTab 缓存缺失：不换装、不翻 activePath（IN-05 view/activePath 同步）', () => {
    openFile(view, 'A.md', 'AAA', baseExtensions());
    useEditorStore.setState({ activePath: 'A.md' });
    // 切到未缓存的 path：view 应仍显 A.md，activePath 不翻到 ghost（否则下游取真相源拿错内容）。
    switchToTab('ghost.md');
    expect(useEditorStore.getState().activePath).toBe('A.md');
    expect(view.state.doc.toString()).toBe('AAA');
  });
});

describe('换装镜像光标到 store（#2b：面包屑/大纲活动项不沿用上一文件偏移）', () => {
  beforeEach(() => {
    __clearCacheForTest();
    useEditorStore.setState({ cursor: 0, activePath: null });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('openFile 把恢复后的选区头同步到 store.cursor（切走→切回跟随缓存选区）', () => {
    const view = mountView();
    openFile(view, 'a.md', 'AAAAAAAAAA', baseExtensions());
    view.dispatch({ selection: { anchor: 7 } }); // 用户落选到偏移 7（mirrorListener 即镜像）
    expect(useEditorStore.getState().cursor).toBe(7);
    snapshotBeforeSwitch(view, 'a.md');
    openFile(view, 'b.md', 'bbb', baseExtensions()); // 切到 b：新选区头 0
    expect(useEditorStore.getState().cursor).toBe(0); // 不再沿用 a 的 7
    openFile(view, 'a.md', 'AAAAAAAAAA', baseExtensions()); // 切回 a：缓存命中，选区恢复 7
    expect(useEditorStore.getState().cursor).toBe(7);
    view.destroy();
  });

  it('switchToTab 把缓存态选区头同步到 store.cursor', () => {
    const view = mountView();
    setView(view);
    openFile(view, 'A.md', 'AAAAAAAAAA', baseExtensions());
    useEditorStore.setState({ activePath: 'A.md' });
    view.dispatch({ selection: { anchor: 6 } });
    snapshotBeforeSwitch(view, 'A.md');
    openFile(view, 'B.md', 'BBBBB', baseExtensions());
    useEditorStore.setState({ activePath: 'B.md' });
    view.dispatch({ selection: { anchor: 2 } });
    snapshotBeforeSwitch(view, 'B.md');
    switchToTab('A.md'); // 切回 A：恢复缓存选区头 6
    expect(useEditorStore.getState().cursor).toBe(6);
    setView(null);
    view.destroy();
  });
});
