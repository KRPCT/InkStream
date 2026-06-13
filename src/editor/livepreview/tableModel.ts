import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

/**
 * 表格就地编辑的纯模型层（TABLE-WYSIWYG-DESIGN §3 / Wave 1）。
 *
 * 全部为无副作用纯函数：语法树 → cell 区间、`|` 转义/反转义、单元格导航索引计算。装饰层 / 手势层 /
 * 状态层共用本模块，真相源映射逻辑集中此处便于穷举单测（不碰 EditorView，只读 EditorState + 语法树）。
 *
 * 真相源映射（实测固化 + 空格 cell 修正）：单元格区间**由每行的 `TableDelimiter`（`|`）位置切分得出**——
 * cell 区间 = 相邻两 `|` 之间 `(delim[i].to, delim[i+1].from)`。比直接取 `TableCell` 节点稳健：lezer GFM
 * **对纯空格/空单元格不产 `TableCell` 节点**（`|   |   |` 行只有 3 个 TableDelimiter、零 TableCell），按
 * TableCell 索引会与可视列错位；按 delimiter 切分则每列恒有区间（含空 cell）。对齐分隔行整条是单个
 * `TableDelimiter`、无内部 `|`，天然不产可编辑 cell。commit 直接替换该区间（含填充空格）为 ` 内容 `。
 */

/** 单元格在文档中的内容区间（相邻 `|` 之间，含两侧填充空格）。 */
export interface CellRange {
  readonly from: number;
  readonly to: number;
}

/** 一个表格的全部可编辑单元格区间（按文档序：表头行 cell 在前，数据行 cell 依次其后）。 */
export interface TableCellModel {
  /** Table 节点起点（与 blockField.tables 的 from 对齐，作表格身份键）。 */
  readonly tableFrom: number;
  /** Table 节点终点。 */
  readonly tableTo: number;
  /** 列数（据表头行 TableCell 数；畸形表回落首个非空行）。 */
  readonly columns: number;
  /** 全部 TableCell 区间，文档序扁平排列；cellIndex 即此数组下标。 */
  readonly cells: readonly CellRange[];
}

/**
 * 读：在给定文档位置 `pos` 所属的 Table 节点上，提取全部 TableCell 区间（§3.1）。
 *
 * 用语法树定位包含 `pos` 的 Table 节点，迭代其子树收集所有 TableCell；列数取表头行
 * （首个 TableHeader）的 cell 数。`pos` 不在任何 Table 内（或表无 cell）返回 null。
 */
export function tableModelAt(state: EditorState, pos: number): TableCellModel | null {
  const tree = syntaxTree(state);
  // 自 pos 向上找最近的 Table 祖先（side=1 让表格起点 pos=0 也解析进表内，而非落到表前）。
  const inner = tree.resolveInner(pos, 1);
  let table: typeof inner | null = null;
  for (let n: typeof inner | null = inner; n; n = n.parent) {
    if (n.name === 'Table') {
      table = n;
      break;
    }
  }
  if (!table) return null;
  return tableModelFromNode(table);
}

/**
 * 从 Table 语法节点提取 cell 模型（与 blockField.collectCells 共用，避免双份遍历逻辑）。
 *
 * 迭代 Table 直接子行（TableHeader / 数据 TableRow；中间的对齐分隔 TableDelimiter 跳过——它无内部
 * `|` 子节点故自然不产 cell），每行按其 TableDelimiter（`|`）位置切分出各列区间。列数 = 表头行列数。
 */
export function tableModelFromNode(
  table: import('@lezer/common').SyntaxNode,
): TableCellModel | null {
  const cells: CellRange[] = [];
  let columns = 0;
  for (let row = table.firstChild; row; row = row.nextSibling) {
    if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue;
    const rowCells = splitRowByDelimiters(row);
    if (row.name === 'TableHeader') columns = rowCells.length;
    cells.push(...rowCells);
  }
  if (cells.length === 0 || columns === 0) return null;
  return { tableFrom: table.from, tableTo: table.to, columns, cells };
}

/** 按一行（TableHeader/TableRow）的 TableDelimiter（`|`）位置切出各列区间（相邻 `|` 之间，含填充空格）。 */
function splitRowByDelimiters(row: import('@lezer/common').SyntaxNode): CellRange[] {
  const delims: Array<{ from: number; to: number }> = [];
  for (let c = row.firstChild; c; c = c.nextSibling) {
    if (c.name === 'TableDelimiter') delims.push({ from: c.from, to: c.to });
  }
  const cells: CellRange[] = [];
  for (let i = 0; i + 1 < delims.length; i++) {
    cells.push({ from: delims[i].to, to: delims[i + 1].from });
  }
  return cells;
}

