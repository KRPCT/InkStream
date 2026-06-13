import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/**
 * 表格行列操作 + 列对齐的纯模型层（TABLE-WYSIWYG-DESIGN §5 / Wave 2）。
 *
 * 全部无副作用纯函数：语法树 → 行/列结构（含对齐分隔行）、行列增删的 changes 构造、对齐语法改写。
 * 与 tableModel.ts（cell 区间 / 转义 / 导航）分工：本模块管「结构变更」，那边管「单元格内容」。
 * 装饰层 / 工具条 / 右键菜单共用，真相源映射逻辑集中此处便于穷举单测（不碰 EditorView）。
 *
 * 结构读取（实测固化，见 tableModel.ts §3.1 + GFM 对齐行）：Table 子节点序为
 * `TableHeader`（表头行）→ 一个整条 `TableDelimiter`（对齐分隔行，无内部 `|` 子节点）→ 零或多个
 * `TableRow`（数据行）。表头/数据行内每个 `|` 是一个 `TableDelimiter` 子节点；对齐行整条是单个
 * `TableDelimiter`，须按字符串自行切 `|`。所有产物保持合法 GFM（列数一致、delimiter 行保留）。
 */

/** GFM 列对齐：左（`:---`）/ 中（`:--:`）/ 右（`---:`）/ 无显式（`---`，渲染视同左）。 */
export type ColumnAlign = 'left' | 'center' | 'right' | 'none';

/** 一行（表头 / 数据）的结构：行文档区间 + 各 `|`（TableDelimiter）位置（文档序）。 */
export interface TableRowStruct {
  readonly from: number;
  readonly to: number;
  readonly bars: readonly { from: number; to: number }[];
}

/** 对齐分隔行：文档区间 + 行内各 `|` 的绝对文档位置（从源文本切得，保偏移精确）。 */
export interface DelimiterStruct {
  readonly from: number;
  readonly to: number;
  /** 各 `|` 的绝对文档位置（文档序）。 */
  readonly bars: readonly number[];
}

/** 一个表格的完整结构（行 + 对齐分隔行 + 列数 + 各列对齐），供行列操作与对齐改写。 */
export interface TableStruct {
  readonly tableFrom: number;
  readonly tableTo: number;
  readonly columns: number;
  /** 表头行（恒第一行）。 */
  readonly header: TableRowStruct;
  /** 对齐分隔行。 */
  readonly delimiter: DelimiterStruct;
  /** 数据行（不含表头、不含对齐行），文档序。 */
  readonly rows: readonly TableRowStruct[];
  /** 各列当前对齐（由对齐分隔行解析，长度 = columns）。 */
  readonly aligns: readonly ColumnAlign[];
}

/** doc 变更段（单段 from/to/insert）；一个 op 产 1+ 段，调用方一次 dispatch 全部。 */
export interface TableChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** 从一个 TableHeader/TableRow 节点读出行结构（各 `|` 位置）。 */
function readRow(node: SyntaxNode): TableRowStruct {
  const bars: { from: number; to: number }[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'TableDelimiter') bars.push({ from: c.from, to: c.to });
  }
  return { from: node.from, to: node.to, bars };
}

/** 解析对齐分隔行文本（如 `| :-- | --: |`）为各列对齐。 */
export function parseAligns(delimiterText: string): ColumnAlign[] {
  const inner = delimiterText.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((seg) => {
    const s = seg.trim();
    const left = s.startsWith(':');
    const right = s.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return 'none';
  });
}

/** 单列对齐 → 该列分隔单元的 GFM 文本（含两侧填充空格，与既有列宽风格一致）。 */
export function alignToDelimiterCell(align: ColumnAlign): string {
  switch (align) {
    case 'left':
      return ' :--- ';
    case 'center':
      return ' :---: ';
    case 'right':
      return ' ---: ';
    case 'none':
      return ' --- ';
  }
}

/**
 * 从 Table 语法节点 + 对齐行源文本读完整结构（表头 + 对齐行 + 数据行 + 列对齐）。
 *
 * 迭代 Table 直接子节点：首个 TableHeader = 表头；其后第一条整行 TableDelimiter = 对齐分隔行；
 * 各 TableRow = 数据行。列数取表头 `|` 数 - 1。对齐行 `|` 位置由源文本切得（绝对文档位置）。
 * 结构非法（无表头 / 无对齐行 / 列数 <= 0）返回 null。
 *
 * `readDelimiterText` 注入对齐行源文本（解耦 state：装饰层有 doc 可直接传切片，单测可手喂）。
 */
