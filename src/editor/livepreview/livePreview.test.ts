import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { baseExtensions } from '../extensions';
import { inlinePlugin } from './inlinePlugin';

const openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('../../ipc/opener', () => ({
  openExternal: (url: string) => openExternal(url),
}));

const { livePreviewExtensions, renderModeCompartment } = await import('./livePreview');

/**
 * 组合根接线回归门（Pattern 3：行内层 + 块级层 + composingGuard 经一个 Extension[] 共存，EDIT-06 freeze/map）。
 *
 * 断言 livePreviewExtensions() 挂上 inlinePlugin（标题渲染）+ composingGuard（IME 闸门），组合期
 * docChange 经闸门 map 装饰而非重建，compositionend 后强刷恰好重建一次；且 baseExtensions 默认
 * 装入 renderModeCompartment。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

describe('livePreviewExtensions 组合根', () => {
  it('含 inlinePlugin（标题渲染）且组合期经 composingGuard 闸门 map（不重建），compositionend 后强刷重建', async () => {
    view = makeTestView('# H1\n\n正文', [
      extensionsForLanguage('markdown'),
      livePreviewExtensions(),
    ]);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    // inlinePlugin 生效：标题标记被隐藏装饰。
    const decos = view.plugin(inlinePlugin)!.decorations;
    let hiddenAtStart = false;
    const iter = decos.iter();
    while (iter.value) {
      if (iter.from === 0 && (iter.value.spec as { class?: string }).class === 'cm-ink-hidden') {
        hiddenAtStart = true;
      }
      iter.next();
    }
    expect(hiddenAtStart).toBe(true);

    const hasH2 = (): boolean => {
      const set = view!.plugin(inlinePlugin)!.decorations;
      const it = set.iter();
      while (it.value) {
        if ((it.value.spec as { class?: string }).class === 'cm-ink-h2') return true;
        it.next();
      }
      return false;
    };

    // 组合期文首插入新二级标题：composingGuard 冻结 → inlinePlugin map 旧集（不重建），
    // 故 cm-ink-h2 尚未出现（旧装饰仅位移，新结构未被扫描）。
    expect(hasH2()).toBe(false);
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    view.dispatch({ changes: { from: 0, insert: '## 二级\n\n' }, userEvent: 'input.type.compose' });
    expect(hasH2()).toBe(false);

    // compositionend → 推迟的 refreshLivePreview 强刷 → flush 微任务后重建一次，新二级标题得 cm-ink-h2。
    dispatchComposition(view, { phase: 'compositionend', data: '你' });
    await Promise.resolve();
    // 光标移到末行让新二级标题行非活动 → 渲染其字号 class。
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    expect(hasH2()).toBe(true);
  });
});

describe('livePreviewExtensions 含链接手势 linkGesture（D-10）', () => {
  it('Ctrl+mousedown 命中链接经组合根 domEventHandler 调 openExternal', () => {
    openExternal.mockClear();
    view = makeTestView('[t](https://x.com)', [
      extensionsForLanguage('markdown'),
      livePreviewExtensions(),
    ]);
    // jsdom 无布局：钉死 posAtCoords 命中链接内部。
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 1 });

    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    view.contentDOM.dispatchEvent(event);

    expect(openExternal).toHaveBeenCalledWith('https://x.com');
  });
});

describe('baseExtensions 默认 Live Preview（D-02）', () => {
  it('renderModeCompartment 是独立 Compartment 且 baseExtensions 默认挂 livePreviewExtensions', () => {
    view = makeTestView('# H1\n\n正文', baseExtensions('markdown'));
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    // 打开 Markdown 默认即渲染：inlinePlugin 已生效（标题标记隐藏装饰存在）。
    const decos = view.plugin(inlinePlugin)?.decorations;
    expect(decos).toBeDefined();
    expect(decos!.size).toBeGreaterThan(0);
  });

  it('renderModeCompartment.get 取回当前装饰扩展（compartment 已挂载，Plan 04 可热切）', () => {
    view = makeTestView('# H1', baseExtensions('markdown'));
    // compartment 已在 state 中登记（reconfigure 句柄就绪，供 Plan 04 setRenderMode）。
    expect(renderModeCompartment.get(view.state)).toBeDefined();
  });
});
