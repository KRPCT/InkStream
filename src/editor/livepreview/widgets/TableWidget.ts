import { EditorSelection } from '@codemirror/state';
import { type EditorView, WidgetType } from '@codemirror/view';
import { isComposing, queueAfterComposition } from '../../composition';
import {
  type CellRange,
  type NavDir,
  appendRowChange,
  escapePipes,
  navigateCell,
  tableModelAt,
  unescapePipes,
} from '../tableModel';
import { clearTableEdit, setTableEdit, tableEditState } from '../tableEditState';

/**
 * GFM 表格 widget（块级层 / Typora 式就地编辑 Wave 1 / Security V5 XSS 防护）。
 *
 * 职责（反转旧「点表格→整块还原源码」）：把 GFM 表格片段渲染为真 `<table>`，并据就地编辑态
 * `activeCellIndex` 把对应 td/th 设 `contenteditable=true`；输入经 input/composition 同步回主 doc 的
 * 对应 `TableCell` 源区间（state.doc 仍唯一真相源），Tab/Shift+Tab/Enter 单元格导航，Esc 退出。
 *
 * 真相源映射（TABLE-WYSIWYG-DESIGN §3 + delimiter 切分修正）：构建时由 blockField 传入每个 td/th 的源区间
 * （cellRanges，文档序扁平；区间 = 相邻 `|` 之间，含两侧填充空格——对空 cell 也稳健，lezer 不产空 TableCell）。
 * commit = `escapePipes(textContent)` 包单空格 → 单点 dispatch 替换 `[cellFrom,cellTo]`，列宽无语义、不需维护。
 *
 * IME（§3.3 / §6.1）：单元格 contenteditable 是 contentDOM 子树，composition 事件天然冒泡进统一冻结门，
 * `isComposing(view)` 在单元格组合期为真。commit 在组合期经 `queueAfterComposition` 排队、compositionend
 * 后执行一次——绝不在组合期 dispatch（dispatch→可能重建 widget→撕合成中子树→吞字）。
 *
 * widget 复用（§7 Wave 1 关键点 R2）：`eq()` 把 sourceText + activeCellIndex 纳入相等判据；
 * `updateDOM` 在结构（sourceText）不变、仅编辑态变时**原地更新** contenteditable 标志/焦点而不重建整表
 * （保 caret 与组合存活），仅 sourceText 变才回退重建。
 *
 * 安全（T-03-12 / Security V5）：DOM 一律 `document.createElement` 逐元素构建，单元格文本经
 * `textContent` 写入，**绝不用 HTML 字符串赋值拼用户内容**（不走 inner-HTML 赋值路径）。
 *
 * 样式经 class 消费 var(--cm-table-*)，**永不硬编码色值**（tableTheme 提供）。
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly sourceText: string,
    readonly tableFrom: number,
    /** 文档序扁平的 cell 源区间（相邻 `|` 之间，含表头行 + 各数据行；不含对齐分隔行）。 */
    readonly cellRanges: readonly CellRange[],
    /** 当前就地编辑的单元格下标（cellRanges 下标）；null = 该表无单元格在编辑。 */
    readonly activeCellIndex: number | null,
    /** 列数（据表头行列数），导航与 DOM 行切分共用。 */
    readonly columns: number,
  ) {
    super();
  }

  /**
   * 相等判据：sourceText + tableFrom + activeCellIndex 同则视为同一 widget。
   * cellRanges 由 sourceText + tableFrom 唯一决定（同一语法树切片），故不必逐项比对。
   * activeCellIndex 入判据使「编辑态切换」触发 widget 更新（经 updateDOM 原地处理，不重建）。
   */
  eq(other: TableWidget): boolean {
    return (
      other.sourceText === this.sourceText &&
      other.tableFrom === this.tableFrom &&
      other.activeCellIndex === this.activeCellIndex
    );
  }

  /**
   * 放行就地编辑所需的输入类事件（让单元格 contenteditable 的输入不被 CM 当「不属于编辑器」吞掉），
   * 同时放行 mousedown（手势层据此进编辑态）。其余无关事件仍吞掉（避免误触）。
   */
  ignoreEvent(event: Event): boolean {
    return !PASSTHROUGH_EVENTS.has(event.type);
  }

  /** 构建真 `<table>`（createElement + textContent，不走 inner-HTML 赋值），据编辑态武装单元格。 */
  toDOM(view: EditorView): HTMLElement {
    const table = document.createElement('table');
    table.className = 'cm-ink-table';
    table.dataset.tableFrom = String(this.tableFrom);
    buildTableBody(table, this);
    this.armCells(table, view);
    return table;
  }

  /**
   * 原地更新（§7 R2）：仅当 sourceText 结构不变（同一 widget 类、cellRanges 等量）才原地改编辑态——
   * 重武装 contenteditable 标志/焦点而不重建整表 DOM（保 caret/组合存活）。sourceText 变则返回 false
   * 让 CM6 重建（doc 改写后表格结构可能变，必须重渲染）。
   */
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (!(dom instanceof HTMLTableElement)) return false;
    if (dom.dataset.tableFrom !== String(this.tableFrom)) return false;
    if (dom.querySelectorAll('th, td').length !== this.cellRanges.length) return false;
    this.armCells(dom, view);
    return true;
  }

  /** 按 activeCellIndex 给每个 td/th 设/撤 contenteditable，并聚焦活动单元格。 */
  private armCells(table: HTMLElement, view: EditorView): void {
    const cells = table.querySelectorAll<HTMLTableCellElement>('th, td');
    cells.forEach((cell, index) => {
      const editing = index === this.activeCellIndex;
      if (editing) {
        if (cell.contentEditable !== 'true') cell.contentEditable = 'true';
        cell.classList.add('cm-ink-cell-editing');
        bindCellHandlers(cell, index, view);
        focusCell(cell, view);
      } else {
        if (cell.contentEditable === 'true') cell.contentEditable = 'inherit';
        cell.classList.remove('cm-ink-cell-editing');
      }
    });
  }
}

