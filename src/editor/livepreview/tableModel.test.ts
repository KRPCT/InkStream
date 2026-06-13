import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { extensionsForLanguage } from '../languages';
import {
  appendRowChange,
  escapePipes,
  navigateCell,
  tableModelAt,
  unescapePipes,
} from './tableModel';

/**
 * 表格就地编辑纯模型层回归门（TABLE-WYSIWYG-DESIGN §3/§4 / Wave 1）。
 *
 * 全部纯函数穷举：
 *   1. tableModelAt——语法树给精确 TableCell 区间 + 列数（§3.1 实测固化），对齐分隔行不产 cell；
 *   2. escapePipes/unescapePipes——`|`↔`\|`、`\n`↔`<br>` 双向转义，往返不失真；
 *   3. navigateCell——Tab/Shift+Tab/Enter（next/prev/down/up）的目标/越界/末格追加索引；
 *   4. appendRowChange——末行追加空行的 changes + 新行首列 cellIndex。
 */

const TWO_BY_TWO = '| a | bb |\n| :- | -: |\n| 1 | 222 |';

/** 用 markdown(GFM) 构建只读 state（取语法树用，无 view）。 */
function mdState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [extensionsForLanguage('markdown')] });
}

describe('tableModelAt delimiter 切分 cell 区间', () => {
  it('2x2 表给出 4 个 cell 区间（含填充空格）+ 列数 2（对齐行不产 cell）', () => {
    const state = mdState(TWO_BY_TWO);
    const model = tableModelAt(state, 3); // pos 落在表头 cell "a" 内。
    expect(model).not.toBeNull();
    expect(model!.columns).toBe(2);
    // 4 个 cell：表头 a/bb + 数据 1/222；区间为相邻 | 之间（含两侧填充空格），trim 后即内容。
    expect(model!.cells.map((c) => state.doc.sliceString(c.from, c.to).trim())).toEqual([
      'a',
      'bb',
      '1',
      '222',
    ]);
  });

  it('表格起点 pos=0 也能解析进表内（side=1）', () => {
    const state = mdState(TWO_BY_TWO);
    expect(tableModelAt(state, 0)).not.toBeNull();
  });

  it('含空单元格的行仍按列产出 cell 区间（lezer 不产空 TableCell 的修正）', () => {
    const doc = '| a | b |\n| - | - |\n|   |   |';
    const state = mdState(doc);
    const model = tableModelAt(state, 3)!;
    // 空行也给 2 个 cell 区间（按 delimiter 切分），总 4 cell。
    expect(model.cells.length).toBe(4);
    expect(model.columns).toBe(2);
    expect(state.doc.sliceString(model.cells[2].from, model.cells[2].to).trim()).toBe('');
  });

  it('tableFrom/tableTo 与 Table 节点对齐', () => {
    const state = mdState(TWO_BY_TWO);
    const model = tableModelAt(state, 3)!;
    expect(model.tableFrom).toBe(0);
    expect(model.tableTo).toBe(TWO_BY_TWO.length);
  });

  it('pos 不在任何表格内返回 null', () => {
    const state = mdState('普通段落，无表格。');
    expect(tableModelAt(state, 2)).toBeNull();
  });

  it('3 列表给出列数 3', () => {
    const doc = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |';
    const state = mdState(doc);
    const model = tableModelAt(state, 3)!;
    expect(model.columns).toBe(3);
    expect(model.cells.length).toBe(6);
  });
});

describe('escapePipes / unescapePipes 双向转义（§3.2）', () => {
  it('字面 | 转 \\|', () => {
    expect(escapePipes('a|b')).toBe('a\\|b');
  });

  it('已转义 \\| 不二次转义', () => {
    expect(escapePipes('a\\|b')).toBe('a\\|b');
  });

  it('换行转 <br>', () => {
    expect(escapePipes('line1\nline2')).toBe('line1<br>line2');
  });

  it('首尾空白裁掉（cell 填充空格无语义）', () => {
    expect(escapePipes('  hi  ')).toBe('hi');
  });

  it('unescape：\\| 还原 |、<br> 还原换行', () => {
    expect(unescapePipes('a\\|b')).toBe('a|b');
    expect(unescapePipes('x<br>y')).toBe('x\ny');
    expect(unescapePipes('x<br/>y')).toBe('x\ny');
    expect(unescapePipes('x<br />y')).toBe('x\ny');
  });

  it('往返：escape(unescape(s)) 对含 | 的源稳定', () => {
    const source = 'a\\|b';
    expect(escapePipes(unescapePipes(source))).toBe(source);
  });

  it('纯文本无管道/换行原样', () => {
    expect(escapePipes('hello world')).toBe('hello world');
    expect(unescapePipes('hello world')).toBe('hello world');
  });
});

