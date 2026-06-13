import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import {
  destroyTestView,
  dispatchComposition,
  makeTestView,
  mockComposing,
} from '../../../test/composition';
import { __resetCompositionForTest } from '../../composition';
import { extensionsForLanguage } from '../../languages';
import { blockField } from '../blockField';
import { setTableEdit, tableEditState } from '../tableEditState';
import { tableModelAt } from '../tableModel';
import { TableWidget } from './TableWidget';

/**
 * GFM 表格 widget 回归门（Typora 式就地编辑 Wave 1 / Security V5 XSS 防护 / 真相源映射）。
 *
 * 断言：
 *   1. 结构 + XSS：含 <img onerror> 单元格作纯文本、无 img 元素（无 innerHTML）；
 *   2. cell 区间/索引：td/th 带 data-cell-index/data-cell-from/data-cell-to（语法树固化区间）；
 *   3. 武装：activeCellIndex 非空时对应 cell contenteditable=true + cm-ink-cell-editing；
 *   4. ignoreEvent 放行 input/keydown/composition/mousedown（就地编辑事件不被吞）；
 *   5. eq：sourceText + activeCellIndex 入判据；
 *   6. 源纪律：createElement 构建、无 innerHTML、无硬编码色。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

const TWO_BY_TWO_DOC = ['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

/** 用真实 view（markdown + blockField + tableEditState）构建一个 widget 对应 doc 的表格。 */
function tableView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), tableEditState, blockField]);
}

/** 取 doc 中首个表格的 TableWidget（带语法树 cellRanges），可选 activeCellIndex。 */
function widgetFor(v: EditorView, active: number | null): TableWidget {
  const model = tableModelAt(v.state, v.state.doc.toString().indexOf('|'))!;
  const text = v.state.doc.sliceString(model.tableFrom, model.tableTo);
  return new TableWidget(text, model.tableFrom, model.cells, active, model.columns);
}