export function tableStructFromNode(
  table: SyntaxNode,
  readDelimiterText: (from: number, to: number) => string,
): TableStruct | null {
  let header: TableRowStruct | null = null;
  let delimNode: { from: number; to: number } | null = null;
  const rows: TableRowStruct[] = [];
  for (let row = table.firstChild; row; row = row.nextSibling) {
    if (row.name === 'TableHeader') {
      header = readRow(row);
    } else if (row.name === 'TableDelimiter' && header && !delimNode) {
      // 表头后第一条整行 TableDelimiter = 对齐分隔行（行内 `|` 是 TableHeader/TableRow 的子节点，不在此）。
      delimNode = { from: row.from, to: row.to };
    } else if (row.name === 'TableRow') {
      rows.push(readRow(row));
    }
  }
  if (!header || !delimNode) return null;
  const columns = header.bars.length - 1;
  if (columns <= 0) return null;

  const delimText = readDelimiterText(delimNode.from, delimNode.to);
  const bars: number[] = [];
  for (let i = 0; i < delimText.length; i++) {
    if (delimText[i] === '|') bars.push(delimNode.from + i);
  }
  const parsed = parseAligns(delimText);
  const aligns: ColumnAlign[] = Array.from({ length: columns }, (_, i) => parsed[i] ?? 'none');

  return {
    tableFrom: table.from,
    tableTo: table.to,
    columns,
    header,
    delimiter: { from: delimNode.from, to: delimNode.to, bars },
    rows,
    aligns,
  };
}

/**
 * 在 doc 位置 pos 所属的 Table 上提取完整结构（含对齐）。
 *
 * 与 tableModelAt 同路找 Table 祖先；结构 + 对齐由 tableStructFromNode 读（对齐行文本取自 state.doc）。
 * pos 不在任何 Table 内或结构非法返回 null。
 */
export function tableStructAt(state: EditorState, pos: number): TableStruct | null {
  const tree = syntaxTree(state);
  const inner = tree.resolveInner(pos, 1);
  let table: SyntaxNode | null = null;
  for (let n: SyntaxNode | null = inner; n; n = n.parent) {
    if (n.name === 'Table') {
      table = n;
      break;
    }
  }
  if (!table) return null;
  return tableStructFromNode(table, (from, to) => state.doc.sliceString(from, to));
}

/** 全部行（表头 + 数据行），文档序——行操作定位用。 */
function allRows(struct: TableStruct): TableRowStruct[] {
  return [struct.header, ...struct.rows];
}

/** cellIndex（文档序扁平，跨表头 + 各数据行）→ 行号（0=表头）+ 列号。 */
export function rowColOf(struct: TableStruct, cellIndex: number): { row: number; col: number } {
  return { row: Math.floor(cellIndex / struct.columns), col: cellIndex % struct.columns };
}

/** cellIndex 所在列号（列对齐/列操作入口直接用）。 */
export function columnOf(struct: TableStruct, cellIndex: number): number {
  return cellIndex % struct.columns;
}

/** 构造一行空 GFM 数据行（列数 = columns，每 cell 三空格占位）。 */
function blankRow(columns: number): string {
  const blanks = Array.from({ length: columns }, () => '   ').join('|');
  return `|${blanks}|`;
}

/**
 * 插入行（§5）：在 cellIndex 所在行的上方（above=true）或下方插入空行。
 *
 * 边界：表头行（row=0）上方插入时——GFM 表头恒第一行，改插到对齐行之后（成为首个数据行），
 * 仍保表格合法。返回单段 change。
 */
export function insertRowChange(
  struct: TableStruct,
  cellIndex: number,
  above: boolean,
): TableChange {
  const { row } = rowColOf(struct, cellIndex);
  const rows = allRows(struct);
  const target = rows[row] ?? struct.header;
  const blank = blankRow(struct.columns);
  if (above && row === 0) {
    // 表头上方不可插数据行：落到对齐行之后（首个数据行位）。
    return { from: struct.delimiter.to, to: struct.delimiter.to, insert: `\n${blank}` };
  }
  if (above) {
    return { from: target.from, to: target.from, insert: `${blank}\n` };
  }
  return { from: target.to, to: target.to, insert: `\n${blank}` };
}

