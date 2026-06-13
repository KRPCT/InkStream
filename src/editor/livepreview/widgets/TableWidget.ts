import { type EditorView, WidgetType } from '@codemirror/view';
import { type CellRange, unescapePipes } from '../tableModel';
import type { ColumnAlign } from '../tableOps';
import { tableEditState } from '../tableEditState';
import {
  destroyActive,
  destroyForWrap,
  getActiveCellEditor,
  mountCell,
  registerWrapOwner,
} from '../tableCellEditor';
import { buildTableToolbar } from './tableToolbar';

/**
 * GFM 表格 widget（块级层 / 方案 B 嵌套 EditorView 就地编辑 / Security V5 XSS 防护）。
 *
 * 职责（方案 B，TABLE-REDESIGN §3，反转方案 A 的 contenteditable td + textContent commit）：把 GFM 表格
 * 片段渲染为真 `<table>`（**恒渲染、永不显示源码**），并据就地编辑态 `activeCellIndex` 在对应 td/th 内挂一个
 * **嵌套迷你 CM6 EditorView**（`tableCellEditor.mountCell`）——光标任意定位 / 拖拽选区 / 删字符不删格 / 撤销 /
 * 中文 IME 全由 CM6 内核**原生**承载。同一时刻只激活当前单元格一个子编辑器（其余 td 静态只读）。
 * 子→主同步、跨格导航、删除收口全在 `tableCellEditor.ts`；本 widget 只管渲染 + 武装/卸载子编辑器。
 *
 * 真相源映射（§3 + delimiter 切分）：blockField 传入每个 td/th 的源区间（cellRanges，文档序扁平；区间 =
 * 相邻 `|` 之间，含两侧填充空格——对空 cell 也稳健，lezer 不产空 TableCell）。子编辑器 docChanged 即
 * `escapePipes` 写回 `[cellFrom,cellTo]`（详见 tableCellEditor.commitSub）；state.doc 仍唯一 GFM 真相源。
 *
 * IME（§3.3）：子 contentDOM 是独立 IME 宿主、与主编辑器同款 CM6、同份 @codemirror 类、同 Chromium 148
 * 路径；组合期 CM6 内核自管不撕子 DocView，子→主写回经主门 queueAfterComposition 排队（不在组合期 dispatch
 * 主 doc → 不撕承载子编辑器的 widget DOM）。
 *
 * widget 复用（§3.4 R2 关键）：`eq()` 把 sourceText + activeCellIndex 纳入判据；`updateDOM` 在结构
 * （renderSig）不变时**原地更新**（重武装 → mountCell 幂等复用同一子编辑器实例，**保 caret/组合存活、不吞字**），
 * 仅结构变（行列增删 / 对齐）才重建。子编辑器实例存模块级 WeakMap（绝不进 Zustand），destroy 与挂载配对。
 *
 * 安全（T-03-12 / Security V5）：静态 td/th 文本经 `textContent` 写入，DOM 一律 createElement 构建，
 * **绝不走 HTML 字符串赋值路径**。样式经 class 消费 var(--cm-table-*)，**永不硬编码色值**（tableTheme 提供）。
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
    /** 各列 GFM 对齐（td/th 的 text-align 跟随；长度 = columns，缺省全 'none'）。 */
    readonly aligns: readonly ColumnAlign[] = [],
  ) {
    super();
  }

  /**
   * 相等判据：sourceText + tableFrom + activeCellIndex + aligns 同则视为同一 widget。
   * cellRanges 由 sourceText + tableFrom 唯一决定（同一语法树切片），故不必逐项比对。
   * activeCellIndex 入判据使「编辑态切换」触发 widget 更新（经 updateDOM 原地处理，不重建）。
   * aligns 入判据使「仅改对齐」（对齐行变 → sourceText 必变，实际已覆盖；显式入判保稳健）触发重渲染。
   */
  eq(other: TableWidget): boolean {
    return (
      other.sourceText === this.sourceText &&
      other.tableFrom === this.tableFrom &&
      other.activeCellIndex === this.activeCellIndex &&
      sameAligns(other.aligns, this.aligns)
    );
  }

  /**
   * 事件归属（方案 B）：放行 mousedown（返回 false）使 tableGesture 的 domEventHandlers 能在 widget 内
   * 命中——CM6 对 `ignoreEvent` 返回 true 的 widget 内事件**不触发** view 级 domEventHandlers（CDP 实测：
   * 误返 true 时点单元格零事务、子编辑器不挂载 root cause）。进编辑态后由 tableGesture 对该 mousedown
   * **preventDefault**（防主编辑器抢焦点/移主选区，焦点交子编辑器）。其余事件（子编辑器 input/keydown/
   * composition）一律忽略——它们是**子 contentDOM 自己的**事件，由子 EditorView 内核消费，主编辑器不解析；
   * 子组合事件冒泡到 document，主门仍能识别做写回排队（§3.4）。
   */
  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }

  /**
   * 构建 widget DOM（createElement + textContent，不走 inner-HTML 赋值）：外层 wrap 容器（position
   * relative，承绝对定位的悬浮工具条）内含真 `<table>` + 悬浮工具条（§5 入口 a）。据编辑态武装单元格、
   * 据 aligns 设各列 text-align。
   */
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-ink-table-wrap';
    // 整表 widget 标记为不可编辑岛（CM6 官方嵌套编辑器范式）：主编辑器 DOMObserver 不下钻解析 widget 内部
    // DOM 变化——否则子 EditorView 在自己 contentDOM 里键入会被主 observer 误读为「主 doc 在 widget 边界处
    // 的编辑」（CDP 实测：子编辑器有焦点、却把 X 插到主 doc pos 0 的 root cause）。活动单元格内子 contentDOM
    // 显式 contenteditable=true 覆盖此 false，成为唯一可编辑区。
    wrap.contentEditable = 'false';
    wrap.dataset.tableFrom = String(this.tableFrom);
    // 渲染体签名（sourceText + aligns）：updateDOM 据此判定「仅编辑态变（原地武装）」vs「体变（须重建）」。
    wrap.dataset.renderSig = this.renderSig();
    const table = document.createElement('table');
    table.className = 'cm-ink-table';
    table.dataset.tableFrom = String(this.tableFrom);
    buildTableBody(table, this);
    wrap.appendChild(table);
    // 悬浮工具条：操作目标 cellIndex = 当前就地编辑态（无则首格 0）。hover 显隐由 CSS 控制。
    buildTableToolbar(wrap, this.tableFrom, view, () => activeCellIndexFor(view, this.tableFrom));
    this.armCells(wrap, view);
    return wrap;
  }

  /**
   * 原地更新签名：列结构（cell 数 + 列数）+ 各列对齐（aligns）。
   *
   * 故意**不含 cell 文本**：就地编辑（英文连打 / 中文上屏）每次 commit 改 sourceText 但不改此签名——
   * 此时走原地武装路径（保活动 contenteditable 的 caret/组合，不重建整表，Wave 1 不退化）。而列对齐 /
   * 插删行列改变 aligns / cell 数 / 列数 → 签名变 → 重建（td text-align 与新结构正确反映，CDP 实测修复）。
   */
  private renderSig(): string {
    return `${this.cellRanges.length}/${this.columns}/${this.aligns.join(',')}`;
  }

  /**
   * 原地更新（§7 R2）：仅当**列结构 + 对齐不变**（renderSig 相同——典型为「仅 cell 文本 / 编辑态变」）才
   * 原地改编辑态——重武装 contenteditable 标志/焦点而不重建整表 DOM（保 caret/组合存活，Wave 1 关键）。
   * 列对齐变 / 插删行列（aligns 或 cell 数 / 列数变）则返回 false 让 CM6 重建——否则旧 DOM 的 text-align /
   * 行列结构会陈旧（CDP 实测：仅改对齐时 cell 数不变，只比 tableFrom + cell 数会误判可原地复用致 td
   * text-align 不更新）。
   */
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (!(dom instanceof HTMLElement) || !dom.classList.contains('cm-ink-table-wrap')) return false;
    if (dom.dataset.tableFrom !== String(this.tableFrom)) return false;
    // 列结构 / 对齐签名不同（列对齐 / 行列结构变）：必须重建，原地复用会留陈旧 DOM。
    if (dom.dataset.renderSig !== this.renderSig()) return false;
    this.armCells(dom, view);
    return true;
  }

  /**
   * widget DOM 被 CM6 移除时销毁本表关联的活动子编辑器（删表 / 视口滚出 / 结构重建另起 DOM），
   * 杜绝子 EditorView 泄漏（§3.4 R2 destroy 与挂载严格配对，StrictMode 纪律）。
   */
  destroy(dom: HTMLElement): void {
    destroyForWrap(dom);
  }

  /**
   * 武装活动单元格（方案 B）：在 activeCellIndex 对应 td 内挂嵌套子 EditorView（mountCell 幂等复用），
   * 其余 td 静态只读（保留 textContent）。无活动格（activeCellIndex=null，且当前活动子编辑器属本表）时卸载。
   *
   * 活动 td 的静态 textContent 须清空——子编辑器的 contentDOM 才是该格可视内容（否则源文本与子编辑器双显）。
   */
  private armCells(root: HTMLElement, view: EditorView): void {
    registerWrapOwner(root, view); // 供 destroy(dom) 反查持有主 view（销毁配对）。
    const cells = root.querySelectorAll<HTMLTableCellElement>('th, td');
    const active = this.activeCellIndex;
    if (active == null) {
      // 本表无活动格：若当前活动子编辑器属本表，卸载（点别表 / 退出态）。
      const cur = getActiveCellEditor(view);
      if (cur && cur.tableFrom === this.tableFrom) destroyActive(view);
      return;
    }
    cells.forEach((cell, index) => {
      if (index !== active) {
        cell.classList.remove('cm-ink-cell-editing');
        return;
      }
      cell.classList.add('cm-ink-cell-editing');
      cell.textContent = ''; // 让位给子编辑器 contentDOM（避免源文本与子编辑器双显）。
      mountCell(view, cell, this.tableFrom, index);
    });
  }
}

