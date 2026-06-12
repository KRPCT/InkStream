import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  installContentEditableFlip,
  installFocusCycle,
  installTextareaRelay,
} from './imeMitigations';

/**
 * I/J/K 候选解法核心逻辑配对测试（R3 验证台）。
 *
 * jsdom 不驱动真实 TSF/IME（无「首次组合吞字」语义），故本套不验「缓解是否真让首次拼音成功」（那是手动
 * Windows+WebView2 验收）；只锁工程契约：
 *   I 焦点循环——focus 后微任务内 blur+focus 各一次、不递归；自然失焦重新武装。
 *   J ce 翻转——focus 后微任务内 contentEditable false→true 翻转一次、补 focus、不递归。
 *   K textarea 中继——非组合 input 落 CM doc + 清空 textarea；合成 compositionend 落 doc + 清空；
 *                      空 textarea Backspace 删 CM 前一字符；Enter 插换行；方向键移光标。
 */

/** 同步调度器：把「微任务后执行一次」立即跑，便于断言调用次数（替代 queueMicrotask）。 */
const runNow = (task: () => void) => task();

function makeView(doc = ''): EditorView {
  // parent 接 document.body：contentDOM 必须真正 in-document 才能持有焦点（jsdom focus 语义）。
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc }) });
  return view;
}

let views: EditorView[] = [];
afterEach(() => {
  for (const v of views) v.destroy();
  views = [];
});

function track(view: EditorView): EditorView {
  views.push(view);
  return view;
}

