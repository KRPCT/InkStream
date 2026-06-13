import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { __setKatexForTest } from './mathLoader';
import { __setMathjaxConvertForTest } from './mathjaxLoader';
import { blockField } from './blockField';
import { tableEditState } from './tableEditState';
import { MathWidget } from './widgets/MathWidget';
import { LatexWidget } from './widgets/LatexWidget';

/**
 * blockField ```latex 分支 + math/latex 混排回归门（Phase 5 W2 / BLOCK-03, BLOCK-04）。
 * 注入假 KaTeX / 假 MathJax convert，避免真引擎 import，断言 widget 分发正确。
 */

const fakeKatex = {
  render: (latex: string, el: HTMLElement) => {
    el.textContent = 'K:' + latex;
  },
  renderToString: () => '',
  ParseError: class extends Error {},
  version: 't',
} as unknown as Parameters<typeof __setKatexForTest>[0];

const fakeConvert = (latex: string): HTMLElement => {
  const el = document.createElement('span');
  el.textContent = 'MJ:' + latex;
  return el;
};

let view: EditorView | null = null;
beforeEach(() => {
  __setKatexForTest(fakeKatex);
  __setMathjaxConvertForTest(fakeConvert);
});
afterEach(() => {
  destroyTestView(view);
  view = null;
  __setKatexForTest(null);
  __setMathjaxConvertForTest(null);
});

function bfView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), tableEditState, blockField]);
}

function widgets(v: EditorView): unknown[] {
  const out: unknown[] = [];
  const iter = v.state.field(blockField).deco.iter();
  while (iter.value) {
    out.push((iter.value.spec as { widget?: unknown }).widget);
    iter.next();
  }
  return out;
}

const LATEX_DOC = ['正文', '', '```latex', '\\frac{a}{b}', '```'].join('\n');

describe('blockField ```latex 块', () => {
  it('光标块外 → 替换为 LatexWidget（源取自 CodeText）', () => {
    view = bfView(LATEX_DOC);
    const ls = widgets(view).filter((w) => w instanceof LatexWidget) as LatexWidget[];
    expect(ls).toHaveLength(1);
    expect(ls[0]?.latex).toBe('\\frac{a}{b}');
  });

  it('光标进 latex 块 → 还原源码', () => {
    view = bfView(LATEX_DOC);
    view.dispatch({ selection: EditorSelection.cursor(LATEX_DOC.indexOf('\\frac')) });
    expect(widgets(view).filter((w) => w instanceof LatexWidget)).toHaveLength(0);
  });

  it('math + latex 混排：各产对应 widget（互不干扰，BLOCK-04）', () => {
    view = bfView(['正文', '', '```math', 'a', '```', '', '```latex', 'b', '```'].join('\n'));
    const ws = widgets(view);
    expect(ws.filter((w) => w instanceof MathWidget)).toHaveLength(1);
    expect(ws.filter((w) => w instanceof LatexWidget)).toHaveLength(1);
  });
});
