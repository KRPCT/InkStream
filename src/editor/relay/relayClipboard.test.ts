import { afterEach, describe, expect, it, vi } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEditorStore } from '../../stores/useEditorStore';
import { doPaste } from '../editCommands';
import { baseExtensions } from '../extensions';
import { setView } from '../viewHandle';
import { clipboardText, relayPasteFromClipboard, relayPasteText } from './relayClipboard';
import { installRelayController } from './relayController';

/**
 * 中继剪贴板 + 撤销粒度配对测试（PROD-RELAY-DESIGN §2.8/§2.9 / Wave 3）。
 *
 * 焦点在隐藏 textarea、CM doc 持选区——锁 copy/cut/paste 三事件从 doc 取/写文本、行级复制、
 * 智能粘贴白名单、navigator.clipboard 菜单降级，以及 history 撤销分组（连续输入合并、
 * 粘贴/剪切独立成组）。jsdom 不提供 DataTransfer，构造满足 handler 读写契约的最小事件。
 */

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
  useEditorStore.setState({ isRichtext: false });
  vi.unstubAllGlobals();
});

function mount(doc = '') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: baseExtensions('markdown') }),
  });
  const teardown = installRelayController(view, host);
  setView(view); // doPaste/菜单命令经 getView() 取单内核 view。
  const textarea = host.querySelector('[data-relay-input]') as HTMLTextAreaElement;
  cleanups.push(() => {
    teardown();
    setView(null);
    view.destroy();
    host.remove();
  });
  return { view, textarea };
}

/** 最小 ClipboardEvent（jsdom 无 DataTransfer）：text/plain 读写 + preventDefault。 */
function clipboardEvent(type: string, data = ''): { evt: ClipboardEvent; read: () => string } {
  const store: Record<string, string> = { 'text/plain': data };
  const evt = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(evt, 'clipboardData', {
    configurable: true,
    value: {
      getData: (t: string) => store[t] ?? '',
      setData: (t: string, v: string) => void (store[t] = v),
    },
  });
  return { evt, read: () => store['text/plain'] };
}

describe('clipboardText（取复制文本）', () => {
  it('有选区取选区文本', () => {
    const { view } = mount('hello world');
    view.dispatch({ selection: EditorSelection.range(6, 11) });
    expect(clipboardText(view)).toBe('world');
  });

  it('空选区取整行 + 换行（行级复制，对齐 CM/VSCode）', () => {
    const { view } = mount('第一行\n第二行');
    view.dispatch({ selection: EditorSelection.cursor(1) });
    expect(clipboardText(view)).toBe('第一行\n');
  });
});

