import { type EditorView, WidgetType } from '@codemirror/view';
import { ensureKatex, getKatex, katexReady } from '../mathLoader';

/**
 * 行内 `$...$` KaTeX widget（FEAT-INLINE-MATH，行内层 Decoration.replace({block:false})）。
 *
 * 与块 MathWidget 同纪律（DOM 全 createElement、katex.render 不走 innerHTML 守 XSS、contentEditable=false
 * 不可编辑岛、不抢焦点、懒加载占位、eq 含 ready 防占位永不换）；差异：行内 span + displayMode:false（基线对齐随文流）。
 */
export class InlineMathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly ready: boolean = katexReady(),
  ) {
    super();
  }

  eq(other: InlineMathWidget): boolean {
    return other.latex === this.latex && other.ready === this.ready;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ink-inline-math';
    span.contentEditable = 'false';

    if (this.latex.trim() === '') {
      span.classList.add('cm-ink-inline-math-empty');
      span.textContent = '$ $';
      return span;
    }
    if (!katexReady()) {
      span.classList.add('cm-ink-inline-math-loading');
      span.textContent = '$' + this.latex + '$'; // 占位显源码
      ensureKatex(view);
      return span;
    }
    renderInlineMath(this.latex, span);
    return span;
  }
}

/** KaTeX 同步 render（displayMode:false 行内；throwOnError:false + try/catch 双保险，永不撕装饰）。 */
function renderInlineMath(latex: string, mount: HTMLElement): void {
  const katex = getKatex();
  if (!katex) return;
  try {
    katex.render(latex, mount, {
      displayMode: false, // 行内：随文流、基线对齐
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: 'ignore',
    });
  } catch (err) {
    mount.classList.add('cm-ink-inline-math-error');
    mount.textContent = err instanceof katex.ParseError ? err.message : '公式错误';
  }
}