/** 放行的事件类型集（输入/键盘/组合/指针落点）。 */
const PASSTHROUGH_EVENTS: ReadonlySet<string> = new Set([
  'mousedown',
  'beforeinput',
  'input',
  'keydown',
  'compositionstart',
  'compositionupdate',
  'compositionend',
]);

/** 标记位：避免对同一 cell 重复绑定 keydown/blur（updateDOM 多次调用时）。 */
const BOUND = '__inkTableBound';

/**
 * 构建表体：据 sourceText 行切分（首行表头、次行对齐分隔、其余数据行），每 cell 经 textContent 写入
 * （反转义 `\|`/`<br>`），并打上 data-cell-index / data-cell-from / data-cell-to。
 */
function buildTableBody(table: HTMLElement, widget: TableWidget): void {
  const rows = widget.sourceText.split('\n').filter((line) => line.trim().length > 0);
  const [headerLine, , ...bodyLines] = rows;
  let cellIndex = 0;

  if (headerLine !== undefined) {
    const thead = document.createElement('thead');
    const { tr, next } = buildRow(splitCells(headerLine), 'th', cellIndex, widget.cellRanges);
    cellIndex = next;
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  if (bodyLines.length > 0) {
    const tbody = document.createElement('tbody');
    for (const line of bodyLines) {
      const { tr, next } = buildRow(splitCells(line), 'td', cellIndex, widget.cellRanges);
      cellIndex = next;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }
}

/** 给单元格绑定 keydown（导航）+ blur（兜底 commit）+ composition（结束后 commit）一次。 */
function bindCellHandlers(cell: HTMLTableCellElement, index: number, view: EditorView): void {
  const marked = cell as HTMLTableCellElement & { [BOUND]?: boolean };
  if (marked[BOUND]) return;
  marked[BOUND] = true;

  cell.addEventListener('keydown', (e) => handleCellKeydown(e, cell, view));
  // 失焦兜底 commit（点表格外/切焦点时落最后一次内容）。组合期不 commit（排队到结束）。
  cell.addEventListener('blur', () => commitCell(cell, view));
  // 组合结束后 commit 一次（中文上屏落 doc）。组合期门内排队，结束后执行。
  cell.addEventListener('compositionend', () => {
    queueAfterComposition(view, `table-cell-commit-${index}`, () => commitCell(cell, view));
  });
  // 非组合输入即时 commit（英文/删改实时同步回 doc）；组合期由 compositionend 接管。
  cell.addEventListener('input', () => {
    if (isComposing(view)) return;
    commitCell(cell, view);
  });
}

/** 拆一行 GFM 表格的单元格文本（按未转义 `|` 分列，去首尾空格；`\|` 不分列）。 */
function splitCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '\\|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** 构建一行 `<tr>`：每 cell createElement + textContent（反转义显示），打 data 索引/区间属性。 */
function buildRow(
  cellSources: string[],
  tag: 'th' | 'td',
  startIndex: number,
  ranges: readonly CellRange[],
): { tr: HTMLTableRowElement; next: number } {
  const tr = document.createElement('tr');
  let idx = startIndex;
  for (const source of cellSources) {
    const cell = document.createElement(tag);
    cell.textContent = unescapePipes(source);
    cell.dataset.cellIndex = String(idx);
    const range = ranges[idx];
    if (range) {
      cell.dataset.cellFrom = String(range.from);
      cell.dataset.cellTo = String(range.to);
    }
    tr.appendChild(cell);
    idx += 1;
  }
  return { tr, next: idx };
}

/**
 * 提交单元格内容回 doc（§3.2）：escapePipes(textContent) → 单点 dispatch 替换该 cell 区间。
 *
 * 组合期排队（绝不在组合期 dispatch）；内容与 doc 现值相等则跳过（避免空 dispatch/多余 history）。
 *
 * 区间**每次在 commit 时从 live 语法树重新解析**（据 cell 的 tableFrom + cellIndex 经 tableModelAt 取最新
 * cellRanges），而非信赖构建期固化的 `data-cell-from/to`——后者在前一次 commit 触发 widget 重建后即陈旧
 * （旧 DOM 节点的 data 属性不更新），盲用会写错位、双提交叠加致内容重复（CDP 实测 root cause，仿
 * TaskCheckboxWidget WR-05 陈旧 pos 校验）。重解析后 cellIndex 越界（结构已变）则放弃本次 commit。
 */
function commitCell(cell: HTMLTableCellElement, view: EditorView): void {
  if (isComposing(view)) {
    const index = cell.dataset.cellIndex ?? '0';
    queueAfterComposition(view, `table-cell-commit-${index}`, () => commitCell(cell, view));
    return;
  }
  const tableFrom = Number(cell.closest<HTMLElement>('table')?.dataset.tableFrom);
  const cellIndex = Number(cell.dataset.cellIndex);
  if (!Number.isFinite(tableFrom) || !Number.isFinite(cellIndex)) return;
  // 从 live 语法树重解析该表当前 cell 区间（防陈旧 data 属性写错位 / 双提交叠加）。
  const model = tableModelAt(view.state, tableFrom);
  const range = model?.cells[cellIndex];
  if (!range) return;
  if (range.to > view.state.doc.length) return;
  // cell 区间含两侧填充空格（delimiter 切分所得）：写回时给内容包单空格 ` 内容 `，保 GFM 列可读、列宽无语义。
  const escaped = escapePipes(cell.textContent ?? '');
  const insert = ` ${escaped} `;
  const current = view.state.doc.sliceString(range.from, range.to);
  if (insert === current) return;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    userEvent: 'input.table.cell',
  });
}

