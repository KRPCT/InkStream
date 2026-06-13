import type { EditorView } from '@codemirror/view';
import { queueAfterComposition, isComposing } from '../composition';
import { setTableEdit, tableEditState } from './tableEditState';
import { clearTableEdit } from './tableEditState';
import {
  type ColumnAlign,
  type TableChange,
  type TableStruct,
  columnOf,
  deleteColumnChanges,
  deleteRowChange,
  deleteTableChange,
  insertColumnChanges,
  insertRowChange,
  setAlignChange,
  tableStructAt,
} from './tableOps';

/**
 * 表格行列操作 + 对齐的 view 层命令（TABLE-WYSIWYG-DESIGN §5）。
 *
 * 职责：把 tableOps.ts 的纯 change 构造接到 EditorView——从 live 语法树重解析表格结构（防陈旧位置）、
 * 构造合法 GFM 多段 changes、单次 dispatch（独立 userEvent 各成一条可单独撤销）。悬浮工具条与右键菜单
 * 共用本层（双入口同源），保「op = 对主 doc 一次 dispatch、state.doc 唯一真相源」纪律。
 *
 * 组合期防御（铁律 2）：op 一般由点击触发、非组合期；但仍统一经 `queueAfterComposition` 兜底——
 * 组合中触发则排队到 compositionend 后执行一次，绝不在组合期 dispatch 撕合成中 DOM。
 *
 * 行列结构改写后 doc 变 → blockField 全文重建 → 表格按新结构重渲染（widget eq 失配重建 DOM）。
 */

/** op 类型（工具条/右键菜单的操作枚举，独立 userEvent 便于撤销分粒度）。 */
export type TableOp =
  | { readonly kind: 'insertRowAbove' }
  | { readonly kind: 'insertRowBelow' }
  | { readonly kind: 'deleteRow' }
  | { readonly kind: 'insertColLeft' }
  | { readonly kind: 'insertColRight' }
  | { readonly kind: 'deleteCol' }
  | { readonly kind: 'deleteTable' }
  | { readonly kind: 'align'; readonly align: ColumnAlign };

/** 从 live 语法树取 tableFrom 处表格的当前结构（每次 op 前重解析，防陈旧位置/双提交）。 */
function structOf(view: EditorView, tableFrom: number): TableStruct | null {
  return tableStructAt(view.state, tableFrom);
}

/** 据 op 构造该表的 changes（空数组 = 无操作/被边界拦截）。 */
function changesForOp(view: EditorView, struct: TableStruct, cellIndex: number, op: TableOp): TableChange[] {
  const col = columnOf(struct, cellIndex);
  switch (op.kind) {
    case 'insertRowAbove':
      return [insertRowChange(struct, cellIndex, true)];
    case 'insertRowBelow':
      return [insertRowChange(struct, cellIndex, false)];
    case 'deleteRow': {
      const ch = deleteRowChange(struct, cellIndex);
      return ch ? [ch] : [];
    }
    case 'insertColLeft':
      return insertColumnChanges(struct, col, true);
    case 'insertColRight':
      return insertColumnChanges(struct, col, false);
    case 'deleteCol':
      return deleteColumnChanges(struct, col);
    case 'deleteTable':
      return [
        deleteTableChange(struct, view.state.doc.length, (pos) =>
          view.state.doc.sliceString(pos, pos + 1),
        ),
      ];
    case 'align': {
      const ch = setAlignChange(struct, col, op.align);
      return ch ? [ch] : [];
    }
  }
}

/** op → userEvent（撤销粒度：每类 op 各成一条 history 条目）。 */
function userEventForOp(op: TableOp): string {
  switch (op.kind) {
    case 'insertRowAbove':
    case 'insertRowBelow':
      return 'table.insertRow';
    case 'deleteRow':
      return 'table.deleteRow';
    case 'insertColLeft':
    case 'insertColRight':
      return 'table.insertColumn';
    case 'deleteCol':
      return 'table.deleteColumn';
    case 'deleteTable':
      return 'table.deleteTable';
    case 'align':
      return 'table.align';
  }
}

