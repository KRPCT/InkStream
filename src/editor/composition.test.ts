import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView, mockComposing } from '../test/composition';
import {
  __resetCompositionForTest,
  compositionGate,
  isComposing,
  isComposingTr,
  onCompositionEnd,
  queueAfterComposition,
  refreshLivePreview,
  setRelayComposing,
} from './composition';

/**
 * 统一组合冻结门不变量（重构设计 §7.4）。承接 composingGuard.test.ts 时序契约，新增双判 /
 * isComposingTr 等价 / 排队去重 / drain 固定顺序断言。
 *
 * 注：jsdom 不复现真实 IME（无 inputState.composing 三态 / MutationObserver），本套只锁
 * 「门时序 + 判据 + 排队调度」契约，真验收=Windows+WebView2 真机拼音（铁律 5）。
 */

let view: EditorView | null = null;

afterEach(() => {
  if (view) __resetCompositionForTest(view);
  destroyTestView(view);
  view = null;
});

/** 过滤携带 refreshLivePreview effect 的 dispatch 调用。 */
function refreshCalls(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  return spy.mock.calls.filter((call: unknown[]) => {
    const arg = call[0];
    const effects = arg && typeof arg === 'object' && 'effects' in arg ? arg.effects : undefined;
    const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
    return list.some((e) => e.is(refreshLivePreview));
  });
}