/**
 * 聚焦活动单元格并把 caret 落到末尾（IME 武装关键）。
 *
 * 同步聚焦 + 经 requestAnimationFrame 再聚焦一次：armCells 在 CM6 measure/update 阶段运行，此刻同步
 * `focus()` 易被「浏览器对原始非编辑 td 的点击焦点解析」或 CM 的 update 周期覆盖（CDP 实测 activeEl 回落
 * BODY）。rAF 把聚焦推到本帧绘制后、点击焦点已解析之后再补一次，使 contenteditable 稳获焦点（148 实测
 * 直接 focus() 可武装 IME）。组合期不抢焦点（避免打断合成）；目标已在该 cell 内则跳过。
 */
function focusCell(cell: HTMLTableCellElement, view: EditorView): void {
  if (isComposing(view)) return;
  const doFocus = (): void => {
    if (!cell.isConnected || isComposing(view)) return;
    if (document.activeElement === cell) return;
    cell.focus();
    placeCaretAtEnd(cell);
  };
  doFocus();
  requestAnimationFrame(doFocus);
}

/** 把 caret 落到单元格文本末尾（聚焦后 / commit 后定位，单文本节点简单 Range，不踩 #3339）。 */
function placeCaretAtEnd(cell: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * 单元格键盘导航（§4 Wave 1 子集）：Tab/Shift+Tab（左右移；末格追加行）、Enter（下移；末行追加）、Esc（退出）。
 * 导航前必 commit（保 doc 是最新真相源）；preventDefault + stopPropagation 不让事件冒泡到 CM 主 keymap。
 * 方向键/Shift+Enter/`<br>` 留 Wave 2，此处不拦（让浏览器在 cell 内原生处理）。
 */
function handleCellKeydown(
  event: KeyboardEvent,
  cell: HTMLTableCellElement,
  view: EditorView,
): void {
  // 组合期（IME 候选框打开）的 Enter/Tab 是上屏/选词，绝不拦截为导航——交浏览器原生处理。
  if (isComposing(view) || event.isComposing) return;

  let dir: NavDir | null = null;
  if (event.key === 'Tab') dir = event.shiftKey ? 'prev' : 'next';
  else if (event.key === 'Enter' && !event.shiftKey) dir = 'down';
  else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    commitCell(cell, view);
    exitTableEdit(view);
    return;
  }
  if (!dir) return;

  event.preventDefault();
  event.stopPropagation();
  commitCell(cell, view);
  moveCell(cell, view, dir);
}

