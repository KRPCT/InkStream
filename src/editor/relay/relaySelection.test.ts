import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions } from '../extensions';
import { installRelayController } from './relayController';
import { clickSelection } from './relayState';
import type { RelayDefer } from './textareaRelay';

/**
 * 中继选区手势配对测试（PROD-RELAY-DESIGN §2.3 / Wave 2）：拖拽 range、Shift+点击扩展、
 * 双击选词（wordAt 语言感知）、三击选行（含行尾换行）、拖拽结束回焦。
 *
 * jsdom 无布局：posAtCoords 经 Object.defineProperty 钉死（可变闭包模拟拖拽轨迹）；
 * 拖拽节流帧经手动 defer 注入锁时序（替代 rAF）。
 */

function makeDefer(): { defer: RelayDefer; flush: () => void } {
  const tasks = new Map<number, () => void>();
  let nextId = 0;
  return {
    defer: {
      schedule: (task) => {
        tasks.set((nextId += 1), task);
        return nextId;
      },
      cancel: (id) => void tasks.delete(id),
    },
    flush: () => {
      for (const [id, task] of [...tasks]) {
        tasks.delete(id);
        task();
      }
    },
  };
}

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

/** 生产形态挂载 + 可变 posAtCoords 钉桩（pin(pos) 改变后续命中位置，模拟鼠标轨迹）。 */
function mount(doc = '') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: baseExtensions('markdown') }),
  });
  const { defer, flush } = makeDefer();
  const teardown = installRelayController(view, host, defer);
  const textarea = host.querySelector('[data-relay-input]') as HTMLTextAreaElement;
  let pinned: number | null = null;
  Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => pinned });
  cleanups.push(() => {
    teardown();
    view.destroy();
    host.remove();
  });
  return { view, textarea, flush, pin: (p: number | null) => void (pinned = p) };
}

