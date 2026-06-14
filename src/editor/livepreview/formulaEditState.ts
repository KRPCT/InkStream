import { StateEffect, StateField } from '@codemirror/state';

/**
 * 公式块双栏编辑态（块编辑增强 W3）：blockFrom = FencedCode 节点起点（块身份键，与 blockField.formulaBlocks 同源）。
 *
 * 双栏是显式「编辑模式」，不替换 Phase 5「光标进块显源码」（默认仍就地渲染）。blockField FencedCode 分支判定优先级：
 * 编辑态 > 光标进块 > 就地渲染。镜像 tableEditState 纪律（docChanged 时 mapPos 跟随，保编辑态指向同一块）。
 */
export interface FormulaEditState {
  readonly blockFrom: number;
}

export const setFormulaEdit = StateEffect.define<FormulaEditState>();
export const clearFormulaEdit = StateEffect.define<null>();

export const formulaEditState = StateField.define<FormulaEditState | null>({
  create: () => null,
  update(prev, tr) {
    for (const e of tr.effects) {
      if (e.is(setFormulaEdit)) return e.value;
      if (e.is(clearFormulaEdit)) return null;
    }
    if (prev && tr.docChanged) return { blockFrom: tr.changes.mapPos(prev.blockFrom, 1) };
    return prev;
  },
});
