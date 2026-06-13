import { CompletionContext } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { destroyTestView, makeTestView } from '../../test/composition';
import { slashCommandSource } from './slashCommand';

/** /math slash 触发器回归门（Phase 5 W1 / BLOCK-01）。 */

let view: EditorView | null = null;
afterEach(() => {
  destroyTestView(view);
  view = null;
});

function source(doc: string, pos: number) {
  view = makeTestView(doc, []);
  return slashCommandSource(new CompletionContext(view.state, pos, false));
}

describe('slashCommandSource', () => {
  it('行首 /math → 候选含 /math', () => {
    const res = source('/math', 5);
    expect(res).not.toBeNull();
    expect(res?.options.map((o) => o.label)).toContain('/math');
    expect(res?.from).toBe(0);
  });

  it('空白后 /ma → 命中且前缀过滤', () => {
    const res = source('文字 /ma', '文字 /ma'.length);
    expect(res?.options.map((o) => o.label)).toEqual(['/math']);
  });

  it('a/b 路径不误触发（/ 前非空白）', () => {
    expect(source('a/ma', 4)).toBeNull();
  });

  it('apply 插入 ```math 块且光标落块内空行', () => {
    const res = source('/math', 5);
    const opt = res?.options.find((o) => o.label === '/math');
    expect(opt?.apply).toBeTypeOf('function');
    (opt?.apply as (v: EditorView, c: unknown, f: number, t: number) => void)(
      view as EditorView,
      opt,
      res?.from ?? 0,
      5,
    );
    expect((view as EditorView).state.doc.toString()).toBe('```math\n\n```');
    expect((view as EditorView).state.selection.main.head).toBe('```math\n'.length);
  });
});