/**
 * 删除行（§5）：删除 cellIndex 所在数据行（含其前一个换行，不留空行）。
 *
 * 边界（硬约束）：禁删表头行与对齐分隔行（row=0 返回 null）；目标非数据行返回 null。
 * 删到只剩表头（无数据行）合法——表格保留表头 + 对齐行即为合法空表，故不额外禁止删最后一个数据行。
 */
export function deleteRowChange(struct: TableStruct, cellIndex: number): TableChange | null {
  const { row } = rowColOf(struct, cellIndex);
  if (row === 0) return null; // 表头不可删。
  const target = struct.rows[row - 1];
  if (!target) return null;
  const from = Math.max(struct.tableFrom, target.from - 1); // 连同行首前的换行删除。
  return { from, to: target.to, insert: '' };
}

/**
 * 插入列（§5）：在 col 列左（before=true）/右插入空列——每行（含表头、对齐行）同步加一个 cell。
 *
 * 对每行在「插入点 `|`」之后插一段：数据/表头行插 `   |`（三空格 cell + 闭合 `|`）、对齐行插 ` --- |`。
 * 插入点 barIndex：before → col 列左 `|`（bars[col]）；否则右 `|`（bars[col+1]）。多段 change 一次 dispatch。
 */
export function insertColumnChanges(
  struct: TableStruct,
  col: number,
  before: boolean,
): TableChange[] {
  const changes: TableChange[] = [];
  const barIndex = before ? col : col + 1;
  for (const r of allRows(struct)) {
    const bar = r.bars[barIndex];
    if (!bar) continue;
    changes.push({ from: bar.to, to: bar.to, insert: '   |' });
  }
  const delimBar = struct.delimiter.bars[barIndex];
  if (delimBar != null) {
    changes.push({ from: delimBar + 1, to: delimBar + 1, insert: ' --- |' });
  }
  return changes;
}

/**
 * 删除列（§5）：删 col 列——每行（含表头、对齐行）删掉该列的 cell + 一个 `|`。
 *
 * 边界：删到只剩一列时停（columns <= 1 返回空数组，调用方不 dispatch）。
 * 非末列删 `[bars[col].to, bars[col+1].to]`（内容 + 右 `|`）；末列删 `[bars[col].from, bars[col+1].from]`
 * （左 `|` + 内容，保留行尾闭合 `|`）。对齐行同理（按 `|` 绝对位置）。
 */
export function deleteColumnChanges(struct: TableStruct, col: number): TableChange[] {
  if (struct.columns <= 1) return [];
  const changes: TableChange[] = [];
  const last = struct.columns - 1;
  for (const r of allRows(struct)) {
    if (col < last) {
      changes.push({ from: r.bars[col].to, to: r.bars[col + 1].to, insert: '' });
    } else {
      changes.push({ from: r.bars[col].from, to: r.bars[col + 1].from, insert: '' });
    }
  }
  const db = struct.delimiter.bars;
  if (col < last) {
    changes.push({ from: db[col] + 1, to: db[col + 1] + 1, insert: '' });
  } else {
    changes.push({ from: db[col], to: db[col + 1], insert: '' });
  }
  return changes;
}

/**
 * 列对齐（§5）：把 col 列设为 align——只改对齐分隔行对应列标记（GFM `:---`/`:--:`/`---:`/`---`）。
 *
 * 单段 change 替换对齐行第 col 个 cell 区间（相邻 `|` 之间）为新对齐标记。真相源用 GFM 语法，不用 HTML style。
 * 越界返回 null。
 */
export function setAlignChange(
  struct: TableStruct,
  col: number,
  align: ColumnAlign,
): TableChange | null {
  if (col < 0 || col >= struct.columns) return null;
  const bars = struct.delimiter.bars;
  if (col + 1 >= bars.length) return null;
  return { from: bars[col] + 1, to: bars[col + 1], insert: alignToDelimiterCell(align) };
}
