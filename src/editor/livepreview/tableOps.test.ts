import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { extensionsForLanguage } from '../languages';
import { tableModelAt } from './tableModel';
import {
  type TableChange,
  type TableStruct,
  alignToDelimiterCell,
  columnOf,
  deleteColumnChanges,
  deleteRowChange,
  insertColumnChanges,
  insertRowChange,
  parseAligns,
  setAlignChange,
  tableStructAt,
} from './tableOps';

/**
 * 表格行列操作 + 对齐纯模型层回归门（TABLE-WYSIWYG-DESIGN §5 / Wave 2）。
 *
 * 全部纯函数穷举（产物必须合法 GFM：列数一致、delimiter 行保留、对齐语法正确）：
 *   1. tableStructAt / parseAligns——结构 + 对齐解析（表头/对齐行/数据行 + 各列对齐）；
 *   2. insertRowChange / deleteRowChange——插删行 + 边界（禁删表头/对齐行）；
 *   3. insertColumnChanges / deleteColumnChanges——插删列（每行同步 + delimiter 同步）+ 边界（剩一列停）；
 *   4. setAlignChange / alignToDelimiterCell——对齐改写为 GFM `:---`/`:--:`/`---:`。
 *
 * 验收手法：构造 doc → state → tableStructAt 读结构 → 对其调 op → 把 changes 套回 doc → 断言
 * 「新 doc 字符串」+「新 doc 经 tableModelAt 仍合法（列数/cell 数）」。
 */

const TWO_BY_TWO = '| a | bb |\n| --- | --- |\n| 1 | 222 |';
const THREE_COL = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |';

/** 用 markdown(GFM) 构建只读 state（取语法树用，无 view）。 */
function mdState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [extensionsForLanguage('markdown')] });
}

