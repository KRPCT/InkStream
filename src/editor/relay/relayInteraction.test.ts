import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { closeSearchPanel, openSearchPanel } from '@codemirror/search';
import { isComposing } from '../composition';
import { baseExtensions } from '../extensions';
import { TaskCheckboxWidget } from '../livepreview/widgets/TaskCheckboxWidget';
import { installRelayController } from './relayController';

/**
 * 中继 × 装饰交互矩阵（PROD-RELAY-DESIGN §2.6 / Wave 2 验收矩阵）：三装饰手势在中继下
 * 仍工作（复选框翻转 / Ctrl+链接 / 表格穿透），每项断言「动作正确 + 焦点终落 textarea +
 * 光标符合预期」；search 面板关闭回焦；组合中途点击 blur-commit；focus net 对未消费的
 * 原生可聚焦控件放行（Wave 1 遗留 ② 收口）。
 */

const openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('../../ipc/opener', () => ({
  openExternal: (url: string) => openExternal(url),
}));

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});
beforeEach(() => {
  openExternal.mockClear();
});

/** 生产形态挂载（baseExtensions 全量 + 控制器）+ posAtCoords 钉桩。 */
function mount(doc = '') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: baseExtensions('markdown') }),
  });
  const teardown = installRelayController(view, host);
  const textarea = host.querySelector('[data-relay-input]') as HTMLTextAreaElement;
  let pinned: number | null = null;
  Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => pinned });
  cleanups.push(() => {
    teardown();
    view.destroy();
    host.remove();
  });
  return { view, textarea, pin: (p: number | null) => void (pinned = p) };
}

function mouse(init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init });
}

describe('装饰点击矩阵（中继下三手势仍工作）', () => {
  it('TaskCheckbox：点击翻转 [ ]→[x]，光标不动，焦点兜底回 textarea', () => {
    const { view, textarea, pin } = mount('- [ ] 任务');
    pin(3); // 即便手势链取 pos 也不该被用到（defaultPrevented 守卫先拦）。
    const dom = new TaskCheckboxWidget(false, 2).toDOM(view);
    view.contentDOM.appendChild(dom);

    dom.dispatchEvent(mouse());
    expect(view.state.doc.toString()).toBe('- [x] 任务'); // widget 自身 dispatch 翻转。
    expect(view.state.selection.main.head).toBe(0); // relayGesture defaultPrevented 守卫：不移光标。
    expect(document.activeElement).toBe(textarea); // focus net 兜底回焦。
  });

  it('linkGesture：Ctrl+点击外链 → openExternal 导航，选区不动，焦点回 textarea', () => {
    const { view, textarea, pin } = mount('[text](https://x.com)');
    pin(2);
    view.contentDOM.dispatchEvent(mouse({ ctrlKey: true }));

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://x.com');
    expect(view.state.selection.main.head).toBe(0); // linkGesture 返回 true 短路 relayGesture。
    expect(document.activeElement).toBe(textarea);
  });

  it('tableGesture：点击表格穿透置光标进块，焦点回 textarea 立即可打字', () => {
    const doc = ['正文', '', '| a | b |', '| - | - |', '| 1 | 2 |'].join('\n');
    const from = doc.indexOf('| a | b |');
    const to = doc.length;
    const { view, textarea, pin } = mount(doc);
    pin(from + 2);
    view.contentDOM.dispatchEvent(mouse());

    const head = view.state.selection.main.head;
    expect(head).toBeGreaterThanOrEqual(from + 1); // 程序化置光标进块 [from+1, to]。
    expect(head).toBeLessThanOrEqual(to);
    expect(document.activeElement).toBe(textarea);
  });

  it('focus net 放行：未被 widget 消费的原生可聚焦控件不抢焦点（就地编辑前向兼容）', () => {
    const { view, textarea } = mount('正文');
    const input = document.createElement('input');
    view.scrollDOM.appendChild(input);

    const ev = mouse();
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // 放行浏览器默认聚焦。
    expect(document.activeElement).not.toBe(textarea);

    const consumed = mouse();
    consumed.preventDefault(); // widget 已自收（复选框纪律）→ 仍兜底回焦。
    input.dispatchEvent(consumed);
    expect(document.activeElement).toBe(textarea);
  });
});

describe('search 面板关闭回焦（§2.2 风险项收口）', () => {
  it('开面板 → 关面板：焦点补落 textarea（search 内部 view.focus 在 editable=false 下失效）', async () => {
    const { view, textarea } = mount('hello');
    openSearchPanel(view);
    expect(view.dom.querySelector('.cm-search')).not.toBeNull();

    closeSearchPanel(view);
    await new Promise((r) => setTimeout(r, 0)); // 回焦排在 search 内部 focus 之后（微任务）。
    expect(document.activeElement).toBe(textarea);
  });

  it('焦点在编辑器外（文件树等）时程序化关面板不抢焦点', async () => {
    const { view } = mount('hello');
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    cleanups.push(() => outside.remove());

    openSearchPanel(view);
    outside.focus();
    closeSearchPanel(view);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(outside);
  });
});

describe('组合中途点击（blur-commit，§2.5 风险对策）', () => {
  it('组合期点击别处：先按旧选区提交组合，再置点击光标，焦点回 textarea', () => {
    const { view, textarea, pin } = mount('');
    textarea.focus();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    textarea.value = '你好';
    expect(isComposing(view)).toBe(true);

    pin(1); // 点击落点（提交后 doc='你好'，pos=1 合法）。
    view.contentDOM.dispatchEvent(mouse({ detail: 1 }));

    expect(view.state.doc.toString()).toBe('你好'); // 组合按旧选区（0）正确落子。
    expect(isComposing(view)).toBe(false); // 冻结门解除，无死冻结。
    expect(view.state.selection.main.head).toBe(1); // 点击光标在提交后的 doc 上生效。
    expect(textarea.value).toBe(''); // 强制提交路径已清空，不残留双插源。
    expect(document.activeElement).toBe(textarea);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); // 收尾拖拽监听。
  });
});
