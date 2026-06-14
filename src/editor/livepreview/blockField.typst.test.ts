import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { __setKatexForTest } from './mathLoader';
import { __setMathjaxConvertForTest } from './mathjaxLoader';
import { tableEditState } from './tableEditState';

/**
 * blockField ```typst 分支 + 三引擎混排回归门（Phase 5 W3 / BLOCK-02, BLOCK-04）。
 * typstClient 经 mock（避免真 Worker + wasm ?url）；KaTeX/MathJax 注入桩，断言三类 widget 分发正确。
 */

vi.mock('./typst/typstClient', () => ({
  ERROR_SENTINEL: ' typst-error',
  typstReady: () => true,
  getCachedSvg: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  ensureTypst: () => {},
  requestCompile: () => {},
}));

const { blockField } = await import('./blockField');
const { MathWidget } = await import('./widgets/MathWidget');
const { LatexWidget } = await import('./widgets/LatexWidget');
const { TypstWidget } = await import('./widgets/TypstWidget');

const fakeKatex = {
  render: (l: string, el: HTMLElement) => {
    el.textContent = 'K:' + l;
  },
  renderToString: () => '',
  ParseError: class extends Error {},
  version: 't',
} as unknown as Parameters<typeof __setKatexForTest>[0];
const fakeConvert = (l: string): HTMLElement => {
  const el = document.createElement('span');
  el.textContent = 'MJ:' + l;
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

const TYPST_DOC = ['正文', '', '```typst', '= 标题', '```'].join('\n');

describe('blockField ```typst 块', () => {
  it('光标块外 → 替换为 TypstWidget（源取自 CodeText）', () => {
    view = bfView(TYPST_DOC);
    const ts = widgets(view).filter((w) => w instanceof TypstWidget);
    expect(ts).toHaveLength(1);
    expect((ts[0] as { source: string }).source).toBe('= 标题');
  });

  it('光标进 typst 块 → 还原源码', () => {
    view = bfView(TYPST_DOC);
    view.dispatch({ selection: EditorSelection.cursor(TYPST_DOC.indexOf('= 标题')) });
    expect(widgets(view).filter((w) => w instanceof TypstWidget)).toHaveLength(0);
  });

  it('math + latex + typst 三引擎混排：各产对应 widget（BLOCK-04 互不干扰）', () => {
    view = bfView(
      ['正文', '', '```math', 'a', '```', '', '```latex', 'b', '```', '', '```typst', '= c', '```'].join(
        '\n',
      ),
    );
    const ws = widgets(view);
    expect(ws.filter((w) => w instanceof MathWidget)).toHaveLength(1);
    expect(ws.filter((w) => w instanceof LatexWidget)).toHaveLength(1);
    expect(ws.filter((w) => w instanceof TypstWidget)).toHaveLength(1);
  });
});
