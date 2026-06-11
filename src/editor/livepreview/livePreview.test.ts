import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { baseExtensions } from '../extensions';
import { inlinePlugin } from './inlinePlugin';
import { livePreviewExtensions, renderModeCompartment } from './livePreview';

/**
 * 组合根接线回归门（Pattern 3：行内层 + IME 闸门经一个 Extension[] 共存生效）。
 *
 * 断言 livePreviewExtensions() 同时挂上 inlinePlugin（标题渲染）与 composingGuard（IME 短路），
 * 且 baseExtensions 默认装入 renderModeCompartment（D-02 默认 Live Preview）。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

describe('livePreviewExtensions 组合根', () => {
  it('返回数组同时含 inlinePlugin 与 composingGuard（标题渲染 + IME 短路一处验证）', () => {
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

    // composingGuard 生效：compositionstart 后 docChanged 短路（decorations 引用不变）。
    const before = view.plugin(inlinePlugin)!.decorations;
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    view.dispatch({ changes: { from: view.state.doc.length, insert: '你' } });
    expect(view.plugin(inlinePlugin)!.decorations).toBe(before);
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