describe('composition（统一组合冻结门）', () => {
  describe('isComposing 双判四态（铁律 4）', () => {
    it('composing=false × frozen=false → false', () => {
      view = makeTestView('文档', [compositionGate]);
      expect(isComposing(view)).toBe(false);
    });

    it('composing=false × frozen=true → true（compositionstart 同步置位，覆盖 composing===0 启动窗）', () => {
      view = makeTestView('文档', [compositionGate]);
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      expect(view.composing).toBe(false); // jsdom 不置 composing
      expect(isComposing(view)).toBe(true);
    });

    it('composing=true × frozen=false → true（覆盖 dev#1069：end 后 composing 残留 true）', () => {
      view = makeTestView('文档', [compositionGate]);
      mockComposing(view, true);
      expect(isComposing(view)).toBe(true);
    });

    it('composing=true × frozen=true → true', () => {
      view = makeTestView('文档', [compositionGate]);
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      mockComposing(view, true);
      expect(isComposing(view)).toBe(true);
    });
  });

  describe('isComposingTr 等价 isComposing（CR-01 同源）', () => {
    it('组合期事务：annotation ∪ CM6 原生标记 ∪ frozen 三支都判 true', () => {
      view = makeTestView('文档', [compositionGate]);
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });

      // start 后首个 docChanged 事务（无 userEvent）：annotation 桥 + frozen 兜底必为 true。
      const tr = view.state.update({ changes: { from: view.state.doc.length, insert: '你' } });
      expect(isComposingTr(tr)).toBe(true);
    });

    it('start 后首个 docChanged 事务 isComposingTr 必为 true（annotation 时序盲区兜底）', () => {
      view = makeTestView('文档', [compositionGate]);
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });

      const tr = view.state.update({
        changes: { from: view.state.doc.length, insert: '你' },
        userEvent: 'input.type.compose',
      });
      expect(isComposingTr(tr)).toBe(true);
      // 与同 view 的 isComposing 一致。
      expect(isComposing(view)).toBe(true);
    });

    it('非组合期普通输入事务 isComposingTr 为 false', () => {
      view = makeTestView('文档', [compositionGate]);
      const tr = view.state.update({
        changes: { from: view.state.doc.length, insert: 'a' },
        userEvent: 'input.type',
      });
      expect(isComposingTr(tr)).toBe(false);
      expect(isComposing(view)).toBe(false);
    });

    it('空组合 end 后同步窗口的普通编辑不被误判为组合（frozenStartStates 同步清理）', () => {
      view = makeTestView('文档', [compositionGate]);
      // 空组合：start→end 零事务，state 未推进——end 必须把 start 记入的 state 从集合移除，
      // 否则 drain 微任务前的首个普通编辑事务 startState 仍在册，被误判为组合中。
      dispatchComposition(view, { phase: 'compositionstart', data: '' });
      dispatchComposition(view, { phase: 'compositionend', data: '' });
      const tr = view.state.update({
        changes: { from: view.state.doc.length, insert: 'a' },
        userEvent: 'input.type',
      });
      expect(isComposingTr(tr)).toBe(false);
      expect(isComposing(view)).toBe(false);
    });

    it('CM6 原生 input.type.compose 单支即识别（块级层旧判据等价保留）', () => {
      view = makeTestView('文档', [compositionGate]);
      // 不经 compositionstart，仅 CM6 原生标记（块级层据此短路）。
      const compose = view.state.update({
        changes: { from: view.state.doc.length, insert: '你' },
        userEvent: 'input.type.compose',
      });
      expect(isComposingTr(compose)).toBe(true);
    });
  });

  describe('queueAfterComposition 排队调度（铁律 2）', () => {
    it('非组合期立即执行', () => {
      view = makeTestView('文档', [compositionGate]);
      const task = vi.fn();
      queueAfterComposition(view, 'k', task);
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('组合期不立即执行，compositionend 后执行一次', async () => {
      view = makeTestView('文档', [compositionGate]);
      const task = vi.fn();
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });

      queueAfterComposition(view, 'k', task);
      expect(task).not.toHaveBeenCalled();

      dispatchComposition(view, { phase: 'compositionend', data: '你好' });
      expect(task).not.toHaveBeenCalled(); // 同步窗口尚未 drain

      await Promise.resolve();
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('组合期同 key 去重，drain 只执行最后一次', async () => {
      view = makeTestView('文档', [compositionGate]);
      const first = vi.fn();
      const last = vi.fn();
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });

      queueAfterComposition(view, 'k', first);
      queueAfterComposition(view, 'k', last);
      dispatchComposition(view, { phase: 'compositionend', data: '你好' });

      await Promise.resolve();
      expect(first).not.toHaveBeenCalled();
      expect(last).toHaveBeenCalledTimes(1);
    });

    it('不同 key 各排一个，drain 按入队序执行（先 A 后 B → A 先 B 后）', async () => {
      view = makeTestView('文档', [compositionGate]);
      const order: string[] = [];
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });

      queueAfterComposition(view, 'A', () => {
        order.push('A');
      });
      queueAfterComposition(view, 'B', () => {
        order.push('B');
      });
      dispatchComposition(view, { phase: 'compositionend', data: '你好' });

      await Promise.resolve();
      expect(order).toEqual(['A', 'B']);
    });

    it('onCompositionEnd 组合期挂起、结束执行一次（deferReplay 一般化）', async () => {
      view = makeTestView('文档', [compositionGate]);
      const cb = vi.fn();
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });

      onCompositionEnd(view, 'replay', cb);
      expect(cb).not.toHaveBeenCalled();

      dispatchComposition(view, { phase: 'compositionend', data: '你好' });
      await Promise.resolve();
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('compositionend drain（三守卫 + 固定顺序）', () => {
    it('drain 固定顺序：refreshLivePreview 先于排空 pendingTasks', async () => {
      view = makeTestView('文档', [compositionGate]);
      const seq: string[] = [];
      const spy = vi.spyOn(view, 'dispatch').mockImplementation(((arg: unknown) => {
        const effects = arg && typeof arg === 'object' && 'effects' in arg ? arg.effects : undefined;
        const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
        if (list.some((e: { is: (x: unknown) => boolean }) => e.is(refreshLivePreview))) {
          seq.push('refresh');
        }
      }) as never);

      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      queueAfterComposition(view, 'write', () => {
        seq.push('write');
      });
      dispatchComposition(view, { phase: 'compositionend', data: '你好' });

      await Promise.resolve();
      expect(seq).toEqual(['refresh', 'write']);
      spy.mockRestore();
    });

    it('守卫 (b)：drain 时 view.composing 仍为 true → 不强刷、不排空', async () => {
      view = makeTestView('文档', [compositionGate]);
      const task = vi.fn();
      const spy = vi.spyOn(view, 'dispatch');

      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      queueAfterComposition(view, 'k', task);
      dispatchComposition(view, { phase: 'compositionend', data: '你好' });
      mockComposing(view, true); // drain 前 composing 仍 true

      await Promise.resolve();
      expect(refreshCalls(spy)).toHaveLength(0);
      expect(task).not.toHaveBeenCalled();
    });

    it('守卫 (c)：composing===0 启动窗 frozen 残 true → 不强刷（双判第二判）', async () => {
      view = makeTestView('文档', [compositionGate]);
      const task = vi.fn();
      const spy = vi.spyOn(view, 'dispatch');

      // end 调度 drain 后，下一组合 start 又置 frozen=true（同 view），但代际同时前进。
      // 单测此处只验：drain 体内 isComposing 仍为 true 时不强刷（守卫 c）。
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      queueAfterComposition(view, 'k', task);
      dispatchComposition(view, { phase: 'compositionend', data: '你好' });
      dispatchComposition(view, { phase: 'compositionstart', data: '吗' }); // frozen 再置 true，gen 前进

      await Promise.resolve();
      // 陈旧 drain 因代际变（守卫 a）作废；即便绕过 a，frozen=true 也被守卫 c 拦。
      expect(refreshCalls(spy)).toHaveLength(0);
      expect(task).not.toHaveBeenCalled();
    });
  });

  describe('refreshGen 跨组合作废（咕咕咕重复同音节）', () => {
    it('N 的 drain 被 N+1 start 取代不强刷', async () => {
      view = makeTestView('文档', [compositionGate]);
      const spy = vi.spyOn(view, 'dispatch');

      dispatchComposition(view, { phase: 'compositionstart', data: '咕' });
      dispatchComposition(view, { phase: 'compositionend', data: '咕' });
      // 排空前 N+1 已 start：代际前进，作废 N 在飞的强刷。
      dispatchComposition(view, { phase: 'compositionstart', data: '咕' });

      await Promise.resolve();
      expect(refreshCalls(spy)).toHaveLength(0);
      expect(isComposing(view)).toBe(true);
    });

    it('N+1 排空前完整 start→end：代际守卫使恰好一次强刷（证不止于 frozen）', async () => {
      view = makeTestView('文档', [compositionGate]);
      const spy = vi.spyOn(view, 'dispatch');

      dispatchComposition(view, { phase: 'compositionstart', data: '咕' });
      dispatchComposition(view, { phase: 'compositionend', data: '咕' });
      dispatchComposition(view, { phase: 'compositionstart', data: '咕' });
      dispatchComposition(view, { phase: 'compositionend', data: '咕' });
      expect(refreshCalls(spy)).toHaveLength(0);
      expect(isComposing(view)).toBe(false);

      await Promise.resolve();
      // N 被代际取代撤销；N+1 代际匹配且组合已结束 → 恰好一次。
      expect(refreshCalls(spy)).toHaveLength(1);
    });
  });

  describe('组合期零额外 dispatch（防 root cause A 近亲）', () => {
    it('compositionstart/end handler 同步窗口内绝不 dispatch', () => {
      view = makeTestView('文档', [compositionGate]);
      const spy = vi.spyOn(view, 'dispatch');

      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      expect(spy).not.toHaveBeenCalled();

      dispatchComposition(view, { phase: 'compositionend', data: '你好' });
      expect(spy).not.toHaveBeenCalled(); // 强刷推迟到微任务
    });

    it('compositionend 后强刷恰好一次（守卫放行）', async () => {
      view = makeTestView('文档', [compositionGate]);
      const spy = vi.spyOn(view, 'dispatch');

      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      dispatchComposition(view, { phase: 'compositionend', data: '你好' });
      expect(refreshCalls(spy)).toHaveLength(0);

      await Promise.resolve();
      expect(refreshCalls(spy)).toHaveLength(1);
    });
  });

  describe('冻结起始 state 精确移除（Wave 1 遗留 ①：组合中途事务后不留陈旧条目）', () => {
    it('组合期内：以冻结起始 state 为 startState 的事务判组合中（对照基线）', () => {
      view = makeTestView('正文', [compositionGate]);
      const start = view.state;
      setRelayComposing(view, true);
      expect(isComposingTr(start.update({}))).toBe(true);
      setRelayComposing(view, false);
    });

    it('组合中途选区事务推进 state 后解冻：起始 state 仍被精确移除', () => {
      view = makeTestView('正文', [compositionGate]);
      const start = view.state;
      setRelayComposing(view, true);
      view.dispatch({ selection: { anchor: 1 } }); // 组合中途点击：view.state 推进，start 滞留风险。
      setRelayComposing(view, false);
      // 起始 state 若滞留在册，它经 swapState 缓存恢复再成为 startState 时会被误判组合中。
      expect(isComposingTr(start.update({}))).toBe(false);
      expect(isComposing(view)).toBe(false);
    });

    it('contentDOM 门同款：组合中途事务后 compositionend 亦精确移除起始 state', () => {
      view = makeTestView('正文', [compositionGate]);
      const start = view.state;
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      view.dispatch({ selection: { anchor: 2 } });
      dispatchComposition(view, { phase: 'compositionend', data: '你' });
      expect(isComposingTr(start.update({}))).toBe(false);
    });
  });

  it('每 view 冻结标志独立（WeakMap 随 view 隔离）', () => {
    view = makeTestView('a', [compositionGate]);
    const other = makeTestView('b', [compositionGate]);
    try {
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      expect(isComposing(view)).toBe(true);
      expect(isComposing(other)).toBe(false);
    } finally {
      destroyTestView(other);
    }
  });
});
