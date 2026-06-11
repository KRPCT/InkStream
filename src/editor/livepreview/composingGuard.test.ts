import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../../test/composition';
import { composingGuard, isFrozen, refreshLivePreview } from './composingGuard';

/**
 * IME 冻结闸门回归门（EDIT-06，全项目最高风险件 / RESEARCH Pitfall 1）。
 *
 * 用 Wave 0 的 CompositionEvent jsdom 桩驱动真实 compositionstart/end，断言：
 *   1. compositionstart 后 isFrozen(view) === true（此后装饰层 update 须短路保旧 RangeSet）；
 *   2. compositionend 后 isFrozen(view) === false 且派发一次 refreshLivePreview effect
 *      （compositionend 后 view.composing 可能残留 true，故须叠加原生事件 + 强制刷新一次）。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

describe('composingGuard（IME 冻结闸门）', () => {
  it('compositionstart 后 isFrozen 翻为 true', () => {
    view = makeTestView('文档', [composingGuard]);
    expect(isFrozen(view)).toBe(false);

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    expect(isFrozen(view)).toBe(true);
  });

  it('compositionend 后 isFrozen 翻回 false 且派发一次 refreshLivePreview', () => {
    view = makeTestView('文档', [composingGuard]);
    const spy = vi.spyOn(view, 'dispatch');

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    expect(isFrozen(view)).toBe(true);

    dispatchComposition(view, { phase: 'compositionend', data: '你好' });
    expect(isFrozen(view)).toBe(false);

    // 强制刷新恰好一次：派发一个携带 refreshLivePreview effect 的事务。
    const refreshDispatches = spy.mock.calls.filter(([arg]) => {
      const effects = arg && typeof arg === 'object' && 'effects' in arg ? arg.effects : undefined;
      const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
      return list.some((e) => e.is(refreshLivePreview));
    });
    expect(refreshDispatches).toHaveLength(1);
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
});
