import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../../test/composition';
import { extensionsForLanguage } from '../../languages';
import { blockField } from '../blockField';
import { setTableEdit, tableEditState } from '../tableEditState';
import { tableModelAt } from '../tableModel';
import { destroyActive, getActiveCellEditor } from '../tableCellEditor';
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
  if (view) destroyActive(view);
  destroyTestView(view);
  view = null;
});

const TWO_BY_TWO_DOC = ['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
const THREE_COL_DOC = ['| a | b | c |', '| --- | --- | --- |', '| 1 | 2 | 3 |'].join('\n');

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
  it('2 列表格：wrap 容器内含 table，正确 th/td 数 + 表头进 thead/数据进 tbody', () => {
    view = tableView(TWO_BY_TWO_DOC);
    // Wave 2：toDOM 返回 wrap 容器（承悬浮工具条），内含真 <table>。
    const wrap = widgetFor(view, null).toDOM(view);
    expect(wrap.tagName.toLowerCase()).toBe('div');
    expect(wrap.classList.contains('cm-ink-table-wrap')).toBe(true);
    expect(wrap.querySelector('table.cm-ink-table')).not.toBeNull();
    expect(wrap.querySelectorAll('th').length).toBe(2);
    expect(wrap.querySelectorAll('td').length).toBe(4);
    expect(wrap.querySelector('thead th')).not.toBeNull();
    expect(wrap.querySelectorAll('tbody tr').length).toBe(2);
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

describe('TableWidget 列对齐渲染（td text-align 跟随 GFM 对齐，Wave 2）', () => {
  it('aligns=[left,center,right] → 各列 td text-align 跟随（中/右设值，左/none 不设）', () => {
    view = tableView(THREE_COL_DOC);
    const model = tableModelAt(view.state, 0)!;
    const text = view.state.doc.sliceString(model.tableFrom, model.tableTo);
    const widget = new TableWidget(text, model.tableFrom, model.cells, null, model.columns, [
      'left',
      'center',
      'right',
    ]);
    const wrap = widget.toDOM(view);
    const headerCells = wrap.querySelectorAll<HTMLTableCellElement>('thead th');
    expect(headerCells[1].style.textAlign).toBe('center');
    expect(headerCells[2].style.textAlign).toBe('right');
    // 数据行同列同对齐。
    const bodyCells = wrap.querySelectorAll<HTMLTableCellElement>('tbody td');
    expect(bodyCells[2].style.textAlign).toBe('right');
  });

  it('aligns 默认空 → 无 td 设 text-align（继承默认左对齐）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    const wrap = widgetFor(view, null).toDOM(view);
    wrap.querySelectorAll<HTMLTableCellElement>('th, td').forEach((c) => {
      expect(c.style.textAlign).toBe('');
    });
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

describe('TableWidget 单元格武装（方案 B 嵌套子 EditorView）', () => {
  it('activeCellIndex 非空 → 对应 cell 标记 cm-ink-cell-editing 且内挂子 EditorView contentDOM', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const wrap = widgetFor(view, 2).toDOM(view); // 第 3 个 cell（首个数据格 "1"）。
    document.body.appendChild(wrap);
    const cells = wrap.querySelectorAll<HTMLTableCellElement>('th, td');
    expect(cells[2].classList.contains('cm-ink-cell-editing')).toBe(true);
    // 活动 cell 内挂了子编辑器（cm-editor + cm-content contenteditable）。
    expect(cells[2].querySelector('.cm-editor')).not.toBeNull();
    const sub = cells[2].querySelector<HTMLElement>('.cm-content');
    expect(sub).not.toBeNull();
    expect(sub!.getAttribute('contenteditable')).toBe('true');
    // 其余 cell 不含子编辑器（静态只读）。
    expect(cells[0].querySelector('.cm-editor')).toBeNull();
    expect(cells[3].querySelector('.cm-editor')).toBeNull();
    wrap.remove();
  });

  it('activeCellIndex 为 null → 无 cell 挂子编辑器（全静态只读）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    const wrap = widgetFor(view, null).toDOM(view);
    expect(wrap.querySelectorAll('.cm-content').length).toBe(0);
    expect(wrap.querySelectorAll('[contenteditable="true"]').length).toBe(0);
  });
});

describe('TableWidget updateDOM（原地复用 vs 重建，Wave 2 对齐回归）', () => {
  it('仅 activeCellIndex 变（列结构 + 对齐同）→ updateDOM 原地复用（保 caret/组合，Wave 1）', () => {
    view = tableView(THREE_COL_DOC);
    const model = tableModelAt(view.state, 0)!;
    const text = view.state.doc.sliceString(model.tableFrom, model.tableTo);
    const a = new TableWidget(text, 0, model.cells, null, model.columns, ['none', 'none', 'none']);
    const dom = a.toDOM(view);
    // 同结构同对齐、仅编辑态变：原地复用（返回 true）。
    const b = new TableWidget(text, 0, model.cells, 1, model.columns, ['none', 'none', 'none']);
    expect(b.updateDOM(dom, view)).toBe(true);
  });

  it('列对齐变（cell 数同）→ updateDOM 返回 false 强制重建（修 td text-align 陈旧 bug）', () => {
    view = tableView(THREE_COL_DOC);
    const model = tableModelAt(view.state, 0)!;
    const text = view.state.doc.sliceString(model.tableFrom, model.tableTo);
    const a = new TableWidget(text, 0, model.cells, null, model.columns, ['none', 'none', 'none']);
    const dom = a.toDOM(view);
    // 仅第 3 列改右对齐（cell 数不变）：必须重建，否则 td text-align 不更新（CDP 实测 root cause）。
    const b = new TableWidget(text, 0, model.cells, null, model.columns, ['none', 'none', 'right']);
    expect(b.updateDOM(dom, view)).toBe(false);
  });

  it('列数变（插删列）→ updateDOM 返回 false 强制重建', () => {
    view = tableView(THREE_COL_DOC);
    const model = tableModelAt(view.state, 0)!;
    const text = view.state.doc.sliceString(model.tableFrom, model.tableTo);
    const a = new TableWidget(text, 0, model.cells, null, model.columns, []);
    const dom = a.toDOM(view);
    // cell 数减少（删列）：签名变 → 重建。
    const b = new TableWidget(text, 0, model.cells.slice(0, model.cells.length - 1), null, 2, []);
    expect(b.updateDOM(dom, view)).toBe(false);
  });
});

describe('TableWidget ignoreEvent（方案 B：放行 mousedown 供手势，其余忽略归子编辑器）', () => {
  const widget = new TableWidget('| a |\n| - |\n| 1 |', 0, [], null, 1);

  it('放行 mousedown（false）→ tableGesture 能在 widget 内命中（误返 true 则手势不触发 root cause）', () => {
    expect(widget.ignoreEvent(new Event('mousedown'))).toBe(false);
  });

  it('input/keydown/composition* 忽略（true）→ 子 contentDOM 自有事件，主编辑器不解析', () => {
    for (const type of [
      'beforeinput',
      'input',
      'keydown',
      'compositionstart',
      'compositionupdate',
      'compositionend',
      'mouseup',
      'dblclick',
    ]) {
      expect(widget.ignoreEvent(new Event(type))).toBe(true);
    }
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

describe('TableWidget 活动格挂子编辑器（方案 B；子→主同步详测见 tableCellEditor.test.ts）', () => {
  it('武装活动格 → 该 td 内挂子编辑器，子 doc 取该 cell 当前源文本（去填充空格）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const wrap = widgetFor(view, 2).toDOM(view); // 首个数据格 "1"。
    document.body.appendChild(wrap);
    const cell = wrap.querySelectorAll<HTMLTableCellElement>('th, td')[2];
    // 子编辑器 contentDOM 文本 = 该 cell 源（"1"），静态 textContent 已让位。
    expect(cell.querySelector('.cm-content')?.textContent).toBe('1');
    wrap.remove();
  });
});

describe('TableWidget 非活动格回填静态文本（修「不渲染内容」根因）', () => {
  it('原地 updateDOM：曾活动被清空的格在变非活动后从新源回填 textContent（非空）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const model = tableModelAt(view.state, 0)!;
    const text = view.state.doc.sliceString(model.tableFrom, model.tableTo);
    // A：cell 2（首个数据格 "1"）活动 → 该格静态 textContent 被清空让位子编辑器。
    const a = new TableWidget(text, model.tableFrom, model.cells, 2, model.columns);
    const dom = a.toDOM(view);
    document.body.appendChild(dom);
    // B：编辑后 cell 2 源变 "1X"、退出活动态（active=null）：renderSig 同（cell 数/列/对齐不变）→ 原地
    // updateDOM 复用 DOM，须回填所有静态格（修前此格永久空白 = 「不渲染内容」）。
    const b = new TableWidget(
      text.replace('| 1 | 2 |', '| 1X | 2 |'),
      model.tableFrom,
      model.cells,
      null,
      model.columns,
    );
    expect(b.updateDOM(dom, view)).toBe(true);
    const cells = dom.querySelectorAll<HTMLTableCellElement>('th, td');
    expect(cells[2].textContent).toBe('1X'); // 回填非空（修前为 ''）。
    expect(cells[0].textContent).toBe('a');
    dom.remove();
  });

  it('切换活动格：旧活动格回填新源文本、新活动格让位子编辑器（多格编辑不留空）', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const model = tableModelAt(view.state, 0)!;
    const text = view.state.doc.sliceString(model.tableFrom, model.tableTo);
    const a = new TableWidget(text, model.tableFrom, model.cells, 2, model.columns);
    const dom = a.toDOM(view);
    document.body.appendChild(dom);
    // 切到 cell 3 活动：cell 2 须回填源（"1"，非空），cell 3 让位子编辑器。
    const b = new TableWidget(text, model.tableFrom, model.cells, 3, model.columns);
    expect(b.updateDOM(dom, view)).toBe(true);
    const cells = dom.querySelectorAll<HTMLTableCellElement>('th, td');
    expect(cells[2].textContent).toBe('1');
    expect(cells[2].querySelector('.cm-editor')).toBeNull();
    expect(cells[3].querySelector('.cm-editor')).not.toBeNull();
    dom.remove();
  });
});

describe('TableWidget 子编辑器跨 commit 复用（B1 修复：原地 updateDOM 不重建子编辑器、光标不跳末尾）', () => {
  it('原地 updateDOM（cell 文本变、renderSig 同）→ 活动格复用同一子编辑器实例、活动格无双显', () => {
    view = tableView(TWO_BY_TWO_DOC);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex: 2 }) });
    const model = tableModelAt(view.state, 0)!;
    const text = view.state.doc.sliceString(model.tableFrom, model.tableTo);
    const a = new TableWidget(text, model.tableFrom, model.cells, 2, model.columns);
    const dom = a.toDOM(view);
    document.body.appendChild(dom);
    const sub1 = getActiveCellEditor(view)!.sub;
    // 模拟一次 commit：cell 2 源 "1"→"1Y"，renderSig（cell 数/列/对齐）不变 → 原地 updateDOM。
    const b = new TableWidget(
      text.replace('| 1 | 2 |', '| 1Y | 2 |'),
      model.tableFrom,
      model.cells,
      2,
      model.columns,
    );
    expect(b.updateDOM(dom, view)).toBe(true);
    // 修前：armCells 先 textContent='' 断连 sub.dom → mountCell 走重建分支、子实例被替换；修后：复用同一实例。
    expect(getActiveCellEditor(view)!.sub).toBe(sub1);
    // 活动格只含一个子编辑器 contentDOM（源静态文本与子 contentDOM 不双显）。
    const cells = dom.querySelectorAll<HTMLTableCellElement>('th, td');
    expect(cells[2].querySelectorAll('.cm-content').length).toBe(1);
    dom.remove();
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

  it('不再含方案 A 残留（placeCaretAtEnd / textContent commit / 子→主 dispatch）', () => {
    expect(src).not.toContain('placeCaretAtEnd');
    // 子→主同步逻辑已迁出到 tableCellEditor.ts，本 widget 不再直接 commit。
    expect(src).not.toContain('input.table.cell');
    // 整表 wrap 标记不可编辑岛是方案 B 必需（非 A 的逐格 contentEditable 武装），只该出现在 wrap 上。
    expect(src).toContain("wrap.contentEditable = 'false'");
  });
});