describe('navigateCell 导航索引（§4 穷举）', () => {
  // 2 列 4 cell：[0 1 / 2 3]。
  const COLS = 2;
  const TOTAL = 4;

  it('next：非末格右移一格', () => {
    expect(navigateCell(0, COLS, TOTAL, 'next')).toEqual({ kind: 'cell', cellIndex: 1 });
    expect(navigateCell(2, COLS, TOTAL, 'next')).toEqual({ kind: 'cell', cellIndex: 3 });
  });

  it('next：末格 → 追加行（落新行首列）', () => {
    expect(navigateCell(3, COLS, TOTAL, 'next')).toEqual({ kind: 'appendRow', column: 0 });
  });

  it('prev：非首格左移一格', () => {
    expect(navigateCell(3, COLS, TOTAL, 'prev')).toEqual({ kind: 'cell', cellIndex: 2 });
  });

  it('prev：首格 → 退出表格前', () => {
    expect(navigateCell(0, COLS, TOTAL, 'prev')).toEqual({ kind: 'exit', before: true });
  });

  it('down：非末行下移同列', () => {
    expect(navigateCell(0, COLS, TOTAL, 'down')).toEqual({ kind: 'cell', cellIndex: 2 });
    expect(navigateCell(1, COLS, TOTAL, 'down')).toEqual({ kind: 'cell', cellIndex: 3 });
  });

  it('down：末行 → 追加行（保持列）', () => {
    expect(navigateCell(2, COLS, TOTAL, 'down')).toEqual({ kind: 'appendRow', column: 0 });
    expect(navigateCell(3, COLS, TOTAL, 'down')).toEqual({ kind: 'appendRow', column: 1 });
  });

  it('up：非首行上移同列', () => {
    expect(navigateCell(2, COLS, TOTAL, 'up')).toEqual({ kind: 'cell', cellIndex: 0 });
  });

  it('up：表头行 → 退出表格前', () => {
    expect(navigateCell(0, COLS, TOTAL, 'up')).toEqual({ kind: 'exit', before: true });
    expect(navigateCell(1, COLS, TOTAL, 'up')).toEqual({ kind: 'exit', before: true });
  });
});

describe('appendRowChange 末行追加空行（§4/§5 最小版）', () => {
  it('插入点在表末、列数对齐、新行首列 cellIndex = 原 cell 数', () => {
    const state = mdState(TWO_BY_TWO);
    const model = tableModelAt(state, 3)!;
    const change = appendRowChange(model);
    expect(change.at).toBe(model.tableTo);
    expect(change.firstCellIndexAfter).toBe(4); // 原 4 cell，新行首列接其后。
    // 换行起头 + 2 列空格占位 + 闭合 |。
    expect(change.insert.startsWith('\n|')).toBe(true);
    expect(change.insert.endsWith('|')).toBe(true);
    expect((change.insert.match(/\|/g) ?? []).length).toBe(3); // 2 列 → 3 个 |。
  });

  it('插入后语法树解析出新数据行（合法 GFM）', () => {
    const state = mdState(TWO_BY_TWO);
    const model = tableModelAt(state, 3)!;
    const change = appendRowChange(model);
    const next = state.update({ changes: { from: change.at, insert: change.insert } }).state;
    const afterModel = tableModelAt(next, 3)!;
    // 追加一行后 cell 数 = 6（表头 2 + 两数据行各 2）。
    expect(afterModel.cells.length).toBe(6);
    expect(afterModel.columns).toBe(2);
  });
});
