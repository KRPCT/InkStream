import { WidgetType } from '@codemirror/view';

/**
 * GFM 表格 widget（块级层 / RESEARCH Pattern 2 + Security V5 / UI-SPEC GFM 表格）。
 *
 * 职责：把一段 GFM 表格 markdown 片段（sourceText）渲染为真 `<table>`（thead/tbody/th/td），
 * 经 blockField 以 `Decoration.replace({ widget, block: true })` 整块替换原文（光标进块时由
 * blockField 整块还原源码，D-06）。
 *
 * 安全（T-03-12 / RESEARCH Security V5）：本阶段无 markdown sanitizer，单元格内容来自用户文档
 * （未受信）。故 DOM 一律经 `document.createElement` 逐元素构建，单元格文本经 `textContent` 写入，
 * **绝不用 HTML 字符串赋值拼用户内容**——`<img onerror=...>` 等只作纯文本，不解析为元素、不执行脚本。
 * （rich-markdoc 走 HTML 字符串赋值是因 markdoc 已 sanitize，本阶段不具该前提，必须 DOM 构建。）
 *
 * 性能（RESEARCH 性能纪律）：`eq(other)` 按 sourceText 比较——同源不重建 DOM（防闪烁）；
 * 表格非交互（`ignoreEvent` 返回 true），点击经 blockField 整块还原进编辑。
 *
 * 样式经 class 消费 `var(--cm-table-border)` / `var(--cm-table-header-bg)` + 内边距 sm/sm2，
 * **永不硬编码色值**（同 highlightTheme.ts / inlinePlugin 纪律）。表格 CSS 由 tableTheme 提供。
 */
export class TableWidget extends WidgetType {
  constructor(readonly sourceText: string) {
    super();
  }

  /** 同 sourceText 视为同一 widget：CM6 复用旧 DOM，不重建（防渲染闪烁）。 */
  eq(other: TableWidget): boolean {
    return other.sourceText === this.sourceText;
  }

  /** 表格非交互：吞掉内部事件，光标定位/编辑经 blockField 整块还原承接（D-06）。 */
  ignoreEvent(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const table = document.createElement('table');
    table.className = 'cm-ink-table';

    // 行级 split：GFM 表格首行为表头，第二行为对齐分隔（`| - | - |`），其余为数据行。
    const rows = this.sourceText.split('\n').filter((line) => line.trim().length > 0);
    const [headerLine, , ...bodyLines] = rows;

    if (headerLine !== undefined) {
      const thead = document.createElement('thead');
      thead.appendChild(buildRow(splitCells(headerLine), 'th'));
      table.appendChild(thead);
    }

    if (bodyLines.length > 0) {
      const tbody = document.createElement('tbody');
      for (const line of bodyLines) {
        tbody.appendChild(buildRow(splitCells(line), 'td'));
      }
      table.appendChild(tbody);
    }

    return table;
  }
}

/**
 * 拆一行 GFM 表格的单元格文本（按未转义 `|` 分列，去首尾空格）。
 *
 * GFM 行形如 `| a | b |`：去掉首尾的边界 `|`，再按 `|` 切分；`\|` 为转义竖线（不分列）。
 */
function splitCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|';
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
 * 构建一行 `<tr>`，每个单元格用 createElement(tag) + textContent 写入（绝不用 HTML 字符串赋值）。
 *
 * tag 为 'th'（表头）或 'td'（数据行）。单元格内容作纯文本——XSS 防护核心（T-03-12）。
 */
function buildRow(cells: string[], tag: 'th' | 'td'): HTMLTableRowElement {
  const tr = document.createElement('tr');
  for (const text of cells) {
    const cell = document.createElement(tag);
    cell.textContent = text;
    tr.appendChild(cell);
  }
  return tr;
}
