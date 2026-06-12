import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  __resetCompositionForTest,
  isComposing,
  isComposingTr,
  setRelayComposing,
} from '../composition';
import { __clearCacheForTest, openFile } from '../editorState';
import { baseExtensions } from '../extensions';
import { setView } from '../viewHandle';
import { installRelayController } from './relayController';

/**
 * 中继 × 统一冻结门边界收口（PROD-RELAY-DESIGN §2.5 / Wave 3 门收口）。
 *
 * 锁两条边界：① 组合中途有事务 dispatch（中继下复选框翻转 / 组合中点击选区事务）后，
 * setRelayComposing(false) 必须精确移除冻结时记入的陈旧 start state，不留死路径（否则该 state
 * 经 swapState 缓存恢复再成 tr.startState 会被误判组合中）；② 中继组合期 setState 换装经
 * queueAfterComposition 排队，compositionend 落子后 drain 才执行（不撕 DocView、不丢数据）。
 */

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

describe('冻结门陈旧 start state 死路径（Wave 1 ① 收口）', () => {
  function plainView(doc: string): EditorView {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView({ parent: host, state: EditorState.create({ doc }) });
    cleanups.push(() => {
      __resetCompositionForTest(view);
      view.destroy();
      host.remove();
    });
    return view;
  }

  it('组合中途 dispatch 推进 state 后解冻：旧 start state 不再被判为组合中', () => {
    const view = plainView('abcd');
    setRelayComposing(view, true);
    const startState = view.state; // 冻结时记入 frozenStartStates 的那个 state。
    // 组合期被认定为组合中（frozenStartStates 命中）。
    expect(isComposingTr(startState.update({ selection: { anchor: 1 } }))).toBe(true);

    // 组合中途事务（复选框翻转 / 点击选区）推进 view.state → 与记入的 startState 不再同一对象。
    view.dispatch({ selection: { anchor: 2 } });
    expect(view.state).not.toBe(startState);

    setRelayComposing(view, false);
    // 关键：解冻精确移除记入的 startState（recordedStartStates），不留死路径。
    expect(isComposingTr(startState.update({ selection: { anchor: 0 } }))).toBe(false);
    // 新 state 同样不再判为组合中（双删等价，无残留）。
    expect(isComposingTr(view.state.update({ selection: { anchor: 0 } }))).toBe(false);
    expect(isComposing(view)).toBe(false);
  });

  it('空组合（零事务）解冻：start state 一并清除，后续普通事务不误判', () => {
    const view = plainView('xyz');
    setRelayComposing(view, true);
    const startState = view.state;
    setRelayComposing(view, false); // 零事务：recorded === view.state，双删同一对象。
    expect(isComposingTr(startState.update({ selection: { anchor: 1 } }))).toBe(false);
  });
});

describe('中继组合期换装排队（setState swap queue）', () => {
  beforeEach(() => {
    __clearCacheForTest();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });
  afterEach(() => {
    setView(null);
    vi.unstubAllGlobals();
  });

  function mount(doc: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc, extensions: baseExtensions('markdown') }),
    });
    setView(view);
    const teardown = installRelayController(view, host);
    const textarea = host.querySelector('[data-relay-input]') as HTMLTextAreaElement;
    cleanups.push(() => {
      teardown();
      __resetCompositionForTest(view);
      view.destroy();
      host.remove();
    });
    return { view, textarea };
  }

  it('组合期 openFile：换装排队不立即跑；compositionend 落子→drain 后换到目标 doc', async () => {
    const { view, textarea } = mount('AAA');
    view.dispatch({ selection: EditorSelection.cursor(3) });
    const setStateSpy = vi.spyOn(view, 'setState');

    // 中继组合开始（textarea compositionstart → setRelayComposing(true)）。
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    expect(isComposing(view)).toBe(true);

    // 组合期触发换装：swapState 经 isComposing 判定排队，setState 不跑、doc 不变。
    openFile(view, 'b.md', 'BBB', baseExtensions('markdown'));
    expect(setStateSpy).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('AAA');

    // 组合结束：解冻 → relayInsert 落子（落进当前 AAA doc）→ 微任务 drain → 换装执行一次。
    textarea.value = '你好';
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '你好' }));
    await Promise.resolve();
    expect(setStateSpy).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe('BBB'); // end 后落到目标文件。
    expect(isComposing(view)).toBe(false);
  });
});