/**
 * 写：把 DOM 文本（单元格的 textContent）转义为合法 GFM 单元格源（§3.2）。
 *
 * - 未转义的字面 `|` → `\|`（否则破坏列结构）；已转义的 `\|` 保持不变（不二次转义）。
 * - 换行 `\n` → `<br>`（GFM 单元格内换行的唯一合法表达；Shift+Enter 走此路，Wave 1 不主动产生）。
 * - 首尾空白裁掉（与 GFM「cell 两侧填充空格无语义」一致，避免 commit 引入噪声空格）。
 */
export function escapePipes(text: string): string {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  let out = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      out += '\\|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      out += '\\|';
      continue;
    }
    if (ch === '\n') {
      out += '<br>';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 反向：把 GFM 单元格源还原为显示文本（供 contenteditable 写入 textContent）。
 *
 * `\|` → `|`、`<br>`（大小写不敏感、容忍 `<br/>`/`<br />`）→ 换行。其余逐字。
 */
export function unescapePipes(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\' && source[i + 1] === '|') {
      out += '|';
      i += 1;
      continue;
    }
    if (ch === '<') {
      const m = /^<br\s*\/?>/i.exec(source.slice(i));
      if (m) {
        out += '\n';
        i += m[0].length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** 导航方向（§4 Tab/Shift+Tab/Enter/方向键归并为「下一目标 cellIndex」计算）。 */
export type NavDir = 'next' | 'prev' | 'down' | 'up';

/** 导航结果：移动到同表另一 cell / 越出表格首尾 / 需在末尾追加一行后再落位。 */
export type NavResult =
  | { readonly kind: 'cell'; readonly cellIndex: number }
  | { readonly kind: 'exit'; readonly before: boolean }
  | { readonly kind: 'appendRow'; readonly column: number };

/**
 * 据当前 cellIndex + 列数 + 总 cell 数计算导航目标（§4，纯整数运算，穷举单测）。
 *
 * cells 为文档序扁平数组（表头行 columns 个 + 各数据行 columns 个）。规则：
 * - next：右移一格；末格 → appendRow（落新行首列）。
 * - prev：左移一格；首格 → exit before（光标回表格前）。
 * - down：下移同列；末行 → appendRow（同列）。
 * - up：上移同列；首行（表头行）→ exit before。
 */
export function navigateCell(
  cellIndex: number,
  columns: number,
  totalCells: number,
  dir: NavDir,
): NavResult {
  const lastIndex = totalCells - 1;
  const column = cellIndex % columns;
  switch (dir) {
    case 'next':
      if (cellIndex >= lastIndex) return { kind: 'appendRow', column: 0 };
      return { kind: 'cell', cellIndex: cellIndex + 1 };
    case 'prev':
      if (cellIndex <= 0) return { kind: 'exit', before: true };
      return { kind: 'cell', cellIndex: cellIndex - 1 };
    case 'down': {
      const target = cellIndex + columns;
      if (target > lastIndex) return { kind: 'appendRow', column };
      return { kind: 'cell', cellIndex: target };
    }
    case 'up': {
      const target = cellIndex - columns;
      if (target < 0) return { kind: 'exit', before: true };
      return { kind: 'cell', cellIndex: target };
    }
  }
}

/**
 * 末行追加一空行的 changes（§4/§5 最小版）：在 Table 末尾换行后插入 `| 空 | 空 ... |`。
 *
 * 列数 = model.columns；插入点取 model.tableTo（表格末尾）。返回 changes + 新行首列的目标 cellIndex
 * （= 追加前 totalCells，因新 cell 接在文档序末尾）。Tab/Enter 末格/末行越界时调用。
 */
export function appendRowChange(model: TableCellModel): {
  readonly insert: string;
  readonly at: number;
  readonly firstCellIndexAfter: number;
} {
  const blanks = Array.from({ length: model.columns }, () => '   ').join('|');
  const insert = `\n|${blanks}|`;
  return {
    insert,
    at: model.tableTo,
    firstCellIndexAfter: model.cells.length,
  };
}
