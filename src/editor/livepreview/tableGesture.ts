import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockField, type TableRange } from './blockField';
import { clearTableEdit, setTableEdit, tableEditState } from './tableEditState';

/**
 * 表格就地编辑进入/退出手势（TABLE-WYSIWYG-DESIGN §2.3，反转旧「点表格→整块还原源码」）。
 *
 * 反转点：旧实现 mousedown 命中表格 → preventDefault + dispatch 块内 cursor → blockField 边界跨越 →
 * 整块还原源码。**新实现**：mousedown 从 event.target 向上找最近的 td/th（widget DOM 自带
 * data-table-from / data-cell-index）→ dispatch setTableEdit 标记该单元格进就地编辑态；
 * **不 preventDefault**，让浏览器原生把 caret 落进被点的 contenteditable td（IME 武装最稳，§2.3）。
 *
 * 退出（§2.4）：mousedown 落在表格外（命中文档但不在任一表格 widget DOM 内）→ 清就地编辑态
 * （commit 由失焦 blur 兜底，已挂在单元格上）。点另一表格的单元格 → setTableEdit 更新到新格。
 *
 * 焦点/选区（§6.5）：进编辑态时同时把主 state.selection 设为该表格 from 内的锚点 cursor——供 atomicRanges
 * 与活动行逻辑有据，且失焦/Esc 后光标位置合理。真正编辑焦点在 widget 内的 contenteditable，导航由 widget
 * 自身 keydown 接管。
 *
 * 手势顺序（与 linkGesture 协调）：linkGesture 先注册——Ctrl/Cmd+点击外链时它返回 true 短路，本手势不触发；
 * 普通点击命中表格时 linkGesture 无链接返回 false，轮到本手势。非表格点击：返回 false，交回 CM 默认行为。
 */

/** 主光标候选 pos 落入哪个表格块（闭区间，含端点）；不在任何块内返回 null。 */
function tableContaining(tables: readonly TableRange[], pos: number): TableRange | null {
  for (const t of tables) {
    if (pos >= t.from && pos <= t.to) return t;
  }
  return null;
}

/** 从事件目标向上找最近的 td/th，取其 data-cell-index（DOM 命中，不依赖 posAtCoords 的 cell 级精度）。 */
function cellFromEvent(event: MouseEvent): { tableFrom: number; cellIndex: number } | null {
  const target = event.target;
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

/**
 * mousedown 手势核心（纯逻辑，配对单测穷举：命中单元格、命中表格外、未命中文档）。
 *
 * @returns true = 已处理（落表格外清编辑态）；false = 交回 CM 默认行为（含命中单元格——不 preventDefault，
 *   让浏览器原生聚焦 contenteditable，仅 dispatch 标记编辑态，IME 武装最稳）。
 */
export function handleTableMousedown(event: MouseEvent, view: EditorView): boolean {
  // 优先 DOM 命中单元格（block widget 的 posAtCoords 只解析到 block.from，拿不到 cell；故走 DOM 上溯）。
  const cell = cellFromEvent(event);
  if (cell) {
    // 进就地编辑态：标记单元格 + 把主选区设为该表 from 内锚点（不 preventDefault，浏览器原生聚焦 td）。
    view.dispatch({
      effects: setTableEdit.of({ tableFrom: cell.tableFrom, cellIndex: cell.cellIndex }),
      selection: EditorSelection.cursor(Math.min(cell.tableFrom + 1, view.state.doc.length)),
    });
    return false; // 不接管：让浏览器把 caret 落进 contenteditable td（IME 武装铁律）。
  }

  // 未命中单元格 DOM：若 posAtCoords 落在某表格块内（边界/widget 间隙）也视作进编辑（落首格）。
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) {
    clearActiveEdit(view);
    return false;
  }
  const block = tableContaining(view.state.field(blockField).tables, pos);
  if (block) {
    view.dispatch({
      effects: setTableEdit.of({ tableFrom: block.from, cellIndex: 0 }),
      selection: EditorSelection.cursor(Math.min(block.from + 1, view.state.doc.length)),
    });
    return false;
  }

  // 落表格外：退出就地编辑态（commit 由单元格 blur 兜底）。
  clearActiveEdit(view);
  return false;
}

/** 若当前有就地编辑态则清空（落表格外/未命中时退出）；无则不发多余事务。 */
function clearActiveEdit(view: EditorView): void {
  // tableEditState 由 blockExtensions 挂入；用 false 容错（Source 模式等未挂时返回 undefined）。
  const editing = view.state.field(tableEditState, false);
  if (editing) view.dispatch({ effects: clearTableEdit.of(null) });
}

/**
 * 表格点击手势扩展（挂入 livePreviewExtensions，注册于 linkGesture 之后）：mousedown 委派
 * handleTableMousedown。命中单元格时不 preventDefault（浏览器原生聚焦），仅 dispatch 标记编辑态。
 */
export const tableGesture = EditorView.domEventHandlers({
  mousedown: (event, view) => handleTableMousedown(event, view),
});