describe('installRelayClipboard（textarea 三事件接管）', () => {
  it('copy：写 CM 选区文本到剪贴板，preventDefault，doc 不变', () => {
    const { view, textarea } = mount('风急天高');
    view.dispatch({ selection: EditorSelection.range(0, 2) });
    const { evt, read } = clipboardEvent('copy');
    textarea.dispatchEvent(evt);
    expect(read()).toBe('风急');
    expect(evt.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe('风急天高');
  });

  it('cut：写剪贴板 + 删除选区（delete.cut），光标归 from', () => {
    const { view, textarea } = mount('hello world');
    view.dispatch({ selection: EditorSelection.range(6, 11) });
    const { evt, read } = clipboardEvent('cut');
    textarea.dispatchEvent(evt);
    expect(read()).toBe('world');
    expect(view.state.doc.toString()).toBe('hello ');
    expect(view.state.selection.main.head).toBe(6);
  });

  it('cut 空选区：剪整行（含行尾换行）', () => {
    const { view, textarea } = mount('上行\n下行');
    view.dispatch({ selection: EditorSelection.cursor(1) });
    const { evt, read } = clipboardEvent('cut');
    textarea.dispatchEvent(evt);
    expect(read()).toBe('上行\n');
    expect(view.state.doc.toString()).toBe('下行');
  });

  it('paste：剪贴板文本 dispatch 进 doc 当前选区，替换选中', () => {
    const { view, textarea } = mount('ab');
    view.dispatch({ selection: EditorSelection.range(0, 1) });
    const { evt } = clipboardEvent('paste', 'XY');
    textarea.dispatchEvent(evt);
    expect(view.state.doc.toString()).toBe('XYb');
    expect(view.state.selection.main.head).toBe(2);
  });
});

describe('relayPasteText（智能粘贴白名单）', () => {
  it('richtext 文档 + URL + 有选区 → 包成 [选区](URL)', () => {
    const { view } = mount('go here');
    useEditorStore.setState({ isRichtext: true });
    view.dispatch({ selection: EditorSelection.range(3, 7) });
    relayPasteText(view, 'https://example.com');
    expect(view.state.doc.toString()).toBe('go [here](https://example.com)');
  });

  it('非 richtext 文档：URL 按纯文本落子（白名单不激活）', () => {
    const { view } = mount('go here');
    view.dispatch({ selection: EditorSelection.range(3, 7) });
    relayPasteText(view, 'https://example.com');
    expect(view.state.doc.toString()).toBe('go https://example.com');
  });

  it('richtext 文档但无选区：URL 纯文本插入（智能粘贴只处理有选区）', () => {
    const { view } = mount('');
    useEditorStore.setState({ isRichtext: true });
    relayPasteText(view, 'https://example.com');
    expect(view.state.doc.toString()).toBe('https://example.com');
  });
});

describe('relayPasteFromClipboard（菜单粘贴降级 navigator.clipboard）', () => {
  it('readText 成功 → 落子', async () => {
    const { view } = mount('');
    vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.resolve('从剪贴板') } });
    await relayPasteFromClipboard(view);
    expect(view.state.doc.toString()).toBe('从剪贴板');
  });

  it('readText 抛错（无权限/无 API）→ 静默不落子', async () => {
    const { view } = mount('原文');
    vi.stubGlobal('navigator', {
      clipboard: { readText: () => Promise.reject(new Error('denied')) },
    });
    await relayPasteFromClipboard(view);
    expect(view.state.doc.toString()).toBe('原文');
  });
});

describe('doPaste 菜单命令（中继路径 §2.8）', () => {
  it('接线在册 → 走 navigator.clipboard.readText，旁路 execCommand("paste")', async () => {
    const { view } = mount('');
    const readText = vi.fn(() => Promise.resolve('菜单粘贴'));
    vi.stubGlobal('navigator', { clipboard: { readText } });
    // jsdom 无 execCommand：装一个桩证明中继路径完全旁路它。
    const execSpy = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execSpy });
    doPaste();
    await Promise.resolve();
    await Promise.resolve();
    expect(readText).toHaveBeenCalledTimes(1);
    expect(execSpy).not.toHaveBeenCalled(); // WebView2 禁 execCommand('paste')，已旁路。
    expect(view.state.doc.toString()).toBe('菜单粘贴');
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });
});

describe('撤销粒度（§2.9：userEvent 决定 history 分组）', () => {
  /** 经 textarea input 中继连续键入（每次 onInput → relayInsert 'input.type'）。 */
  function type(textarea: HTMLTextAreaElement, chars: string[]): void {
    for (const c of chars) {
      textarea.value = c;
      textarea.dispatchEvent(new Event('input'));
    }
  }

  it('连续输入相邻 input.type 合并：abc 一次撤销全消', () => {
    const { view, textarea } = mount('');
    type(textarea, ['a', 'b', 'c']);
    expect(view.state.doc.toString()).toBe('abc');
    undo(view);
    expect(view.state.doc.toString()).toBe('');
  });

  it('粘贴 input.paste 独立成组：不与前序键入合并', () => {
    const { view, textarea } = mount('');
    type(textarea, ['a', 'b']);
    const { evt } = clipboardEvent('paste', 'XY');
    textarea.dispatchEvent(evt);
    expect(view.state.doc.toString()).toBe('abXY');
    undo(view); // 撤一次只回退粘贴。
    expect(view.state.doc.toString()).toBe('ab');
    undo(view); // 再撤回退键入组。
    expect(view.state.doc.toString()).toBe('');
  });

  it('剪切 delete.cut 独立成组：撤销恢复被剪文本', () => {
    const { view, textarea } = mount('hello world');
    view.dispatch({ selection: EditorSelection.range(6, 11) });
    textarea.dispatchEvent(clipboardEvent('cut').evt);
    expect(view.state.doc.toString()).toBe('hello ');
    undo(view);
    expect(view.state.doc.toString()).toBe('hello world');
  });
});
