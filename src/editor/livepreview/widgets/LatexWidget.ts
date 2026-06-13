import { type EditorView, WidgetType } from '@codemirror/view';
import { ensureMathjax, getMathjaxConvert, mathjaxReady } from '../mathjaxLoader';

/**
 * ```latex 块渲染 widget（Phase 5 W2 / BLOCK-03，对标 W1 MathWidget，块级层 Decoration.replace({block:true})）。
 *
 * 范式同 MathWidget：MathJax convert（browserAdaptor）产真 DOM 节点直接 appendChild（绝不 innerHTML，守 XSS）；
 * eq 按 latex + 构造时就绪态比较（懒加载完成后重建产 ready=true 新 widget → 重渲染占位换公式）；外层
 * contentEditable=false 不可编辑岛；不抢焦点。convert 同步（全字形已预载）→ 就绪后 toDOM 同步出公式。
 */
export class LatexWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly ready: boolean = mathjaxReady(),
  ) {
    super();
  }

  eq(other: LatexWidget): boolean {
    return other.latex === this.latex && other.ready === this.ready;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-ink-latex';
    wrap.contentEditable = 'false';
    const mount = document.createElement('div');
    mount.className = 'cm-ink-latex-render';
    wrap.appendChild(mount);

    const src = this.latex.trim();
    if (src === '') {
      wrap.classList.add('cm-ink-latex-empty');
      mount.textContent = '空白公式';
      return wrap;
    }

    if (!mathjaxReady()) {
      wrap.classList.add('cm-ink-latex-loading');
      mount.textContent = this.latex;
      ensureMathjax(view);
      return wrap;
    }

    renderLatex(this.latex, mount);
    return wrap;
  }
}

/** MathJax convert 渲染进 mount（同步；try/catch 兜底，永不撕装饰）。 */
function renderLatex(latex: string, mount: HTMLElement): void {
  const convert = getMathjaxConvert();
  if (!convert) return; // 理论不达（调用前 mathjaxReady() 已 true）
  try {
    mount.appendChild(convert(latex, true)); // display:true 块级；真 DOM 直接挂载，零 innerHTML
  } catch {
    mount.classList.add('cm-ink-latex-error');
    mount.textContent = '数学公式渲染失败';
  }
}
