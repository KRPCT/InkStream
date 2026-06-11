import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../../test/composition';
import { composingGuard, isFrozen, refreshLivePreview } from './composingGuard';

/**
 * IME 冻结闸门回归门（EDIT-06，全项目最高风险件 / RESEARCH Pitfall 1）。
 *
 * 用 Wave 0 的 CompositionEvent jsdom 桩驱动真实 compositionstart/end，断言：
 *   1. compositionstart 后 isFrozen(view) === true（此后装饰层 update 须保旧 RangeSet、docChanged 时 map）；
 *   2. compositionstart/compositionend 处理器内**绝无同步 view.dispatch**——组合期注入同步事务会破坏
 *      CM6 的 IME 上屏 flush（observer.clear 丢弃尚未 flush 的上屏 mutation，root cause A）；
 *   3. compositionend 后 isFrozen(view) === false，且**推迟一个微任务**派发恰好一次 refreshLivePreview
 *      （await Promise.resolve() flush 微任务后才出现，且守 !view.composing）。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

/** 过滤出携带 refreshLivePreview effect 的 dispatch 调用。 */
function refreshCalls(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  return spy.mock.calls.filter((call: unknown[]) => {
    const arg = call[0];
    const effects = arg && typeof arg === 'object' && 'effects' in arg ? arg.effects : undefined;
    const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
    return list.some((e) => e.is(refreshLivePreview));
  });
}

describe('composingGuard（IME 冻结闸门）', () => {
  it('compositionstart 后 isFrozen 翻为 true', () => {
    view = makeTestView('文档', [composingGuard]);
    expect(isFrozen(view)).toBe(false);

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    expect(isFrozen(view)).toBe(true);
  });

  it('compositionstart/compositionend 处理器内绝无同步 view.dispatch（root cause A 防回归）', () => {
    view = makeTestView('文档', [composingGuard]);
    const spy = vi.spyOn(view, 'dispatch');

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    // compositionstart 处理器只置同步 WeakMap 标志，绝不派发事务。
    expect(spy).not.toHaveBeenCalled();

    dispatchComposition(view, { phase: 'compositionend', data: '你好' });
    // compositionend 处理器同步窗口内也绝不派发——强刷被推迟到微任务，此刻尚未触发。
    expect(spy).not.toHaveBeenCalled();
  });

  it('compositionend 后 isFrozen 翻回 false，强刷推迟一个微任务恰好派发一次', async () => {
    view = makeTestView('文档', [composingGuard]);
    const spy = vi.spyOn(view, 'dispatch');

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    expect(isFrozen(view)).toBe(true);

    dispatchComposition(view, { phase: 'compositionend', data: '你好' });
    expect(isFrozen(view)).toBe(false);
    // 同步窗口内尚无强刷。
    expect(refreshCalls(spy)).toHaveLength(0);

    // flush 微任务：jsdom view.composing 不为 true，守卫放行 → 恰好一次 refreshLivePreview。
    await Promise.resolve();
    expect(refreshCalls(spy)).toHaveLength(1);
  });

  it('背靠背组合：N 微任务排空前 N+1 已 start，陈旧强刷被代际取代不派发（咕咕咕重复同音节根因）', async () => {
    view = makeTestView('文档', [composingGuard]);
    const spy = vi.spyOn(view, 'dispatch');

    // 组合 N：start → end，调度 N 的强刷微任务。
    dispatchComposition(view, { phase: 'compositionstart', data: '咕' });
    dispatchComposition(view, { phase: 'compositionend', data: '咕' });
    expect(refreshCalls(spy)).toHaveLength(0);

    // 排空微任务前，组合 N+1 已 start——递增代际，作废 N 在飞的强刷，并重新冻结。
    dispatchComposition(view, { phase: 'compositionstart', data: '咕' });

    await Promise.resolve();
    // N 的强刷因代际改变（被 N+1 取代）被撤销；N+1 仍在合成（isFrozen），绝不强刷。
    expect(refreshCalls(spy)).toHaveLength(0);
    expect(isFrozen(view)).toBe(true);
  });

  it('N+1 在 N 微任务排空前已完整 start→end：代际守卫使恰好一次强刷（证代际守卫不止于 isFrozen）', async () => {
    view = makeTestView('文档', [composingGuard]);
    const spy = vi.spyOn(view, 'dispatch');

    // 组合 N：start → end，调度 N 的强刷微任务（gen=1）。
    dispatchComposition(view, { phase: 'compositionstart', data: '咕' });
    dispatchComposition(view, { phase: 'compositionend', data: '咕' });
    // 排空前，组合 N+1 同步完整跑完 start→end（gen=2，调度 N+1 的强刷微任务）。
    dispatchComposition(view, { phase: 'compositionstart', data: '咕' });
    dispatchComposition(view, { phase: 'compositionend', data: '咕' });
    expect(refreshCalls(spy)).toHaveLength(0);
    // 此刻 isFrozen 已复位 false——仅 isFrozen 守卫无法区分 N（陈旧）与 N+1（应派发），唯代际可辨。
    expect(isFrozen(view)).toBe(false);

    await Promise.resolve();
    // N 的强刷被代际取代（gen 已到 2）撤销；N+1 的强刷代际匹配且组合已结束 → 恰好一次。
    expect(refreshCalls(spy)).toHaveLength(1);
  });

  it('组合期内多次 compositionupdate 不解冻（仍冻结）', () => {
    view = makeTestView('文档', [composingGuard]);

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    dispatchComposition(view, { phase: 'compositionupdate', data: '你好' });
    dispatchComposition(view, { phase: 'compositionupdate', data: '你好吗' });
    expect(isFrozen(view)).toBe(true);

    dispatchComposition(view, { phase: 'compositionend', data: '你好吗' });
    expect(isFrozen(view)).toBe(false);
  });

  it('每 view 冻结标志独立（WeakMap 随 view 隔离）', () => {
    view = makeTestView('a', [composingGuard]);
    const other = makeTestView('b', [composingGuard]);
    try {
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      expect(isFrozen(view)).toBe(true);
      // 另一个 view 未收到 compositionstart，不应被波及。
      expect(isFrozen(other)).toBe(false);
    } finally {
      destroyTestView(other);
    }
  });

  it('CM6 原生 input.type.compose userEvent 被识别（块级层据此短路）', () => {
    view = makeTestView('文档', [composingGuard]);
    const composeTr = view.state.update({
      changes: { from: view.state.doc.length, insert: '你' },
      userEvent: 'input.type.compose',
    });
    expect(composeTr.isUserEvent('input.type.compose')).toBe(true);

    // 普通输入事务不应误判为组合事务。
    const plain = view.state.update({
      changes: { from: view.state.doc.length, insert: 'a' },
      userEvent: 'input.type',
    });
    expect(plain.isUserEvent('input.type.compose')).toBe(false);
  });
});
