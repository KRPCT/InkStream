import { StateEffect, StateField } from '@codemirror/state';

/**
 * 表格就地编辑态 StateField（TABLE-WYSIWYG-DESIGN §2.2 / Wave 1）。
 *
 * 语义反转旧契约：旧实现「光标进表格 → 整块还原源码」；本字段持「正在就地编辑的表格 + 单元格」，
 * blockField 据此**仍对该表格发 block-replace 装饰（保持渲染）**，仅由 TableWidget 把对应 td/th
 * 标记为 contenteditable=true 并聚焦——编辑发生在 widget 内部，装饰不撤、表格不变源码。
 *
 *   - null：无表格处于就地编辑态（全部表格只读渲染）。
 *   - `{ tableFrom, cellIndex }`：该表格的第 cellIndex 个 TableCell（文档序扁平下标）处于编辑态。
 *
 * tableFrom 是 Table 节点起点（与 blockField.tables 的 from 同源），作表格身份键；docChanged 时
 * 经 mapPos 跟随位移（commit 自身的 dispatch 也会改 doc，须保编辑态指向同一表格不丢失）。
 *
 * 设计纪律：本字段不 provide 任何装饰（不破「block-replace 只从 blockField 的 StateField provide」）；
 * 它只是 TableWidget eq()/updateDOM 的输入信号，由 livePreview 组合根挂入、TableWidget 经 view 读取。
 */

/** 就地编辑态：表格身份键 tableFrom + 文档序单元格下标 cellIndex。 */
export interface TableEditState {
  readonly tableFrom: number;
  readonly cellIndex: number;
}

/** 设置/切换就地编辑态（点击单元格、Tab/Enter 跨格时派发）。 */
export const setTableEdit = StateEffect.define<TableEditState>();

/** 清空就地编辑态（Esc、点表格外、失焦退出时派发）。 */
export const clearTableEdit = StateEffect.define<null>();

/**
 * 就地编辑态字段：持 TableEditState | null。
 *
 * update 规则：
 *   - setTableEdit effect → 取其值（后到者覆盖，单一编辑焦点）。
 *   - clearTableEdit effect → null。
 *   - 无相关 effect 但 docChanged → mapPos 跟随表格位移（保编辑态不因自身 commit 的文档变化而漂移）。
 */
export const tableEditState = StateField.define<TableEditState | null>({
  create: () => null,
  update(prev, tr) {
    for (const e of tr.effects) {
      if (e.is(setTableEdit)) return e.value;
      if (e.is(clearTableEdit)) return null;
    }
    if (prev && tr.docChanged) {
      const tableFrom = tr.changes.mapPos(prev.tableFrom, 1);
      return { tableFrom, cellIndex: prev.cellIndex };
    }
    return prev;
  },
});
