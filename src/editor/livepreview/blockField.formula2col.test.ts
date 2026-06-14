import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { __setKatexForTest } from './mathLoader';
import { blockField } from './blockField';
import { tableEditState } from './tableEditState';
import { clearFormulaEdit, formulaEditState, setFormulaEdit } from './formulaEditState';
import { FormulaEditWidget } from './widgets/FormulaEditWidget';
import { MathWidget } from './widgets/MathWidget';

/** 公式块双栏编辑态机回归门（块编辑增强 W3）：编辑态 > 光标进块 > 就地渲染。 */

const fakeKatex = {
  render: (latex: string, el: HTMLElement) => void (el.textContent = 'K:' + latex),
  renderToString: () => '',
  ParseError: class extends Error {},
  version: 't',
} as unknown as Parameters<typeof __setKatexForTest>[0];

let view: EditorView | null = null;
beforeEach(() => __setKatexForTest(fakeKatex));
afterEach(() => {
  destroyTestView(view);
  view = null;
  __setKatexForTest(null);
});

function bfView(doc: string): EditorView {
  return makeTestView(doc, [
    extensionsForLanguage('markdown'),
    formulaEditState,
    tableEditState,
    blockField,
  ]);
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

const DOC = ['正文', '', '```math', 'E=mc^2', '```'].join('\n');
const BLOCK_FROM = DOC.indexOf('```math');

describe('blockField 公式块双栏编辑态', () => {
  it('默认（光标块外）→ 就地 MathWidget', () => {
    view = bfView(DOC);
    expect(widgets(view).some((w) => w instanceof MathWidget)).toBe(true);
    expect(widgets(view).some((w) => w instanceof FormulaEditWidget)).toBe(false);
  });

  it('setFormulaEdit → 该块渲 FormulaEditWidget（编辑态优先，不渲就地 widget）', () => {
    view = bfView(DOC);
    view.dispatch({ effects: setFormulaEdit.of({ blockFrom: BLOCK_FROM }) });
    const ws = widgets(view);
    expect(ws.some((w) => w instanceof FormulaEditWidget)).toBe(true);
    expect(ws.some((w) => w instanceof MathWidget)).toBe(false);
  });

  it('clearFormulaEdit → 回就地渲染', () => {
    view = bfView(DOC);
    view.dispatch({ effects: setFormulaEdit.of({ blockFrom: BLOCK_FROM }) });
    expect(widgets(view).some((w) => w instanceof FormulaEditWidget)).toBe(true);
    view.dispatch({ effects: clearFormulaEdit.of(null) });
    expect(widgets(view).some((w) => w instanceof MathWidget)).toBe(true);
    expect(widgets(view).some((w) => w instanceof FormulaEditWidget)).toBe(false);
  });
});
