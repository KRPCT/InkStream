import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { __setKatexForTest } from './mathLoader';
import { blockField } from './blockField';
import { tableEditState } from './tableEditState';
import { MathWidget } from './widgets/MathWidget';

/**
 * blockField ```math 块分支回归门（Phase 5 W1 / BLOCK-01）。
 * 断言：光标块外 → FencedCode math 替换为 MathWidget；光标进块 → 还原源码（无装饰）；非 math fenced 不渲染。
 */

// 注入假 katex：view 渲染时 MathWidget.toDOM 同步渲染，无真 import 副作用。
const fakeKatex = {
  render: (latex: string, el: HTMLElement) => {
    el.textContent = 'K:' + latex;
  },
  renderToString: () => '',
  ParseError: class extends Error {},
  version: 'test',
} as unknown as Parameters<typeof __setKatexForTest>[0];

let view: EditorView | null = null;
beforeEach(() => __setKatexForTest(fakeKatex));
afterEach(() => {
  destroyTestView(view);
  view = null;
  __setKatexForTest(null);
});

function bfView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), tableEditState, blockField]);
}

function mathBlocks(v: EditorView): Array<{ from: number; latex: string }> {
  const out: Array<{ from: number; latex: string }> = [];
  const iter = v.state.field(blockField).deco.iter();
  while (iter.value) {
    const w = (iter.value.spec as { widget?: unknown }).widget;
    if (w instanceof MathWidget) out.push({ from: iter.from, latex: w.latex });
    iter.next();
  }
  return out;
}

const MATH_DOC = ['正文', '', '```math', 'E=mc^2', '```', '', '尾'].join('\n');
const MATH_FROM = MATH_DOC.indexOf('```math');

describe('blockField ```math 块', () => {
  it('光标块外：FencedCode math 替换为 MathWidget（latex 取自 CodeText）', () => {
    view = bfView(MATH_DOC); // 光标默认 doc 起点（块外）
    const b = mathBlocks(view);
    expect(b).toHaveLength(1);
    expect(b[0]?.from).toBe(MATH_FROM);
    expect(b[0]?.latex).toBe('E=mc^2');
  });

  it('光标进块：还原源码（无 MathWidget 装饰）', () => {
    view = bfView(MATH_DOC);
    view.dispatch({ selection: EditorSelection.cursor(MATH_FROM + '```math\n'.length) });
    expect(mathBlocks(view)).toHaveLength(0);
  });

  it('移出块：重新渲染（MathWidget 回来）', () => {
    view = bfView(MATH_DOC);
    view.dispatch({ selection: EditorSelection.cursor(MATH_FROM + '```math\n'.length) });
    expect(mathBlocks(view)).toHaveLength(0);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(mathBlocks(view)).toHaveLength(1);
  });

  it('非 math fenced（```js）不渲染', () => {
    view = bfView(['正文', '', '```js', 'a=1', '```'].join('\n'));
    expect(mathBlocks(view)).toHaveLength(0);
  });

  it('空 ```math 块也替换（latex 空串）', () => {
    view = bfView(['正文', '', '```math', '```'].join('\n'));
    const b = mathBlocks(view);
    expect(b).toHaveLength(1);
    expect(b[0]?.latex).toBe('');
  });
});
