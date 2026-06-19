/**
 * PDF 导出（FEAT-EXPORT）：把完整 HTML 文档注入隐藏 iframe，等 load + 排版稳定后调 contentWindow.print()，
 * 用户在系统打印对话框选「另存为 PDF」。WebView2 支持 window.print() 交互式对话框、iframe 内容正常渲染。
 *
 * 不程序化聚焦编辑器（IME 纪律）：print() 直接作用于 iframe 自身的 window，不触碰主编辑器 contenteditable。
 * 必须等 'load' + 两帧（字体 / MathML 排版稳定）再 print，否则可能打印空白页；afterprint / 超时清理 iframe。
 */
export function printHtml(fullHtml: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden',
  });
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return;
    }
    const cleanup = (): void => iframe.remove();
    win.addEventListener('afterprint', cleanup, { once: true });
    // 等两帧让 webfont / MathML 排版稳定，避免打印空白页。
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          win.print();
        } finally {
          setTimeout(cleanup, 60_000); // 兜底：print 抛错 / 未收到 afterprint 也清理，绝不泄漏 iframe。
        }
      }),
    );
  };
  iframe.srcdoc = fullHtml;
  document.body.appendChild(iframe);
}
