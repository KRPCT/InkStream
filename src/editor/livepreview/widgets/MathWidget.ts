import { type EditorView, WidgetType } from '@codemirror/view';
import { ensureKatex, getKatex, katexReady } from '../mathLoader';

/**
 * ```math 块渲染 widget（Phase 5 W1 / BLOCK-01，块级层 Decoration.replace({block:true})）。
 *
 * 范式同 TableWidget：DOM 全 createElement（KaTeX 经 render() 直接挂 DOM，绝不走 innerHTML，守 XSS 纪律）；
 * eq 按 latex 源比较（同源复用旧 DOM、不重建、不闪烁）；外层 contentEditable=false 声明「不可编辑岛」
 * （主编辑器 DOMObserver 不下钻解析 KaTeX 内部 DOM 变化）。
 *
 * 懒加载（首屏零 KaTeX）：toDOM 时未就绪 → 渲染源码占位 + ensureKatex(view) 触发按需加载，完成后 mathLoader
 * 经 refreshLivePreview 触发 blockField 重建，本 widget 重渲染为公式。toDOM 内**绝不 await**。
 *
 * 不抢焦点：toDOM 仅渲染 + 触发懒加载，零 view.focus（WebView2 IME 平台限制硬约束）。
 */
export class MathWidget extends WidgetType {
  /**
   * @param latex 公式源（取自 CodeText 子节点）
   * @param ready 构造时 KaTeX 是否就绪——并入 eq：懒加载完成后 refreshLivePreview 重建产出 ready=true 的新
   *   widget，与旧 ready=false 不等 → CM 重建 → toDOM 渲染公式（否则同 latex 的 eq 会复用旧「加载中占位」DOM，
   *   公式永远出不来）。
   */
  constructor(
    readonly latex: string,
    readonly ready: boolean = katexReady(),
  ) {
    super();
  }

  /** 同 latex 且同就绪态视为同一 widget：CM6 复用旧 DOM 不重建（防公式闪烁）；就绪态变化必重建。 */
  eq(other: MathWidget): boolean {
    return other.latex === this.latex && other.ready === this.ready;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-ink-math';
    // 不可编辑岛（同 TableWidget 纪律）：主编辑器不解析 KaTeX 内部 DOM。
    wrap.contentEditable = 'false';
    const mount = document.createElement('div');
    mount.className = 'cm-ink-math-render';
    wrap.appendChild(mount);

    const src = this.latex.trim();
    if (src === '') {
      // 空块：不调 KaTeX（空串渲染坍成 0 高），给占位 + min-height（mathTheme）。
      wrap.classList.add('cm-ink-math-empty');
      mount.textContent = '空白公式';
      return wrap;
    }

    if (!katexReady()) {
      // KaTeX 未就绪：先显源码占位（信息不丢、FOUC 最小），触发懒加载。
      wrap.classList.add('cm-ink-math-loading');
      mount.textContent = this.latex;
      ensureKatex(view);
      return wrap;
    }

    renderMath(this.latex, mount);
    return wrap;
  }
}

/** 把 latex 源渲染进 mount（KaTeX 同步 render；throwOnError:false + try/catch 双保险，永不撕装饰）。 */
function renderMath(latex: string, mount: HTMLElement): void {
  const katex = getKatex();
  if (!katex) return; // 理论不达（调用前 katexReady() 已 true）
  try {
    katex.render(latex, mount, {
      displayMode: true,
      throwOnError: false, // 保底：非法 latex 渲红字而非抛出撕装饰
      output: 'htmlAndMathml', // 屏读走 MathML（可访问性）
      strict: 'ignore', // 宽松渲染（Obsidian 取向），不因 \( 等告警打断
    });
  } catch (err) {
    mount.classList.add('cm-ink-math-error');
    mount.textContent = err instanceof katex.ParseError ? err.message : '数学公式渲染失败';
  }
}
