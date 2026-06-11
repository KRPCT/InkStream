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
 * 组合根接线回归门（Pattern 3：行内层 + 块级层经一个 Extension[] 共存生效，EDIT-06 Option 1）。
 *
 * 断言 livePreviewExtensions() 挂上 inlinePlugin（标题渲染），组合期 docChange 照常规范重建
 * （不再有自建 IME 闸门——CM6 6.43.1 内置合成保护），且 baseExtensions 默认装入 renderModeCompartment。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

describe('livePreviewExtensions 组合根', () => {
  it('含 inlinePlugin（标题渲染）且组合 docChange 照常规范重建（Option 1：无自建 IME 闸门）', () => {
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

    // Option 1：组合 userEvent 的 docChange 与普通输入一样规范重建——文首插入新二级标题后，
    // 装饰层立即产出其 cm-ink-h2 行级 class（若仍有冻结闸门则不会出现）。
    const hasH2 = (): boolean => {
      const set = view!.plugin(inlinePlugin)!.decorations;
      const it = set.iter();
      while (it.value) {
        if ((it.value.spec as { class?: string }).class === 'cm-ink-h2') return true;
        it.next();
      }
      return false;
    };
    expect(hasH2()).toBe(false);
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    view.dispatch({ changes: { from: 0, insert: '## 二级\n\n' }, userEvent: 'input.type.compose' });
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
