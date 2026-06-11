import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  destroyTestView,
  dispatchComposition,
  makeTestView,
  mockComposing,
  withComposition,
} from './composition';

/**
 * 桩本身的自测：dispatchComposition 三阶段须各触发一次注册在 contentDOM 上的
 * domEventHandler；mockComposing 须能强制 view.composing；makeTestView/destroyTestView
 * 配对无泄漏。这是 EDIT-06 所有 IME 触碰测试的地基，桩错则后续全错。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

describe('dispatchComposition', () => {
  it('三阶段各触发一次 contentDOM 上的 domEventHandler', () => {
    const start = vi.fn();
    const update = vi.fn();
    const end = vi.fn();
    view = makeTestView('hello', [
      EditorView.domEventHandlers({
        compositionstart: () => {
          start();
          return false;
        },
        compositionupdate: () => {
          update();
          return false;
        },
        compositionend: () => {
          end();
          return false;
        },
      }),
    ]);

    dispatchComposition(view, { phase: 'compositionstart', data: '中' });
    dispatchComposition(view, { phase: 'compositionupdate', data: '中文' });
    dispatchComposition(view, { phase: 'compositionend', data: '中文' });

    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('CompositionEvent 携带 data 抵达 handler', () => {
    let received = '';
    view = makeTestView('', [
      EditorView.domEventHandlers({
        compositionupdate: (event) => {
          received = event.data ?? '';
          return false;
        },
      }),
    ]);

    dispatchComposition(view, { phase: 'compositionupdate', data: '墨流' });
    expect(received).toBe('墨流');
  });
});

describe('withComposition', () => {
  it('包裹 start → fn → end 顺序执行', () => {
    const order: string[] = [];
    view = makeTestView('', [
      EditorView.domEventHandlers({
        compositionstart: () => {
          order.push('start');
          return false;
        },
        compositionend: () => {
          order.push('end');
          return false;
        },
      }),
    ]);

    withComposition(view, () => order.push('fn'), 'x');
    expect(order).toEqual(['start', 'fn', 'end']);
  });
});

describe('mockComposing', () => {
  it('强制覆写 view.composing getter', () => {
    view = makeTestView('');
    expect(view.composing).toBe(false);
    mockComposing(view, true);
    expect(view.composing).toBe(true);
    mockComposing(view, false);
    expect(view.composing).toBe(false);
  });
});

describe('makeTestView / destroyTestView', () => {
  it('工厂构建带初始文档的真实 view', () => {
    view = makeTestView('初始文档');
    expect(view.state.doc.toString()).toBe('初始文档');
  });

  it('destroyTestView 容忍 null（afterEach 早退场景）', () => {
    expect(() => destroyTestView(null)).not.toThrow();
  });
});