/** 把一组 changes 套回 doc 字符串（文档序，逆序套避免位移失配）。 */
function applyChanges(doc: string, changes: readonly TableChange[]): string {
  const sorted = [...changes].sort((a, b) => b.from - a.from);
  let out = doc;
  for (const c of sorted) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

/** 读首个表格结构（pos 落表头 cell 内）。 */
function structOf(doc: string): TableStruct {
  return tableStructAt(mdState(doc), doc.indexOf('|') + 2)!;
}

describe('tableStructAt 结构 + 对齐解析', () => {
  it('2x2 表：列数 2、表头/对齐行/1 数据行', () => {
    const s = structOf(TWO_BY_TWO);
    expect(s.columns).toBe(2);
    expect(s.rows.length).toBe(1);
    expect(s.header.bars.length).toBe(3); // 2 列 → 3 个 `|`。
    expect(s.aligns).toEqual(['none', 'none']);
  });

  it('解析对齐：左 :--- / 中 :--: / 右 ---:', () => {
    expect(parseAligns('| :--- | :--: | ---: |')).toEqual(['left', 'center', 'right']);
    expect(parseAligns('| --- | --- |')).toEqual(['none', 'none']);
  });

  it('tableStructAt 读出各列对齐', () => {
    const s = structOf('| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |');
    expect(s.aligns).toEqual(['left', 'center', 'right']);
  });

  it('pos 不在表格内返回 null', () => {
    expect(tableStructAt(mdState('普通段落。'), 2)).toBeNull();
  });
});

describe('insertRowChange 插入行（§5）', () => {
  it('下方插入：表格多一空数据行，列数不变，合法 GFM', () => {
    const s = structOf(TWO_BY_TWO);
    const ch = insertRowChange(s, 2, false); // cellIndex 2 = 首个数据格（第 2 行第 1 列）。
    const next = applyChanges(TWO_BY_TWO, [ch]);
    const m = tableModelAt(mdState(next), 0)!;
    expect(m.columns).toBe(2);
    expect(m.cells.length).toBe(6); // 表头 2 + 两数据行各 2。
    expect(next.split('\n').length).toBe(4); // 表头 + 对齐 + 2 数据行。
  });

  it('上方插入（数据行）：在该行之上多一空行', () => {
    const s = structOf(TWO_BY_TWO);
    const ch = insertRowChange(s, 2, true);
    const next = applyChanges(TWO_BY_TWO, [ch]);
    const lines = next.split('\n');
    expect(lines.length).toBe(4);
    // 新空行在原数据行之上（第 3 行是空行、第 4 行是原 `| 1 | 222 |`）。
    expect(lines[3]).toContain('222');
    expect(tableModelAt(mdState(next), 0)!.columns).toBe(2);
  });

  it('表头行上方插入：不破坏表头（落到对齐行之后成首个数据行）', () => {
    const s = structOf(TWO_BY_TWO);
    const ch = insertRowChange(s, 0, true); // cellIndex 0 = 表头首格。
    const next = applyChanges(TWO_BY_TWO, [ch]);
    const lines = next.split('\n');
    // 表头仍是第一行、对齐行第二行（GFM 合法）。
    expect(lines[0]).toContain('| a | bb |');
    expect(lines[1]).toContain('---');
    expect(tableModelAt(mdState(next), 0)!.columns).toBe(2);
  });

  it('表头行下方插入：空行落对齐行之后（不挤进表头与对齐行之间），仍合法 GFM', () => {
    const s = structOf(TWO_BY_TWO);
    const ch = insertRowChange(s, 0, false); // cellIndex 0 = 表头首格，下方插入。
    const next = applyChanges(TWO_BY_TWO, [ch]);
    const lines = next.split('\n');
    // 表头第一行、对齐行紧邻其后（第二行）——契约不破。
    expect(lines[0]).toContain('| a | bb |');
    expect(lines[1]).toContain('---');
    // 新空行是首个数据行（第三行），原数据行被推到第四行。
    expect(lines[3]).toContain('222');
    expect(lines.length).toBe(4);
    // lezer 仍识别为 Table（结构 + 列数完好），并新增一空数据行。
    const m = tableModelAt(mdState(next), 0)!;
    expect(m.columns).toBe(2);
    expect(m.cells.length).toBe(6); // 表头 2 + 两数据行各 2。
    expect(tableStructAt(mdState(next), 0)!.rows.length).toBe(2);
  });
});

describe('deleteRowChange 删除行（§5 边界）', () => {
  it('删数据行：少一行，列数不变，合法 GFM', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const s = structOf(doc);
    // cellIndex 4 = 第二数据行首格（行 2，cols=2 → row=2）。
    const ch = deleteRowChange(s, 4)!;
    const next = applyChanges(doc, [ch]);
    expect(next.split('\n').length).toBe(3); // 表头 + 对齐 + 1 数据行。
    expect(next).not.toContain('| 3 | 4 |');
    expect(tableModelAt(mdState(next), 0)!.columns).toBe(2);
  });

  it('禁删表头行（cellIndex 落表头 → null）', () => {
    const s = structOf(TWO_BY_TWO);
    expect(deleteRowChange(s, 0)).toBeNull();
    expect(deleteRowChange(s, 1)).toBeNull();
  });

  it('删唯一数据行：表格剩表头 + 对齐行（仍合法空表）', () => {
    const s = structOf(TWO_BY_TWO);
    const ch = deleteRowChange(s, 2)!;
    const next = applyChanges(TWO_BY_TWO, [ch]);
    const lines = next.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(2); // 表头 + 对齐行。
    expect(tableModelAt(mdState(next), 0)!.columns).toBe(2);
  });
});

describe('insertColumnChanges 插入列（§5）', () => {
  it('右侧插入：每行同步加 cell + delimiter 同步，列数 +1，合法 GFM', () => {
    const s = structOf(TWO_BY_TWO);
    const changes = insertColumnChanges(s, 0, false); // 第 0 列右侧。
    const next = applyChanges(TWO_BY_TWO, changes);
    const m = tableModelAt(mdState(next), 0)!;
    expect(m.columns).toBe(3); // 2 → 3。
    expect(m.cells.length).toBe(6); // 表头 3 + 数据行 3。
    // 对齐行也多一段（3 列 → 3 个 `---`）。
    expect((next.split('\n')[1].match(/---/g) ?? []).length).toBe(3);
  });

  it('左侧插入：列数 +1，新列在目标列之前', () => {
    const s = structOf(TWO_BY_TWO);
    const changes = insertColumnChanges(s, 1, true); // 第 1 列左侧（= 在 a/1 与 bb/222 之间）。
    const next = applyChanges(TWO_BY_TWO, changes);
    const m = tableModelAt(mdState(next), 0)!;
    expect(m.columns).toBe(3);
    // 表头列序：a, (空), bb。
    const headerCells = m.cells.slice(0, 3).map((c) => mdState(next).doc.sliceString(c.from, c.to).trim());
    expect(headerCells[0]).toBe('a');
    expect(headerCells[2]).toBe('bb');
  });
});

