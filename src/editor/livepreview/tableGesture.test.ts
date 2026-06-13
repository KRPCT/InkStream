import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { blockExtensions, blockField } from './blockField';
import { tableEditState } from './tableEditState';
import { handleTableMousedown } from './tableGesture';
import { TableWidget } from './widgets/TableWidget';

/**
 * 表格就地编辑手势回归门（Typora 式反转 / TABLE-WYSIWYG-DESIGN §2.3-2.4）。
 *
 * 断言（方案 B / 反转旧「点表格→整块还原」）：
 *   1. 点击单元格 td → setTableEdit 进就地编辑态（tableFrom + cellIndex）、表格仍渲染（不整块还原）、
 *      return true（接管 → preventDefault 主编辑器默认，焦点交子编辑器，CDP 实测 root cause）；
 *   2. 点击表格外 → 清就地编辑态（return false）；
 *   3. posAtCoords 未命中且无 cell DOM → return false 不抛错；
 *   4. 源纪律：setTableEdit/clearTableEdit dispatch + DOM 上溯 data-cell-index + setPendingClick。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

const TABLE_DOC = ['正文一', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', '正文二'].join('\n');
const TABLE_FROM = TABLE_DOC.indexOf('| a | b |');

/** 用 markdown(GFM) + blockExtensions（含 tableEditState）构建 view。 */
function tgView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), blockExtensions]);
}

/** 钉死 posAtCoords 返回值（jsdom 无布局）。 */
function pinPosAtCoords(v: EditorView, pos: number | null): void {
  Object.defineProperty(v, 'posAtCoords', { configurable: true, value: () => pos });
}

/** 当前 blockField 是否仍把表格替换为 TableWidget（恒应为 true：表格不再整块还原）。 */
function tableStillReplaced(v: EditorView): boolean {
  const iter = v.state.field(blockField).deco.iter();
  while (iter.value) {
    if ((iter.value.spec as { widget?: unknown }).widget instanceof TableWidget) return true;
    iter.next();
  }
  return false;
}

/** 构造一个 target 为 td（带 data 属性）的合成 mousedown 事件。 */
function cellMousedown(tableFrom: number, cellIndex: number): MouseEvent {
  const table = document.createElement('table');
  table.className = 'cm-ink-table';
  table.dataset.tableFrom = String(tableFrom);
  const td = document.createElement('td');
  td.dataset.cellIndex = String(cellIndex);
  table.appendChild(td);
  return { clientX: 0, clientY: 0, target: td, preventDefault: () => {} } as unknown as MouseEvent;
}

/** 构造一个 target 在表格外（非 td）的合成 mousedown。 */
function outsideMousedown(): { event: MouseEvent; prevented: () => boolean } {
  let prevented = false;
  const span = document.createElement('span');
  const event = {
    clientX: 0,
    clientY: 0,
    target: span,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as MouseEvent;
  return { event, prevented: () => prevented };
}

describe('handleTableMousedown 进就地编辑态（反转）', () => {
  it('点击单元格 td → setTableEdit + 表格仍渲染 + return true（接管 preventDefault，焦点交子编辑器）', () => {
    view = tgView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(tableStillReplaced(view)).toBe(true);

    const event = cellMousedown(TABLE_FROM, 2); // 第 3 个 cell（首个数据格）。
    const handled = handleTableMousedown(event, view);

    // 接管（preventDefault 主编辑器默认，防抢焦点，焦点交子编辑器）。
    expect(handled).toBe(true);
    // 就地编辑态落到该单元格。
    expect(view.state.field(tableEditState)).toEqual({ tableFrom: TABLE_FROM, cellIndex: 2 });
    // 表格仍渲染（不整块还原）。
    expect(tableStillReplaced(view)).toBe(true);
  });

  it('点表格外 → 清就地编辑态 + return false', () => {
    view = tgView(TABLE_DOC);
    // 先进编辑态。
    handleTableMousedown(cellMousedown(TABLE_FROM, 0), view);
    expect(view.state.field(tableEditState)).not.toBeNull();

    pinPosAtCoords(view, 0); // 落正文（表格外）。
    const { event, prevented } = outsideMousedown();
    const handled = handleTableMousedown(event, view);

    expect(handled).toBe(false);
    expect(prevented()).toBe(false);
    expect(view.state.field(tableEditState)).toBeNull();
    // 表格仍渲染。
    expect(tableStillReplaced(view)).toBe(true);
  });

  it('posAtCoords 未命中（null）且无 cell DOM → return false 不抛错', () => {
    view = tgView(TABLE_DOC);
    pinPosAtCoords(view, null);
    const { event } = outsideMousedown();
    expect(handleTableMousedown(event, view)).toBe(false);
  });

  it('posAtCoords 落表格块内（边界，无 cell DOM）→ 进编辑态首格 + 接管', () => {
    view = tgView(TABLE_DOC);
    pinPosAtCoords(view, TABLE_FROM);
    const { event } = outsideMousedown();
    expect(handleTableMousedown(event, view)).toBe(true);
    expect(view.state.field(tableEditState)).toEqual({ tableFrom: TABLE_FROM, cellIndex: 0 });
  });
});

describe('tableGesture 源纪律', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/editor/livepreview/tableGesture.ts'),
    'utf8',
  );

  it('DOM 上溯取 cell（closest td/th + data-cell-index），不依赖 posAtCoords cell 精度', () => {
    expect(src).toContain('closest');
    expect(src).toContain('cellIndex');
  });

  it('dispatch setTableEdit/clearTableEdit（不再整块还原源码）', () => {
    expect(src).toContain('setTableEdit');
    expect(src).toContain('clearTableEdit');
  });

  it('命中单元格接管并 preventDefault（防主编辑器抢焦点）+ setPendingClick 定位 caret', () => {
    // 进编辑态路径 return true → domEventHandlers 包装层 event.preventDefault（焦点交子编辑器）。
    expect(src).toContain('preventDefault');
    expect(src).toContain('setPendingClick');
    expect(src).toContain('domEventHandlers');
  });
});
