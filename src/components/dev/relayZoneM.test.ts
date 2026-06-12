import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { installRelayZoneM, relayZoneMExtensions } from './relayZoneM';
import type { RelayDefer } from './textareaRelayM';

/**
 * M 区（textarea 输入中继・K 重做）配对测试。
 *
 * jsdom 不驱动真实 TSF/IME（「IME 武装与否」是 Windows+WebView2 真机验收），本套只锁中继管线契约：
 * 挂载结构（CM 渲染层 + 隐藏 textarea + 落子读数）、焦点独占（textarea 唯一焦点面 + 焦点态类切换）、
 * 非组合 input / compositionend 中继落 CM doc、延迟 reset 与二次组合竞态、keydown 桥 CM6 keymap、
 * 鼠标导流转焦。defer 用手动队列注入，锁定 reset 时序（替代 rAF）。
 */

/** 手动延迟队列：schedule 入队返回 id，flush 统一执行——可断言「reset 延迟/被取消」。 */
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

function mount(doc = '') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: relayZoneMExtensions() }),
  });
  const { defer, flush } = makeDefer();
  const wiring = installRelayZoneM(view, host, defer);
  const textarea = wiring.input as HTMLTextAreaElement;
  cleanups.push(() => {
    wiring.teardown();
    view.destroy();
    host.remove();
  });
  return { view, host, textarea, wiring, flush };
}

describe('installRelayZoneM（挂载与焦点）', () => {
  it('挂载：CM 渲染层（contenteditable=false）+ 隐藏 textarea + 落子读数齐备', () => {
    const { host, textarea } = mount('在此输入中文');
    expect(host.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'false');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('data-relay-m-input');
    expect(host.contains(textarea)).toBe(true);
    // Monaco 式隐藏：1px 宽 + 透明前景，绝非 opacity:0 整面覆盖。
    expect(textarea.style.width).toBe('1px');
    expect(textarea.style.opacity).toBe('');
    expect(textarea.style.color).toBe('transparent');
    expect(textarea.style.zIndex).toBe('-10');
    expect(host.querySelector('[data-relay-m-doc]')?.textContent).toContain('在此输入中文');
  });

  it('teardown 移除 textarea 与读数并还原 host 定位', () => {
    const { host, textarea, wiring } = mount();
    wiring.teardown();
    expect(host.contains(textarea)).toBe(false);
    expect(host.querySelector('[data-relay-m-doc]')).toBeNull();
    expect(host.style.position).toBe('');
  });

  it('textarea 可程序化获焦，焦点态切 .cm-relay-focused 点亮自绘光标', () => {
    const { view, textarea } = mount();
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    expect(view.dom.classList.contains('cm-relay-focused')).toBe(true);
    textarea.blur();
    expect(view.dom.classList.contains('cm-relay-focused')).toBe(false);
  });

  it('mousedown 导流：preventDefault + posAtCoords 置光标 + 转焦 textarea', () => {
    const { view, textarea } = mount('abc');
    // jsdom 无布局，stub posAtCoords 锁定坐标→pos 链路。
    view.posAtCoords = () => 2;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(view.state.selection.main.head).toBe(2);
    expect(document.activeElement).toBe(textarea);
  });
});

describe('installRelayZoneM（事件中继）', () => {
  it('非组合 input：textarea 内容落 CM 选区头并清空', () => {
    const { view, textarea } = mount();
    textarea.value = 'x';
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe('x');
    expect(view.state.selection.main.head).toBe(1);
    expect(textarea.value).toBe('');
    expect(document.querySelector('[data-relay-m-doc]')?.textContent).toContain('x');
  });

  it('组合期 input 不落子；compositionend 取 data 一次性落子，reset 延迟执行', () => {
    const { view, textarea, flush } = mount();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    textarea.value = 'nihao';
    textarea.dispatchEvent(new Event('input')); // 组合期：忽略。
    expect(view.state.doc.toString()).toBe('');

    textarea.value = '你好';
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '你好' }));
    expect(view.state.doc.toString()).toBe('你好');
    expect(textarea.value).toBe('你好'); // reset 延迟：事件循环内不清空（CM5 铁律）。
    flush();
    expect(textarea.value).toBe('');
  });

  it('二次组合竞态：compositionend 后下一组合已到则取消 reset，第二段照常落子', () => {
    const { view, textarea, flush } = mount();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    textarea.value = '你好';
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '你好' }));
    // 未 flush（reset 未执行）即开始第二段组合——reset 必须被取消，不得清空组合中的 textarea。
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    flush();
    expect(textarea.value).toBe('你好'); // reset 已取消。
    textarea.value = '你好中';
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '中' }));
    expect(view.state.doc.toString()).toBe('你好中'); // e.data 优先，残文不双插。
    flush();
    expect(textarea.value).toBe('');
  });

  it('组合残文防双插：compositionend 后 reset 未到即尾随 input，只落新增部分', () => {
    const { view, textarea } = mount();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    textarea.value = '你好';
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '你好' }));
    textarea.value = '你好a'; // reset 未执行，新输入已至（Firefox 类事件序）。
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe('你好a');
    expect(textarea.value).toBe('');
  });

  it('keydown 桥 CM6 keymap：Backspace 删前一字符、Enter 插换行（事件被 preventDefault）', () => {
    const { view, textarea } = mount('ab');
    view.dispatch({ selection: { anchor: 2 } });
    const back = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    textarea.dispatchEvent(back);
    expect(view.state.doc.toString()).toBe('a');
    expect(back.defaultPrevented).toBe(true);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    textarea.dispatchEvent(enter);
    expect(view.state.doc.toString()).toBe('a\n');
  });

  it('keydown 桥 CM6 keymap：方向键移光标；isComposing 键绝不桥（IME 放行）', () => {
    const { view, textarea } = mount('abc');
    view.dispatch({ selection: { anchor: 2 } });
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    expect(view.state.selection.main.head).toBe(1);

    const imeEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
      isComposing: true,
    });
    textarea.dispatchEvent(imeEnter);
    expect(view.state.doc.toString()).toBe('abc'); // 组合中 Enter=选词确认，不动文档。
    expect(imeEnter.defaultPrevented).toBe(false);
  });

  it('teardown 后 input 不再中继', () => {
    const { view, textarea, wiring } = mount();
    wiring.teardown();
    textarea.value = 'late';
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe('');
  });
});