describe('TableWidget 结构 + XSS 防护（T-03-12）', () => {
  it('2 列表格构建出正确 th/td 数 + 表头进 thead/数据进 tbody', () => {
    view = tableView(TWO_BY_TWO_DOC);
    const table = widgetFor(view, null).toDOM(view);
    expect(table.tagName.toLowerCase()).toBe('table');
    expect(table.querySelectorAll('th').length).toBe(2);
    expect(table.querySelectorAll('td').length).toBe(4);
    expect(table.querySelector('thead th')).not.toBeNull();
    expect(table.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('单元格含 <img onerror> 时不生成 img、内容作纯文本', () => {
    const doc = ['| h |', '| - |', '| <img src=x onerror=alert(1)> |'].join('\n');
    view = tableView(doc);
    const table = widgetFor(view, null).toDOM(view);
    expect(table.querySelector('img')).toBeNull();
    const cell = table.querySelector('tbody td')!;
    expect(cell.textContent).toContain('<img');
    expect(cell.textContent).toContain('onerror');
  });
});

describe('TableWidget cell 区间/索引 data 属性（真相源映射）', () => {
  it('每个 td/th 带 data-cell-index 与语法树 data-cell-from/data-cell-to', () => {
    view = tableView(TWO_BY_TWO_DOC);
    const model = tableModelAt(view.state, 0)!;
    const table = widgetFor(view, null).toDOM(view);
    const cells = table.querySelectorAll<HTMLTableCellElement>('th, td');
    expect(cells.length).toBe(model.cells.length);
    cells.forEach((cell, i) => {
      expect(cell.dataset.cellIndex).toBe(String(i));
      expect(cell.dataset.cellFrom).toBe(String(model.cells[i].from));
      expect(cell.dataset.cellTo).toBe(String(model.cells[i].to));
    });
  });
});

describe('TableWidget 单元格武装（contenteditable）', () => {
  it('activeCellIndex 非空 → 对应 cell contenteditable=true + cm-ink-cell-editing', () => {
    view = tableView(TWO_BY_TWO_DOC);
    const table = widgetFor(view, 2).toDOM(view); // 第 3 个 cell（首个数据格 "1"）。
    const cells = table.querySelectorAll<HTMLTableCellElement>('th, td');
    expect(cells[2].contentEditable).toBe('true');
    expect(cells[2].classList.contains('cm-ink-cell-editing')).toBe(true);
    // 其余 cell 不可编辑。
    expect(cells[0].contentEditable).not.toBe('true');
    expect(cells[3].contentEditable).not.toBe('true');
  });

  it('activeCellIndex 为 null → 无 cell 可编辑', () => {
    view = tableView(TWO_BY_TWO_DOC);
    const table = widgetFor(view, null).toDOM(view);
    const editable = table.querySelectorAll('[contenteditable="true"]');
    expect(editable.length).toBe(0);
  });
});

describe('TableWidget ignoreEvent（就地编辑事件放行）', () => {
  const widget = new TableWidget('| a |\n| - |\n| 1 |', 0, [], null, 1);

  it('放行 mousedown/beforeinput/input/keydown/composition*', () => {
    for (const type of [
      'mousedown',
      'beforeinput',
      'input',
      'keydown',
      'compositionstart',
      'compositionupdate',
      'compositionend',
    ]) {
      expect(widget.ignoreEvent(new Event(type))).toBe(false);
    }
  });

  it('无关事件仍吞掉（避免误触）', () => {
    expect(widget.ignoreEvent(new Event('mouseup'))).toBe(true);
    expect(widget.ignoreEvent(new Event('dblclick'))).toBe(true);
  });
});

describe('TableWidget eq（sourceText + activeCellIndex）', () => {
  it('同 sourceText + 同 activeCellIndex → true', () => {
    const a = new TableWidget(TWO_BY_TWO_DOC, 0, [], 1, 2);
    const b = new TableWidget(TWO_BY_TWO_DOC, 0, [], 1, 2);
    expect(a.eq(b)).toBe(true);
  });

  it('activeCellIndex 不同 → false（驱动编辑态切换 updateDOM）', () => {
    const a = new TableWidget(TWO_BY_TWO_DOC, 0, [], 1, 2);
    const c = new TableWidget(TWO_BY_TWO_DOC, 0, [], 2, 2);
    expect(a.eq(c)).toBe(false);
  });

  it('sourceText 不同 → false', () => {
    const a = new TableWidget(TWO_BY_TWO_DOC, 0, [], null, 2);
    const d = new TableWidget('| x |\n| - |\n| 9 |', 0, [], null, 1);
    expect(a.eq(d)).toBe(false);
  });
});

describe('TableWidget commit 同步回 doc（真相源映射 / CDP 自验 b+c）', () => {
  /** 渲染活动 cell 的 widget DOM（绑好 input/composition 处理）并挂进 jsdom，返回该 td。 */
  function mountEditingCell(v: EditorView, cellIndex: number): HTMLTableCellElement {
    const model = tableModelAt(v.state, 0)!;
    const text = v.state.doc.sliceString(model.tableFrom, model.tableTo);
    const widget = new TableWidget(text, model.tableFrom, model.cells, cellIndex, model.columns);
    const table = widget.toDOM(v);
    document.body.appendChild(table);
    const cell = table.querySelectorAll<HTMLTableCellElement>('th, td')[cellIndex];
    return cell;
  }

  it('非组合输入 → 单点 dispatch 替换 cell 区间，doc 仍合法 GFM（英文）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const cell = mountEditingCell(view, 2); // 首个数据格 "1"。

    cell.textContent = 'hello';
    cell.dispatchEvent(new Event('input', { bubbles: true }));

    // doc 对应 cell 源更新为 "hello"，且整表仍是合法 GFM（cell 数/列数不变）。
    expect(view.state.doc.toString()).toContain('hello');
    const model = tableModelAt(view.state, 0)!;
    expect(model.columns).toBe(2);
    expect(model.cells.length).toBe(6); // 表头 2 + 两数据行各 2。
    cell.remove();
  });

  it('含 | 的输入被转义为 \\|（不破坏列结构）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const cell = mountEditingCell(view, 2);

    cell.textContent = 'a|b';
    cell.dispatchEvent(new Event('input', { bubbles: true }));

    expect(view.state.doc.toString()).toContain('a\\|b');
    // 列数不变（| 已转义，未新增列）。
    expect(tableModelAt(view.state, 0)!.columns).toBe(2);
    cell.remove();
  });

  it('组合期 input 不 commit；compositionend 后落 doc（中文）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const cell = mountEditingCell(view, 2);
    const before = view.state.doc.toString();

    // 组合期：合成中途的 input 绝不 commit（mockComposing 模拟合成态）。
    mockComposing(view, true);
    dispatchComposition(view, { phase: 'compositionstart', data: '中' });
    cell.textContent = '中文';
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.state.doc.toString()).toBe(before); // 组合期 doc 未变。

    // compositionend：解除合成态，组合结束回调 commit 中文回 doc。
    mockComposing(view, false);
    dispatchComposition(view, { phase: 'compositionend', data: '中文' });
    cell.dispatchEvent(new Event('compositionend', { bubbles: true }));
    // compositionend 的 queueAfterComposition 回调此刻非组合期立即执行。
    expect(view.state.doc.toString()).toContain('中文');
    __resetCompositionForTest(view);
    cell.remove();
  });

  it('内容与 doc 现值相等时跳过 dispatch（无空事务）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const cell = mountEditingCell(view, 2);
    const docBefore = view.state.doc.toString();

    // textContent 仍为 "1"（与源同），input 不应产生 doc 变更。
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.state.doc.toString()).toBe(docBefore);
    cell.remove();
  });
});

describe('TableWidget 源纪律', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/editor/livepreview/widgets/TableWidget.ts'),
    'utf8',
  );

  it('用 createElement 构建且不含 innerHTML（XSS 防护）', () => {
    expect(src).toContain('createElement');
    expect(src).not.toContain('innerHTML');
  });

  it('无硬编码色值（var(--cm-table-*) 纪律）', () => {
    expect(src).not.toMatch(/color:\s*['"]#/);
    expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
  });

  it('commit 经统一冻结门排队（queueAfterComposition）+ userEvent 标注', () => {
    expect(src).toContain('queueAfterComposition');
    expect(src).toContain('input.table.cell');
  });
});
