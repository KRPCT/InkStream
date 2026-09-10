import { ViewPlugin, type ViewUpdate } from '@codemirror/view';

class EquationPdfLifecycle {
  private controller = new AbortController();
  get signal(): AbortSignal { return this.controller.signal; }
  update(update: ViewUpdate): void {
    if (!update.docChanged) return;
    this.controller.abort();
    this.controller = new AbortController();
  }
  destroy(): void { this.controller.abort(); }
}

/** 顶层轻量生命周期；docChanged、setState 与销毁立即取消旧正文的导出。 */
export const equationPdfLifecycle = ViewPlugin.fromClass(EquationPdfLifecycle);