/** 退出就地编辑态：清 tableEditState 并把光标落在表格末尾后（光标位置合理、可继续编辑文档）。 */
function exitTableEdit(view: EditorView): void {
  const editing = currentEditCellIndex(view);
  const model = editing ? tableModelAt(view.state, editing.tableFrom) : null;
  const pos = model
    ? Math.min(model.tableTo, view.state.doc.length)
    : view.state.selection.main.head;
  view.dispatch({
    effects: clearTableEdit.of(null),
    selection: EditorSelection.cursor(pos),
  });
  view.focus();
}

/** 据 data-cell-index 取当前 cell 在文档序的下标。 */
function cellIndexOf(cell: HTMLTableCellElement): number {
  return Number(cell.dataset.cellIndex ?? '0');
}

/** 当前编辑态（tableFrom + cellIndex）；读自字段而非 DOM，保与 state 一致。 */
function currentEditCellIndex(view: EditorView): { tableFrom: number; cellIndex: number } | null {
  return view.state.field(tableEditState, false) ?? null;
}

/**
 * 移动到下一单元格（§4）：算目标 → commit 后 dispatch 新编辑态（cell）/ 退出（exit）/ 末尾追加行（appendRow）。
 * 追加行：先插空行 changes，再 setTableEdit 落新行首列；同一 dispatch 完成（doc 与编辑态原子推进）。
 */
function moveCell(cell: HTMLTableCellElement, view: EditorView, dir: NavDir): void {
  const tableFrom = Number(cell.closest<HTMLElement>('table')?.dataset.tableFrom ?? '0');
  const model = tableModelAt(view.state, tableFrom);
  if (!model) return;
  const index = cellIndexOf(cell);
  const result = navigateCell(index, model.columns, model.cells.length, dir);

  if (result.kind === 'cell') {
    view.dispatch({
      effects: setTableEdit.of({ tableFrom: model.tableFrom, cellIndex: result.cellIndex }),
    });
    return;
  }
  if (result.kind === 'exit') {
    const pos = result.before
      ? Math.max(0, model.tableFrom - 1)
      : Math.min(model.tableTo, view.state.doc.length);
    view.dispatch({ effects: clearTableEdit.of(null), selection: EditorSelection.cursor(pos) });
    view.focus();
    return;
  }
  // appendRow：插一空行，编辑态落新行第 result.column 列（= firstCellIndexAfter + column）。
  const change = appendRowChange(model);
  view.dispatch({
    changes: { from: change.at, insert: change.insert },
    effects: setTableEdit.of({
      tableFrom: model.tableFrom,
      cellIndex: change.firstCellIndexAfter + result.column,
    }),
  });
}