describe('installFocusCycle（I 焦点循环缓解）', () => {
  it('focus 后微任务内 blur+focus 各调一次，不递归', () => {
    const view = track(makeView());
    const dom = view.contentDOM;
    const blurSpy = vi.spyOn(dom, 'blur');
    const focusSpy = vi.spyOn(dom, 'focus');

    const detach = installFocusCycle(view, runNow);
    dom.dispatchEvent(new FocusEvent('focus'));

    // 牺牲性循环：恰好 blur 一次 + focus 一次（cycling 标志吞掉循环自身再触发的 focus，不递归）。
    expect(blurSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    detach();
  });

  it('同一焦点会话只循环一次（重复 focus 事件不再触发）', () => {
    const view = track(makeView());
    const dom = view.contentDOM;
    const blurSpy = vi.spyOn(dom, 'blur');

    const detach = installFocusCycle(view, runNow);
    dom.dispatchEvent(new FocusEvent('focus'));
    dom.dispatchEvent(new FocusEvent('focus')); // 同会话第二次 focus：armed 已解除，no-op。

    expect(blurSpy).toHaveBeenCalledTimes(1);
    detach();
  });

  it('自然失焦后重新武装，下次获得焦点再循环一次', () => {
    const view = track(makeView());
    const dom = view.contentDOM;
    const blurSpy = vi.spyOn(dom, 'blur');

    const detach = installFocusCycle(view, runNow);
    dom.dispatchEvent(new FocusEvent('focus'));
    expect(blurSpy).toHaveBeenCalledTimes(1);

    dom.dispatchEvent(new FocusEvent('blur')); // 真实失焦 → 重新武装。
    dom.dispatchEvent(new FocusEvent('focus'));
    expect(blurSpy).toHaveBeenCalledTimes(2);
    detach();
  });

  it('cleanup 后 focus 不再触发循环', () => {
    const view = track(makeView());
    const dom = view.contentDOM;
    const blurSpy = vi.spyOn(dom, 'blur');

    const detach = installFocusCycle(view, runNow);
    detach();
    dom.dispatchEvent(new FocusEvent('focus'));
    expect(blurSpy).not.toHaveBeenCalled();
  });
});

describe('installContentEditableFlip（J contenteditable 翻转缓解）', () => {
  it('focus 后微任务内把 contentEditable 翻 false→true 一次并补 focus，不递归', () => {
    const view = track(makeView());
    const dom = view.contentDOM;
    const focusSpy = vi.spyOn(dom, 'focus');
    const values: string[] = [];
    // 拦截 contentEditable 赋值记录翻转序列（原型 setter 仍执行，DOM 真实翻转）。
    const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable');
    Object.defineProperty(dom, 'contentEditable', {
      configurable: true,
      get: () => proto?.get?.call(dom),
      set: (v: string) => {
        values.push(v);
        proto?.set?.call(dom, v);
      },
    });

    const detach = installContentEditableFlip(view, runNow);
    dom.dispatchEvent(new FocusEvent('focus'));

    expect(values).toEqual(['false', 'true']); // 恰好翻一轮，终态 'true'（序列末位）。
    expect(focusSpy).toHaveBeenCalledTimes(1); // 翻转丢焦点后补一次 focus。
    detach();
  });

  it('同一焦点会话只翻一次；自然失焦后重新武装', () => {
    const view = track(makeView());
    const dom = view.contentDOM;
    const focusSpy = vi.spyOn(dom, 'focus');

    const detach = installContentEditableFlip(view, runNow);
    dom.dispatchEvent(new FocusEvent('focus'));
    dom.dispatchEvent(new FocusEvent('focus')); // 同会话第二次：no-op。
    expect(focusSpy).toHaveBeenCalledTimes(1);

    dom.dispatchEvent(new FocusEvent('blur')); // 重新武装。
    dom.dispatchEvent(new FocusEvent('focus'));
    expect(focusSpy).toHaveBeenCalledTimes(2);
    detach();
  });
});

describe('installTextareaRelay（K textarea 中继 MVP）', () => {
  function setup(doc = '') {
    const view = track(makeView(doc));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const detach = installTextareaRelay(view, textarea);
    return { view, textarea, detach };
  }

  it('非组合期 input：textarea 内容落入 CM 选区头并清空 textarea', () => {
    const { view, textarea, detach } = setup();
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input'));

    expect(view.state.doc.toString()).toBe('hello');
    expect(view.state.selection.main.head).toBe(5); // 光标移到插入文本之后。
    expect(textarea.value).toBe(''); // 落子后清空。
    detach();
  });

  it('组合期 input 不动 CM；compositionend 一次性落 doc 并清空', () => {
    const { view, textarea, detach } = setup();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    textarea.value = 'ce'; // 拼音码（组合中），不应落 CM。
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe(''); // 组合期 input 被忽略。

    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '测试' }));
    expect(view.state.doc.toString()).toBe('测试'); // compositionend 一次性落子。
    expect(textarea.value).toBe('');
    detach();
  });

  it('compositionend data 为空时退回 textarea.value 落子', () => {
    const { view, textarea, detach } = setup();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    textarea.value = '你好';
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));

    expect(view.state.doc.toString()).toBe('你好');
    expect(textarea.value).toBe('');
    detach();
  });

  it('Backspace 且 textarea 空：删 CM 光标前一字符', () => {
    const { view, textarea, detach } = setup('abc');
    view.dispatch({ selection: { anchor: 3 } }); // 光标置末尾。
    textarea.value = '';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));

    expect(view.state.doc.toString()).toBe('ab');
    expect(view.state.selection.main.head).toBe(2);
    detach();
  });

  it('文档头 Backspace 为 no-op（不越界）', () => {
    const { view, textarea, detach } = setup('x');
    view.dispatch({ selection: { anchor: 0 } });
    textarea.value = '';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));

    expect(view.state.doc.toString()).toBe('x');
    detach();
  });

  it('Enter（非组合）插入换行；isComposing 时不桥', () => {
    const { view, textarea, detach } = setup('a');
    view.dispatch({ selection: { anchor: 1 } });
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(view.state.doc.toString()).toBe('a\n');

    // 组合中的 Enter（IME 选词确认）放行给 IME，不插换行。
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    expect(view.state.doc.toString()).toBe('a\n');
    detach();
  });

  it('方向键左右移 CM 光标（clamp 到边界）', () => {
    const { view, textarea, detach } = setup('abc');
    view.dispatch({ selection: { anchor: 2 } });

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(view.state.selection.main.head).toBe(1);

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(view.state.selection.main.head).toBe(3); // clamp 到 doc.length。
    detach();
  });

  it('cleanup 后 textarea input 不再中继', () => {
    const { view, textarea, detach } = setup();
    detach();
    textarea.value = 'late';
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe('');
  });
});