/**
 * 执行一个表格 op（工具条/右键菜单统一入口）：重解析结构 → 构造 changes → dispatch。
 *
 * - 组合期排队（兜底，绝不组合期 dispatch）。
 * - 边界被拦（changes 为空，如删表头/删到只剩一列）则静默不 dispatch。
 * - 删除行/列后把就地编辑态收敛到一个仍合法的单元格（避免 cellIndex 越界指向不存在的 cell）。
 */
export function applyTableOp(
  view: EditorView,
  tableFrom: number,
  cellIndex: number,
  op: TableOp,
): void {
  if (isComposing(view)) {
    queueAfterComposition(view, `table-op-${op.kind}`, () =>
      applyTableOp(view, tableFrom, cellIndex, op),
    );
    return;
  }
  const struct = structOf(view, tableFrom);
  if (!struct) return;
  const changes = changesForOp(view, struct, cellIndex, op);
  if (changes.length === 0) return;

  // 删整表：表已不存在，编辑态必须清空（否则指向已删表 → 子编辑器孤挂；clearTableEdit 触发重建卸载子编辑器）。
  if (op.kind === 'deleteTable') {
    view.dispatch({ changes, userEvent: userEventForOp(op), effects: clearTableEdit.of(null) });
    view.focus();
    return;
  }
  const nextEdit = nextEditState(struct, cellIndex, op);
  view.dispatch({
    changes,
    userEvent: userEventForOp(op),
    effects: nextEdit ? setTableEdit.of(nextEdit) : undefined,
  });
}

/**
 * op 后的就地编辑态收敛（保 cellIndex 始终指向存在的 cell）。
 *
 * - 删行：把编辑态落到删除行所在列的上一行（或表头同列）的 cell——避免指向已删 cell。
 * - 删列：把编辑态落到左侧列（col>0 则 col-1，否则 0）的同行 cell。
 * - 其余 op（插入/对齐）：结构扩张/对齐变，原 cellIndex 仍指向同一逻辑 cell，保留当前编辑态不强改。
 *
 * 返回 null = 不改编辑态（沿用 docChanged 的 mapPos 跟随）。
 */
function nextEditState(
  struct: TableStruct,
  cellIndex: number,
  op: TableOp,
): { tableFrom: number; cellIndex: number } | null {
  if (op.kind === 'deleteRow') {
    const cols = struct.columns;
    const row = Math.floor(cellIndex / cols);
    const col = cellIndex % cols;
    const targetRow = Math.max(0, row - 1); // 落上一行同列（表头行不删，至少回退到表头）。
    return { tableFrom: struct.tableFrom, cellIndex: targetRow * cols + col };
  }
  if (op.kind === 'deleteCol') {
    const cols = struct.columns;
    const row = Math.floor(cellIndex / cols);
    const col = cellIndex % cols;
    const newCols = cols - 1;
    if (newCols <= 0) return null;
    const targetCol = Math.min(Math.max(0, col), newCols - 1);
    return { tableFrom: struct.tableFrom, cellIndex: row * newCols + targetCol };
  }
  return null;
}

/** 当前就地编辑态（tableFrom + cellIndex）；无则 null（读字段，与 state 一致）。 */
export function currentTableEdit(
  view: EditorView,
): { tableFrom: number; cellIndex: number } | null {
  return view.state.field(tableEditState, false) ?? null;
}

/**
 * 从 DOM 事件目标解析其所属表格 + 单元格（右键菜单/工具条定位用，DOM 上溯不依赖语法树坐标）。
 *
 * 从 target 向上找 td/th → 取 data-cell-index + 表格 data-table-from。非表格内目标返回 null。
 */
export function tableContextFromTarget(
  target: EventTarget | null,
): { tableFrom: number; cellIndex: number } | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('td, th');
  if (!cell) return null;
  const table = cell.closest<HTMLElement>('table.cm-ink-table');
  if (!table) return null;
  const tableFrom = Number(table.dataset.tableFrom);
  const cellIndex = Number(cell.dataset.cellIndex);
  if (!Number.isFinite(tableFrom) || !Number.isFinite(cellIndex)) return null;
  return { tableFrom, cellIndex };
}