/** 两 aligns 数组逐项相等（eq 判据用，避免 JSON.stringify 开销）。 */
function sameAligns(a: readonly ColumnAlign[], b: readonly ColumnAlign[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 取 view 当前就地编辑态在 tableFrom 表内的 cellIndex（无/异表则回落首格 0，供工具条操作有据）。 */
function activeCellIndexFor(view: EditorView, tableFrom: number): number {
  const edit = view.state.field(tableEditState, false) ?? null;
  return edit && edit.tableFrom === tableFrom ? edit.cellIndex : 0;
}

/** ColumnAlign → CSS text-align（'none' = 不设，继承默认左对齐）。 */
function cssTextAlign(align: ColumnAlign | undefined): string {
  switch (align) {
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    default:
      return '';
  }
}

/**
 * 构建表体：据 sourceText 行切分（首行表头、次行对齐分隔、其余数据行），每 cell 经 textContent 写入
 * （反转义 `\|`/`<br>`），并打上 data-cell-index / data-cell-from / data-cell-to。
 */
function buildTableBody(table: HTMLElement, widget: TableWidget): void {
  const rows = widget.sourceText.split('\n').filter((line) => line.trim().length > 0);
  const [headerLine, , ...bodyLines] = rows;
  let cellIndex = 0;
  const aligns = widget.aligns;

  if (headerLine !== undefined) {
    const thead = document.createElement('thead');
    const { tr, next } = buildRow(splitCells(headerLine), 'th', cellIndex, widget.cellRanges, aligns);
    cellIndex = next;
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  if (bodyLines.length > 0) {
    const tbody = document.createElement('tbody');
    for (const line of bodyLines) {
      const { tr, next } = buildRow(splitCells(line), 'td', cellIndex, widget.cellRanges, aligns);
      cellIndex = next;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }
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

/**
 * 构建一行 `<tr>`：每 cell createElement + textContent（反转义显示），打 data 索引/区间属性，
 * 并据该列 GFM 对齐（aligns[col]）设 text-align（真相源是对齐分隔行，此处仅渲染跟随，不引 HTML style 入 doc）。
 */
function buildRow(
  cellSources: string[],
  tag: 'th' | 'td',
  startIndex: number,
  ranges: readonly CellRange[],
  aligns: readonly ColumnAlign[],
): { tr: HTMLTableRowElement; next: number } {
  const tr = document.createElement('tr');
  let idx = startIndex;
  let col = 0;
  for (const source of cellSources) {
    const cell = document.createElement(tag);
    cell.textContent = unescapePipes(source);
    cell.dataset.cellIndex = String(idx);
    const range = ranges[idx];
    if (range) {
      cell.dataset.cellFrom = String(range.from);
      cell.dataset.cellTo = String(range.to);
    }
    const ta = cssTextAlign(aligns[col]);
    if (ta) cell.style.textAlign = ta;
    tr.appendChild(cell);
    idx += 1;
    col += 1;
  }
  return { tr, next: idx };
}
