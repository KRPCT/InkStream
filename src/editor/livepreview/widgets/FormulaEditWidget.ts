import { type EditorView, WidgetType } from '@codemirror/view';
import {
  type FormulaEditInfo,
  destroyFormulaEditor,
  mountFormulaEditor,
  registerFormulaWrap,
} from '../formulaEditor';
import type { FormulaEngine } from '../formulaPreview';

/**
 * 公式块双栏编辑 widget（块编辑增强 W3，块级层 replace block:true）。整块（含围栏行）替换为头部 + 源码 textarea
 * 左 + 实时预览右（挂载/生命周期委托 formulaEditor）。
 *
 * eq **故意不含 source**——textarea 编辑改 source 但不应重建整 widget（否则撕 textarea、丢 caret/组合）；blockFrom+info
 * 同则视为同一双栏，走 updateDOM 原地保活。destroy 与挂载配对销毁面板（防泄漏）。
 */
export class FormulaEditWidget extends WidgetType implements FormulaEditInfo {
  constructor(
    readonly info: FormulaEngine,
    readonly source: string,
    readonly blockFrom: number,
  ) {
    super();
  }

  eq(other: FormulaEditWidget): boolean {
    return other.info === this.info && other.blockFrom === this.blockFrom;
  }

  // 放行 mousedown（让点击进 textarea / 点头部按钮命中）；其余事件交内部 DOM。
  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-ink-formula-edit';
    wrap.contentEditable = 'false';
    wrap.dataset.blockFrom = String(this.blockFrom);
    registerFormulaWrap(wrap, view);
    mountFormulaEditor(view, wrap, this);
    return wrap;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (dom.dataset.blockFrom !== String(this.blockFrom)) return false;
    mountFormulaEditor(view, dom, this); // 幂等：复用 textarea、刷新预览
    return true;
  }

  destroy(dom: HTMLElement): void {
    destroyFormulaEditor(dom);
  }
}
