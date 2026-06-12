import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isComposing, queueAfterComposition } from '../composition';
import { baseExtensions } from '../extensions';
import { createRelayTextarea, installRelayInput, type RelayDefer } from './textareaRelay';

/**
 * 生产中继核心配对测试（平移 relayZoneM.test.ts 范式，PROD-RELAY-DESIGN §5）。
 *
 * jsdom 不驱动真实 TSF/IME（IME 武装与否是 Windows+WebView2 真机验收），本套锁中继管线契约：
 * 非组合 input / compositionend 中继落 CM doc、延迟 reset 与二次组合竞态、keydown 桥生产
 * keymap（baseExtensions 全量在册）、组合态喂统一冻结门（setRelayComposing → isComposing/
 * queueAfterComposition 排队语义）。defer 用手动队列注入锁 reset 时序（替代 rAF）。
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

/** 生产形态挂载：baseExtensions 全量（含 relayState/keymap/livePreview）+ 中继输入接线。 */
function mount(doc = '') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: baseExtensions('markdown') }),
  });
  const textarea = createRelayTextarea(view);
  host.appendChild(textarea);
  const { defer, flush } = makeDefer();
  const detach = installRelayInput(view, textarea, defer);
  cleanups.push(() => {
    detach();
    view.destroy();
    host.remove();
  });
  return { view, textarea, flush, detach };
}

describe('installRelayInput（事件中继）', () => {
  it('非组合 input：textarea 内容落 CM 选区头并清空', () => {
    const { view, textarea } = mount();
    textarea.value = 'x';
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe('x');
    expect(view.state.selection.main.head).toBe(1);
    expect(textarea.value).toBe('');
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
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    flush();
    expect(textarea.value).toBe('你好'); // reset 已取消，不打断新组合。
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

  it('keydown 桥生产 keymap：Backspace/Enter 生效且 preventDefault；IME 键放行', () => {
    const { view, textarea } = mount('ab');
    view.dispatch({ selection: { anchor: 2 } });
    const back = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    textarea.dispatchEvent(back);
    expect(view.state.doc.toString()).toBe('a');
    expect(back.defaultPrevented).toBe(true);

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(view.state.doc.toString()).toBe('a\n');

    const imeEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
      isComposing: true,
    });
    textarea.dispatchEvent(imeEnter);
    expect(view.state.doc.toString()).toBe('a\n'); // 组合中 Enter=选词确认，不动文档。
    expect(imeEnter.defaultPrevented).toBe(false);
  });

  it('keydown 桥：Ctrl+Z 撤销（historyKeymap 在 baseExtensions 内自然覆盖）', () => {
    const { view, textarea } = mount();
    textarea.value = 'x';
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe('x');
    const undoKey = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
    textarea.dispatchEvent(undoKey);
    expect(view.state.doc.toString()).toBe('');
    expect(undoKey.defaultPrevented).toBe(true);
  });
});

describe('installRelayInput（统一冻结门喂源，setRelayComposing）', () => {
  it('compositionstart → isComposing 翻 true；compositionend → 同步归 false', () => {
    const { view, textarea } = mount();
    expect(isComposing(view)).toBe(false);
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    expect(isComposing(view)).toBe(true);
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '好' }));
    expect(isComposing(view)).toBe(false);
  });

  it('组合期 queueAfterComposition 排队；compositionend 后 drain，任务执行时落子已就位', async () => {
    const { view, textarea } = mount();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    let seenDoc: string | null = null;
    queueAfterComposition(view, 'swap:test', () => {
      seenDoc = view.state.doc.toString();
    });
    expect(seenDoc).toBeNull(); // 组合期挂起，不立即执行。

    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '你好' }));
    expect(view.state.doc.toString()).toBe('你好'); // 落子同步完成。
    await Promise.resolve(); // drain 微任务。
    expect(seenDoc).toBe('你好'); // 排队任务在落子之后执行（§2.5 固定序）。
  });

  it('卸载不留死冻结：组合中 teardown 后 isComposing 归 false', () => {
    const { view, textarea, detach } = mount();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    expect(isComposing(view)).toBe(true);
    detach();
    expect(isComposing(view)).toBe(false);
    textarea.value = 'late';
    textarea.dispatchEvent(new Event('input'));
    expect(view.state.doc.toString()).toBe(''); // teardown 后不再中继。
  });
});
