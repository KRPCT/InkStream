import { type EditorView, WidgetType } from '@codemirror/view';
import {
  type FormulaEditInfo,
  destroyFormulaEditor,
  mountFormulaEditor,
  registerFormulaWrap,
} from '../formulaEditor';
import type { FormulaEngine } from '../formulaPreview';
import { katexReady } from '../mathLoader';
import { mathjaxReady } from '../mathjaxLoader';
import { getCachedSvg, typstReady } from '../typst/typstClient';

/**
 * 公式块双栏编辑 widget（块编辑增强 W3，块级层 replace block:true）。整块（含围栏行）替换为头部 + 源码 textarea
 * 左 + 实时预览右（挂载/生命周期委托 formulaEditor）。
 *
 * eq 包含可见内容与异步渲染结果，变化时让 CM 调用 updateDOM；updateDOM 内复用同一 textarea，
 * 只更新预览，保留 caret/组合。eq 为 true 时 CM 不调用 updateDOM，不能只比较块位置。
 */
export class FormulaEditWidget extends WidgetType implements FormulaEditInfo {
  private readonly previewReady: boolean;
  private readonly compiledSvg: string | null;

  constructor(
    readonly info: FormulaEngine,
    readonly source: string,
    readonly blockFrom: number,
  ) {
    super();
    this.previewReady = info === 'typst' ? typstReady() : info === 'latex' ? mathjaxReady() : katexReady();
    this.compiledSvg = info === 'typst' ? getCachedSvg(source) : null;
  }

  eq(other: FormulaEditWidget): boolean {
    return other.info === this.info && other.blockFrom === this.blockFrom && other.source === this.source
      && other.previewReady === this.previewReady && other.compiledSvg === this.compiledSvg;
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
