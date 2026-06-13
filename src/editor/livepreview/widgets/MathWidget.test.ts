import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** MathWidget 回归门（Phase 5 W1）。mathLoader 经 mock 控制就绪态，避免真 KaTeX import。 */

let ready = false;
const ensureKatex = vi.fn();
const fakeKatex = {
  render: (latex: string, el: HTMLElement) => {
    el.textContent = 'K:' + latex;
  },
  renderToString: () => '',
  ParseError: class extends Error {},
  version: 'test',
};
vi.mock('../mathLoader', () => ({
  katexReady: () => ready,
  getKatex: () => (ready ? fakeKatex : null),
  ensureKatex: (v: unknown) => ensureKatex(v),
}));

const { MathWidget } = await import('./MathWidget');
const fakeView = {} as EditorView;

beforeEach(() => {
  ready = false;
  ensureKatex.mockClear();
});
afterEach(() => {
  ready = false;
});

describe('MathWidget', () => {
  it('eq 按 latex 源比较', () => {
    expect(new MathWidget('a^2').eq(new MathWidget('a^2'))).toBe(true);
    expect(new MathWidget('a^2').eq(new MathWidget('b^2'))).toBe(false);
  });

  it('空块 → 占位（不调 KaTeX）', () => {
    ready = true;
    const dom = new MathWidget('   ').toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-math-empty')).toBe(true);
    expect(dom.textContent).toContain('空白公式');
  });

  it('就绪 → KaTeX 渲染进 mount', () => {
    ready = true;
    const dom = new MathWidget('E=mc^2').toDOM(fakeView);
    expect(dom.querySelector('.cm-ink-math-render')?.textContent).toBe('K:E=mc^2');
    expect(ensureKatex).not.toHaveBeenCalled();
  });

  it('未就绪 → 加载中占位显源码 + 触发懒加载', () => {
    ready = false;
    const dom = new MathWidget('x^2').toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-math-loading')).toBe(true);
    expect(dom.querySelector('.cm-ink-math-render')?.textContent).toBe('x^2');
    expect(ensureKatex).toHaveBeenCalledOnce();
  });
});
