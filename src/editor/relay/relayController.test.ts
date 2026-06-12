import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions } from '../extensions';
import { installRelayController } from './relayController';
import { focusEditor, getRelayInput, relayNotifySwap } from './relayFocus';

/**
 * 视图级中继接线配对测试（PROD-RELAY-DESIGN §1.1/§2.2/§2.3）。
 *
 * 生产形态：view 用 baseExtensions 全量（relayState 状态级四件套在册）+ installRelayController
 * 视图级接线——锁挂载结构（editable=false + 隐藏 textarea）、单击置光标/焦点导流、focus net
 * 兜底回焦、.cm-relay-focused 焦点态、focusEditor 单出口、teardown 配对。
 */

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
    state: EditorState.create({ doc, extensions: baseExtensions('markdown') }),
  });
  const teardown = installRelayController(view, host);
  const textarea = host.querySelector('[data-relay-input]') as HTMLTextAreaElement;
  cleanups.push(() => {
    teardown();
    view.destroy();
    host.remove();
  });
  return { view, host, textarea, teardown };
}

describe('installRelayController（挂载与焦点态）', () => {
  it('挂载：contentDOM 只读（editable=false）+ Monaco 式隐藏 textarea', () => {
    const { host, textarea } = mount('正文');
    expect(host.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
    expect(textarea).not.toBeNull();
    expect(textarea.tagName).toBe('TEXTAREA');
    // 隐藏 = 1px 宽 + 透明前景 + z-index:-10，绝非 opacity:0 整面覆盖（K 根因 4）。
    expect(textarea.style.width).toBe('1px');
    expect(textarea.style.opacity).toBe('');
    expect(textarea.style.color).toBe('transparent');
    expect(textarea.style.zIndex).toBe('-10');
    expect(host.style.position).toBe('relative');
  });

  it('textarea focus/blur 切 .cm-relay-focused（drawSelection 光标点亮态）', () => {
    const { view, textarea } = mount();
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    expect(view.dom.classList.contains('cm-relay-focused')).toBe(true);
    textarea.blur();
    expect(view.dom.classList.contains('cm-relay-focused')).toBe(false);
  });

  it('relayGesture：单击 preventDefault + posAtCoords 置光标 + 转焦 textarea', () => {
    const { view, textarea } = mount('abc');
    view.posAtCoords = () => 2; // jsdom 无布局，stub 坐标→pos 链路。
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(view.state.selection.main.head).toBe(2);
    expect(document.activeElement).toBe(textarea);
  });

  it('focus net：posAtCoords 命中失败（手势弃权）仍兜底回焦 textarea', () => {
    const { view, textarea } = mount('abc');
    view.posAtCoords = (() => null) as unknown as typeof view.posAtCoords;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(ev);
    expect(document.activeElement).toBe(textarea);
    expect(ev.defaultPrevented).toBe(true); // 阻止浏览器默认焦点转移。
  });

  it('focus net：widget 已 preventDefault（复选框纪律）→ 光标不动但焦点收回', () => {
    const { view, textarea } = mount('abc');
    view.posAtCoords = () => 2;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    ev.preventDefault(); // 模拟 TaskCheckbox widget 自收 mousedown。
    view.contentDOM.dispatchEvent(ev);
    expect(view.state.selection.main.head).toBe(0); // defaultPrevented 守卫：不移光标。
    expect(document.activeElement).toBe(textarea); // 兜底回焦。
  });
});

describe('relayFocus（单出口与换装通知）', () => {
  it('focusEditor：接线在册时聚焦 textarea（程序化即武装，探针 A 路径）', () => {
    const { view, textarea } = mount();
    focusEditor(view);
    expect(document.activeElement).toBe(textarea);
    expect(getRelayInput(view)).toBe(textarea);
  });

  it('relayNotifySwap 不抛错（jsdom 无布局时 syncCaret 静默）', () => {
    const { view } = mount('abc');
    expect(() => relayNotifySwap(view)).not.toThrow();
  });

  it('teardown：textarea 移除、注册表清除、input 不再中继、host 定位还原', () => {
    const { view, host, textarea, teardown } = mount();
    teardown();
    expect(host.contains(textarea)).toBe(false);
    expect(getRelayInput(view)).toBeNull();
    expect(host.style.position).toBe('');
    textarea.value = 'late';
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe('');
    expect(() => focusEditor(view)).not.toThrow(); // 回退 view.focus() 路径不炸。
  });
});
