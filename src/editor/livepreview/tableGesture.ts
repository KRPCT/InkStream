import { EditorView } from '@codemirror/view';
import { blockField, type TableRange } from './blockField';
import { clearTableEdit, setTableEdit, tableEditState } from './tableEditState';
import { getActiveCellEditor, setPendingClick } from './tableCellEditor';

/**
 * 表格就地编辑进入/退出手势（方案 B，TABLE-REDESIGN §3，反转方案 A）。
 *
 * 进入：mousedown 从 event.target 向上找最近的 td/th（widget DOM 带 data-table-from / data-cell-index）→
 * dispatch setTableEdit 标记该单元格进编辑态（重建 → TableWidget.armCells 在该 td 内挂嵌套子 EditorView）。
 * 同时 `setPendingClick` 记下点击坐标——子编辑器挂载后据此把 caret 落到点击处（CDP 自验 a，点中部不跳末尾）。
 * **不 preventDefault**，保留真实手势链（IME 武装铁律）。
 *
 * 已激活格内再点：若 mousedown 落在当前活动子编辑器的 contentDOM 内，**完全不接管**（返回 false 且不 dispatch）
 * ——交子 EditorView 内核原生处理（点哪 caret 落哪、拖拽框选，全 CM6 原生，CDP 自验 a/b）。
 *
 * 退出（§5.1）：mousedown 落表格外 → 清编辑态（commit 由子编辑器 docChanged 实时同步，无需 blur 兜底）；
 * 表格**恒保持渲染、永不显示源码**。点另一表格/另一格 → setTableEdit 更新到新格（旧子编辑器在 mountCell 内销毁）。
 *
 * 手势顺序（与 linkGesture 协调）：linkGesture 先注册——Ctrl/Cmd+外链点击它返回 true 短路，本手势不触发；
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
 * @returns true = 已接管（preventDefault 主编辑器默认 mousedown，**防主编辑器抢焦点/移主选区**，让子编辑器
 *   focusSub 拿稳焦点——CDP 实测「不 preventDefault 则键入落主 doc 而非子格」root cause）；false = 交回
 *   CM 默认（含点已激活子编辑器内：交子 EditorView 原生定位 caret / 拖拽框选）。
 */
export function handleTableMousedown(event: MouseEvent, view: EditorView): boolean {
  // 已激活子编辑器内点击/拖拽：**不接管**（return false），交子 EditorView 内核原生处理 mousedown——
  // 定位 caret / 拖拽框选 / 获焦全由子自己做。但显式补一次 `active.sub.focus()`：主编辑器在同一 mousedown
  // 冒泡链里可能抢回焦点（CDP 实测：子内拖拽 / 再点同格后焦点离开子 → 键入落主 doc），微任务后补焦点把它
  // 夺回子编辑器（不 preventDefault，否则连子自身的原生 caret 定位都被取消）。
  const active = getActiveCellEditor(view);
  if (active && event.target instanceof Node && active.sub.dom.contains(event.target)) {
    queueMicrotask(() => {
      if (active.sub.dom.isConnected) active.sub.focus();
    });
    return false;
  }

  // 优先 DOM 命中单元格（block widget 的 posAtCoords 只解析到 block.from，拿不到 cell；故走 DOM 上溯）。
  const cell = cellFromEvent(event);
  if (cell) {
    setPendingClick(event.clientX, event.clientY); // 子编辑器挂载后据此把 caret 落点击处（自验 a）。
    // 只发 setTableEdit、**不动主 selection**：方案 B 编辑焦点全在子编辑器，主 caret 与编辑无关；若顺手把主
    // selection 落进表内，主编辑器可能据此抢回焦点（CDP 实测：连续点格时主编辑器偶尔夺焦 → 键入落主 doc）。
    view.dispatch({ effects: setTableEdit.of({ tableFrom: cell.tableFrom, cellIndex: cell.cellIndex }) });
    return true; // 接管：preventDefault 主编辑器默认，焦点交给子编辑器（caret 由子 posAtCoords 定位）。
  }

  // 未命中单元格 DOM：若 posAtCoords 落在某表格块内（边界/widget 间隙）也视作进编辑（落首格）。
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) {
    clearActiveEdit(view);
    return false;
  }
  const block = tableContaining(view.state.field(blockField).tables, pos);
  if (block) {
    view.dispatch({ effects: setTableEdit.of({ tableFrom: block.from, cellIndex: 0 }) });
    return true;
  }

  // 落表格外：退出就地编辑态（子编辑器 docChanged 已实时同步，无需 blur 兜底）。
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
 * handleTableMousedown。命中静态格进编辑态时**显式 preventDefault**（防主编辑器抢焦点/移主选区，
 * 让子编辑器拿稳焦点，CDP 实测 root cause）；命中已激活子编辑器内则不拦（交子 EditorView 原生定位）。
 */
export const tableGesture = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const handled = handleTableMousedown(event, view);
    if (handled) event.preventDefault();
    return handled;
  },
});
