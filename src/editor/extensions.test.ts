import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../test/composition';
import { baseExtensions } from './extensions';
import { isComposing } from './composition';
import { setRenderMode } from './livepreview/renderMode';
import type { LanguageId } from './languages';

/**
 * baseExtensions 顶层组合冻结门挂载回归门（重构设计 §3.4 / #11，A 独有的最深真缝）。
 *
 * 核心断言：compositionGate 挂在 baseExtensions 顶层而非 renderModeCompartment 内——
 *   1. 所有语言下门都在册（代码文件 / Source 模式 IME 同样吞字，门不能只在 markdown live 才生效）；
 *   2. 渲染模式热切（Live↔Source，reconfigure renderModeCompartment）不卸载门——切到 Source 后
 *      compositionstart 仍能置冻结态。若门误挂 compartment 内，切 Source（装 []）即卸门，组合判据失效。
 *
 * 判据用门的 isComposing(view)：compositionstart 经门 domEventHandler 同步置 frozenFlags=true，
 * 故 isComposing 翻 true 即证门的事件处理器在该 state 在册（jsdom 不置 view.composing，纯靠 frozen 支）。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

/** baseExtensions 支持的全部语言（含代码文件、LaTeX、richtext；typst 走懒加载不在同步表，略）。 */
const LANGUAGES: LanguageId[] = [
  'markdown',
  'javascript',
  'python',
  'rust',
  'json',
  'yaml',
  'html',
  'css',
  'latex',
  'shell',
  'richtext',
];

describe('baseExtensions 顶层挂组合冻结门（#11）', () => {
  describe('门在所有语言下都在册（代码文件 / Source 模式 IME 同样吞字）', () => {
    for (const lang of LANGUAGES) {
      it(`${lang}：compositionstart → isComposing 翻 true`, () => {
        view = makeTestView('文档内容', baseExtensions(lang));
        expect(isComposing(view)).toBe(false);

        dispatchComposition(view, { phase: 'compositionstart', data: '你' });
        expect(isComposing(view)).toBe(true);

        dispatchComposition(view, { phase: 'compositionend', data: '你好' });
        expect(isComposing(view)).toBe(false);
      });
    }
  });

  describe('门挂顶层而非 renderModeCompartment 内（渲染模式热切不卸门）', () => {
    it('Live 模式（默认）下门在册', () => {
      view = makeTestView('# H1', baseExtensions('markdown'));
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      expect(isComposing(view)).toBe(true);
    });

    it('切到 Source 模式（renderModeCompartment 装 []）后门仍在册', () => {
      view = makeTestView('# H1', baseExtensions('markdown'));
      // 切 Source：renderModeCompartment.reconfigure([])——若门误挂 compartment 内即被此操作卸载。
      setRenderMode(view, 'source');
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      // 门若仍在 baseExtensions 顶层（正确）→ frozen 置位；若被卸 → isComposing 恒 false（吞字真缝）。
      expect(isComposing(view)).toBe(true);
    });

    it('Live→Source→Live 往返后门始终在册（reconfigure 不影响顶层门）', () => {
      view = makeTestView('# H1', baseExtensions('markdown'));
      setRenderMode(view, 'source');
      setRenderMode(view, 'live');
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      expect(isComposing(view)).toBe(true);
    });
  });
});
