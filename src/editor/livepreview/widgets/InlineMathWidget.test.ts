import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** InlineMathWidget 回归门（FEAT-INLINE-MATH）。mathLoader mock 控制就绪态，避免真 KaTeX import。 */

let ready = false;
const ensureKatex = vi.fn();
const fakeKatex = {
  render: (latex: string, el: HTMLElement) => {
    el.textContent = 'K:' + latex;
  },
  renderToString: () => '',
  ParseError: class extends Error {},
  version: 't',
};
vi.mock('../mathLoader', () => ({
  katexReady: () => ready,
  getKatex: () => (ready ? fakeKatex : null),
  ensureKatex: (v: unknown) => ensureKatex(v),
}));

const { InlineMathWidget } = await import('./InlineMathWidget');
const fakeView = {} as EditorView;

beforeEach(() => {
  ready = false;
  ensureKatex.mockClear();
});

describe('InlineMathWidget', () => {
  it('eq 含 latex + ready', () => {
    expect(new InlineMathWidget('a').eq(new InlineMathWidget('a'))).toBe(true);
    expect(new InlineMathWidget('a').eq(new InlineMathWidget('b'))).toBe(false);
  });

  it('就绪 → KaTeX 渲染进 span（行内 span，非 div）', () => {
    ready = true;
    const dom = new InlineMathWidget('x^2').toDOM(fakeView);
    expect(dom.tagName).toBe('SPAN');
    expect(dom.classList.contains('cm-ink-inline-math')).toBe(true);
    expect(dom.textContent).toBe('K:x^2');
  });

  it('未就绪 → 占位显源码 $..$ + 触发懒加载', () => {
    ready = false;
    const dom = new InlineMathWidget('x^2').toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-inline-math-loading')).toBe(true);
    expect(dom.textContent).toBe('$x^2$');
    expect(ensureKatex).toHaveBeenCalledOnce();
  });
});