describe('deleteColumnChanges 删除列（§5 边界）', () => {
  it('删中间列：每行少一 cell + delimiter 同步，列数 -1，合法 GFM', () => {
    const s = structOf(THREE_COL);
    const changes = deleteColumnChanges(s, 1); // 删第 2 列（b/2）。
    const next = applyChanges(THREE_COL, changes);
    const m = tableModelAt(mdState(next), 0)!;
    expect(m.columns).toBe(2);
    expect(m.cells.length).toBe(4);
    expect(next).not.toMatch(/\bb\b/);
    expect((next.split('\n')[1].match(/---/g) ?? []).length).toBe(2);
  });

  it('删末列：列数 -1，行尾 `|` 闭合保留，合法 GFM', () => {
    const s = structOf(THREE_COL);
    const changes = deleteColumnChanges(s, 2); // 删第 3 列（c/3）。
    const next = applyChanges(THREE_COL, changes);
    const m = tableModelAt(mdState(next), 0)!;
    expect(m.columns).toBe(2);
    expect(next).not.toContain(' c ');
    // 每行仍以 `|` 闭合。
    for (const line of next.split('\n')) expect(line.trim().endsWith('|')).toBe(true);
  });

  it('删首列：列数 -1，合法 GFM', () => {
    const s = structOf(THREE_COL);
    const changes = deleteColumnChanges(s, 0);
    const next = applyChanges(THREE_COL, changes);
    expect(tableModelAt(mdState(next), 0)!.columns).toBe(2);
    expect(next).not.toMatch(/\ba\b/);
  });

  it('只剩一列时禁删（返回空数组）', () => {
    const s = structOf('| a |\n| --- |\n| 1 |');
    expect(deleteColumnChanges(s, 0)).toEqual([]);
  });
});

describe('setAlignChange 列对齐（§5，GFM 语法）', () => {
  it('单元映射：左/中/右 → :---/:---:/---:', () => {
    expect(alignToDelimiterCell('left').trim()).toBe(':---');
    expect(alignToDelimiterCell('center').trim()).toBe(':---:');
    expect(alignToDelimiterCell('right').trim()).toBe('---:');
    expect(alignToDelimiterCell('none').trim()).toBe('---');
  });

  it('设右对齐：对齐行该列变 `---:`，渲染 td 据此右对齐（真相源 GFM，无 HTML style）', () => {
    const s = structOf(TWO_BY_TWO);
    const ch = setAlignChange(s, 1, 'right')!; // 第 2 列右对齐。
    const next = applyChanges(TWO_BY_TWO, [ch]);
    const align = tableStructAt(mdState(next), 0)!.aligns;
    expect(align[1]).toBe('right');
    expect(align[0]).toBe('none'); // 第 1 列不变。
    // 真相源是 GFM 对齐行（含 `---:`），doc 不含 HTML style。
    expect(next.split('\n')[1]).toContain('---:');
    expect(next).not.toContain('style=');
  });

  it('设居中：对齐行该列变 `:---:`', () => {
    const s = structOf(TWO_BY_TWO);
    const ch = setAlignChange(s, 0, 'center')!;
    const next = applyChanges(TWO_BY_TWO, [ch]);
    expect(tableStructAt(mdState(next), 0)!.aligns[0]).toBe('center');
  });

  it('越界列返回 null', () => {
    const s = structOf(TWO_BY_TWO);
    expect(setAlignChange(s, 5, 'left')).toBeNull();
    expect(setAlignChange(s, -1, 'left')).toBeNull();
  });

  it('改对齐不动列数/行数（只改对齐行该段）', () => {
    const s = structOf(TWO_BY_TWO);
    const next = applyChanges(TWO_BY_TWO, [setAlignChange(s, 1, 'right')!]);
    const m = tableModelAt(mdState(next), 0)!;
    expect(m.columns).toBe(2);
    expect(m.cells.length).toBe(4);
  });
});

describe('columnOf 列号', () => {
  it('cellIndex → 列号（文档序扁平 % columns）', () => {
    const s = structOf(THREE_COL);
    expect(columnOf(s, 0)).toBe(0);
    expect(columnOf(s, 2)).toBe(2);
    expect(columnOf(s, 4)).toBe(1); // 第二行（数据行）第 2 列。
  });
});