function mouse(type: string, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

describe('clickSelection（点击 → 选区映射）', () => {
  it('双击：wordAt 词边界（CJK 经 charCategorizer 同样成词）', () => {
    const { view } = mount('hello world');
    expect(clickSelection(view, 8, mouse('mousedown', { detail: 2 }))).toEqual({
      anchor: 6,
      head: 11,
    });
  });

  it('双击落在两侧均非词字符处：退化为置光标', () => {
    const { view } = mount('a  b');
    expect(clickSelection(view, 2, mouse('mousedown', { detail: 2 }))).toEqual({ anchor: 2 });
  });

  it('三击：整行含行尾换行符；末行不含（doc 末尾）', () => {
    const { view } = mount('一行\n二行\n三行');
    expect(clickSelection(view, 4, mouse('mousedown', { detail: 3 }))).toEqual({
      anchor: 3,
      head: 6, // 二行 + \n。
    });
    expect(clickSelection(view, 7, mouse('mousedown', { detail: 3 }))).toEqual({
      anchor: 6,
      head: 8, // 末行无 \n 可含。
    });
  });

  it('Shift+点击：anchor 保持当前选区 anchor，head=点击 pos', () => {
    const { view } = mount('abcdef');
    view.dispatch({ selection: { anchor: 2 } });
    expect(clickSelection(view, 5, mouse('mousedown', { detail: 1, shiftKey: true }))).toEqual({
      anchor: 2,
      head: 5,
    });
  });
});

describe('relayGesture × 拖拽（mousedown → mousemove → mouseup）', () => {
  it('拖拽跨字符：mousedown 置 anchor，mousemove 帧内 dispatch range，mouseup 定格', () => {
    const { view, textarea, flush, pin } = mount('风急天高猿啸哀');
    pin(1);
    view.contentDOM.dispatchEvent(mouse('mousedown', { detail: 1 }));
    expect(view.state.selection.main.head).toBe(1);
    expect(document.activeElement).toBe(textarea);

    pin(4); // 鼠标移到 pos=4。
    document.dispatchEvent(mouse('mousemove'));
    flush(); // 节流帧落盘。
    expect(view.state.selection.main.anchor).toBe(1);
    expect(view.state.selection.main.head).toBe(4);
    expect(view.state.selection.main.empty).toBe(false);

    pin(6); // 继续拖到 pos=6 后松手：mouseup 收尾帧直接 flush 最后坐标。
    document.dispatchEvent(mouse('mousemove'));
    document.dispatchEvent(mouse('mouseup'));
    expect(view.state.selection.main.anchor).toBe(1);
    expect(view.state.selection.main.head).toBe(6);
    expect(document.activeElement).toBe(textarea); // 拖拽结束焦点回输入面。
  });

  it('mouseup 后 document 监听已卸：后续 mousemove 不再改选区', () => {
    const { view, flush, pin } = mount('abcdef');
    pin(0);
    view.contentDOM.dispatchEvent(mouse('mousedown', { detail: 1 }));
    document.dispatchEvent(mouse('mouseup'));
    pin(5);
    document.dispatchEvent(mouse('mousemove'));
    flush();
    expect(view.state.selection.main.head).toBe(0);
    expect(view.state.selection.main.empty).toBe(true);
  });

  it('纯单击（mousedown→mouseup 无 mousemove）：mousedown 仅一次 focus，mouseup 零 focus（I 退化锁）', () => {
    const { view, textarea, pin } = mount('abcdef');
    pin(2);
    const focusSpy = vi.spyOn(textarea, 'focus');
    view.contentDOM.dispatchEvent(mouse('mousedown', { detail: 1 }));
    expect(focusSpy).toHaveBeenCalledTimes(1); // 可信 mousedown 内唯一一次武装。
    document.dispatchEvent(mouse('mouseup')); // 无 mousemove → 纯单击。
    expect(focusSpy).toHaveBeenCalledTimes(1); // mouseup 不得二次 focus（武装命脉）。
    expect(view.state.selection.main.head).toBe(2);
    expect(document.activeElement).toBe(textarea);
    focusSpy.mockRestore();
  });

  it('真拖拽结束：焦点未离 textarea 时 mouseup 不重入 focus（守卫生效）', () => {
    const { view, textarea, flush, pin } = mount('abcdef');
    pin(1);
    const focusSpy = vi.spyOn(textarea, 'focus');
    view.contentDOM.dispatchEvent(mouse('mousedown', { detail: 1 }));
    pin(4);
    document.dispatchEvent(mouse('mousemove')); // 首个 move → 真拖拽。
    flush();
    document.dispatchEvent(mouse('mouseup'));
    // 拖拽全程焦点未离 textarea，守卫 activeElement===textarea 短路补焦：仍仅 mousedown 一次。
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(view.state.selection.main.head).toBe(4);
    focusSpy.mockRestore();
  });

  it('Shift+点击扩展选区，拖拽延续同一 anchor', () => {
    const { view, flush, pin } = mount('abcdefgh');
    view.dispatch({ selection: { anchor: 2 } });
    pin(5);
    view.contentDOM.dispatchEvent(mouse('mousedown', { detail: 1, shiftKey: true }));
    expect(view.state.selection.main.anchor).toBe(2);
    expect(view.state.selection.main.head).toBe(5);

    pin(7); // Shift 点击后继续拖：anchor 不变。
    document.dispatchEvent(mouse('mousemove'));
    flush();
    expect(view.state.selection.main.anchor).toBe(2);
    expect(view.state.selection.main.head).toBe(7);
    document.dispatchEvent(mouse('mouseup'));
  });

  it('双击选词 / 三击选行经手势全链路 dispatch，且不启动拖拽', () => {
    const { view, flush, pin } = mount('hello world\nsecond');
    pin(8);
    view.contentDOM.dispatchEvent(mouse('mousedown', { detail: 2 }));
    expect(view.state.selection.main.anchor).toBe(6);
    expect(view.state.selection.main.head).toBe(11);

    pin(2); // 双击后移动鼠标不应进入拖拽（词粒度拖为后续可选项）。
    document.dispatchEvent(mouse('mousemove'));
    flush();
    expect(view.state.selection.main.anchor).toBe(6);
    expect(view.state.selection.main.head).toBe(11);

    pin(3);
    view.contentDOM.dispatchEvent(mouse('mousedown', { detail: 3 }));
    expect(view.state.selection.main.anchor).toBe(0);
    expect(view.state.selection.main.head).toBe(12); // 整行含 \n。
  });
});
