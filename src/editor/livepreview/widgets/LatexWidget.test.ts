import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** LatexWidget 回归门（Phase 5 W2）。mathjaxLoader 经 mock 控制就绪态，避免真 MathJax import。 */

let ready = false;
const ensureMathjax = vi.fn();
const fakeConvert = (latex: string): HTMLElement => {
  const el = document.createElement('span');
  el.className = 'mjx-fake';
  el.textContent = 'MJ:' + latex;
  return el;
};
vi.mock('../mathjaxLoader', () => ({
  mathjaxReady: () => ready,
  getMathjaxConvert: () => (ready ? fakeConvert : null),
  ensureMathjax: (v: unknown) => ensureMathjax(v),
}));

const { LatexWidget } = await import('./LatexWidget');
const fakeView = {} as EditorView;

beforeEach(() => {
  ready = false;
  ensureMathjax.mockClear();
});

describe('LatexWidget', () => {
  it('eq 按 latex + 就绪态比较', () => {
    expect(new LatexWidget('\\frac{a}{b}', 0, 10).eq(new LatexWidget('\\frac{a}{b}', 0, 10))).toBe(true);
    expect(new LatexWidget('\\frac{a}{b}', 0, 10).eq(new LatexWidget('\\frac{c}{d}', 0, 10))).toBe(false);
  });

  it('空块 → 占位（不调 convert）', () => {
    ready = true;
    const dom = new LatexWidget('   ', 0, 10).toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-latex-empty')).toBe(true);
    expect(dom.textContent).toContain('空白公式');
  });

  it('就绪 → MathJax convert 节点挂进 mount', () => {
    ready = true;
    const dom = new LatexWidget('\\frac{a}{b}', 0, 10).toDOM(fakeView);
    expect(dom.querySelector('.cm-ink-latex-render .mjx-fake')?.textContent).toBe('MJ:\\frac{a}{b}');
    expect(ensureMathjax).not.toHaveBeenCalled();
  });

  it('未就绪 → 加载中占位显源码 + 触发懒加载', () => {
    ready = false;
    const dom = new LatexWidget('x^2', 0, 10).toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-latex-loading')).toBe(true);
    expect(dom.querySelector('.cm-ink-latex-render')?.textContent).toBe('x^2');
    expect(ensureMathjax).toHaveBeenCalledOnce();
  });
});
