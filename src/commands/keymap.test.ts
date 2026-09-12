import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { bind, dispose, init, normalizeEvent } from './keymap';
import { hydrate } from './mru';
import { register } from './registry';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { setView } from '../editor/viewHandle';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';

const disposers: Array<() => void> = [];

function key(initDict: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const { keyCode, ...rest } = initDict;
  const e = new KeyboardEvent('keydown', { cancelable: true, ...rest });
  if (keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: keyCode });
  return e;
}

describe('normalizeEvent', () => {
  it('Ctrl+Shift+P 归一为 "Ctrl+Shift+P"（单字符 key 大写）', () => {
    expect(normalizeEvent(key({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+P');
    expect(normalizeEvent(key({ key: 'b', ctrlKey: true }))).toBe('Ctrl+B');
    expect(normalizeEvent(key({ key: 'b', ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+B');
  });

  it('纯修饰键事件返回 null', () => {
    expect(normalizeEvent(key({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(normalizeEvent(key({ key: 'Shift', shiftKey: true }))).toBeNull();
  });
});

describe('keymap 分发', () => {
  let run: Mock<() => void>;

  beforeEach(() => {
    hydrate([]);
    run = vi.fn();
    disposers.push(register({ id: 'test.toggle', title: '测试：切换', run }));
    disposers.push(bind('Ctrl+B', 'test.toggle'));
    init();
  });

  afterEach(() => {
    dispose();
    while (disposers.length) disposers.pop()!();
  });

  it('绑定组合触发 execute 并 preventDefault', () => {
    const e = key({ key: 'b', ctrlKey: true });
    window.dispatchEvent(e);
    expect(run).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('isComposing 事件直接短路不分发', () => {
    window.dispatchEvent(key({ key: 'b', ctrlKey: true, isComposing: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it('keyCode 229 事件直接短路不分发', () => {
    window.dispatchEvent(key({ key: 'b', ctrlKey: true, keyCode: 229 }));
    expect(run).not.toHaveBeenCalled();
  });

  it('未绑定组合不拦截默认行为', () => {
    const e = key({ key: 'k', ctrlKey: true });
    window.dispatchEvent(e);
    expect(run).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('解绑后不再触发', () => {
    disposers.pop()!();
    window.dispatchEvent(key({ key: 'b', ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it('dispose 卸载监听后绑定不再生效', () => {
    dispose();
    window.dispatchEvent(key({ key: 'b', ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe('editing shortcuts stay with the surface receiving the key', () => {
  let view: EditorView;
  let run: Mock<() => void>;
  beforeEach(() => {
    useWorkbenchStore.setState({ centralView: 'editor' });
    view = new EditorView({ state: EditorState.create({ doc: 'Original document' }) });
    document.body.appendChild(view.dom);
    setView(view);
    run = vi.fn();
    disposers.push(register({ id: 'edit.copy', title: 'Copy', run }));
    disposers.push(bind('Ctrl+C', 'edit.copy'));
    init();
  });
  afterEach(() => {
    dispose();
    while (disposers.length) disposers.pop()!();
    setView(null); view.destroy(); view.dom.remove();
    useWorkbenchStore.setState({ centralView: 'editor' });
  });

  it.each(['input', 'textarea', 'select', 'contenteditable'])('%s keeps its native copy without redirecting to the document', (kind) => {
    const input = document.createElement(kind === 'contenteditable' ? 'div' : kind);
    if (kind === 'contenteditable') input.setAttribute('contenteditable', 'true');
    document.body.appendChild(input);
    const event = key({ key: 'c', ctrlKey: true, bubbles: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    input.remove();
  });

  it('comparison selection keeps copy and find while the hidden document receives neither command', () => {
    disposers.push(register({ id: 'edit.find', title: 'Find', run }));
    disposers.push(bind('Ctrl+F', 'edit.find'));
    const comparison = new EditorView({ state: EditorState.create({ doc: 'Compared revision', extensions: [EditorState.readOnly.of(true)] }) });
    document.body.appendChild(comparison.dom);
    useWorkbenchStore.setState({ centralView: 'gitGraph' });
    try {
      for (const keyName of ['c', 'f']) {
        const event = key({ key: keyName, ctrlKey: true, bubbles: true });
        comparison.contentDOM.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(run).not.toHaveBeenCalled();
    } finally { comparison.destroy(); comparison.dom.remove(); }
  });

  it('the main editor still receives its unhandled command shortcut', () => {
    const event = key({ key: 'c', ctrlKey: true, bubbles: true });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
