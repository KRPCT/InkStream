import { type EditorView, WidgetType } from '@codemirror/view';
import {
  ERROR_SENTINEL,
  ensureTypst,
  getCachedSvg,
  requestCompile,
  typstReady,
} from '../typst/typstClient';

/**
 * ```typst 块渲染 widget（Phase 5 W3 / BLOCK-02，块级层 Decoration.replace({block:true})）。
 *
 * 与 W1/W2 的本质差异：typst 编译异步（跨 Worker），toDOM 拿不到 SVG。故 svg 在构造时查 client 缓存定格三态：
 * null=未编译（占位 + 触发编译）/ ERROR_SENTINEL=失败（错误占位）/ string=成功 SVG（DOMParser 安全注入）。
 * eq 含 source+svg+ready，使「占位→出图」「Worker 未就绪→就绪」都触发重建上屏（同 W1/W2 ready-eq 纪律，粒度细化到每段源）。
 *
 * SVG 来自我们自己的可信 typst 编译器，但仍走 DOMParser（image/svg+xml）解析 + importNode 而非裸 innerHTML（守 XSS）。
 * contentEditable=false 不可编辑岛；toDOM 永不 await、不抢焦点。
 */
export class TypstWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number, // blockKey（防抖键，块起点；同块编辑期稳定）
    readonly svg: string | null = getCachedSvg(source),
    readonly ready: boolean = typstReady(),
  ) {
    super();
  }

  eq(other: TypstWidget): boolean {
    return other.source === this.source && other.svg === this.svg && other.ready === this.ready;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-ink-typst';
    wrap.contentEditable = 'false';
    const mount = document.createElement('div');
    mount.className = 'cm-ink-typst-render';
    wrap.appendChild(mount);

    if (this.source.trim() === '') {
      wrap.classList.add('cm-ink-typst-empty');
      mount.textContent = '空白 typst 块';
      return wrap;
    }
    if (this.svg !== null && this.svg.startsWith(ERROR_SENTINEL)) {
      // 编译失败：哨兵前缀后携带 typst 真实错误信息（含行号/原因），显给用户。
      wrap.classList.add('cm-ink-typst-error');
      mount.textContent = 'typst 编译失败：' + (this.svg.slice(ERROR_SENTINEL.length) || '未知错误');
      return wrap;
    }
    if (this.svg !== null) {
      injectSvg(this.svg, mount, wrap);
      return wrap;
    }
    // 未编译：Worker 未就绪 → 加载中占位 + 懒建 Worker；就绪 → 编译中占位 + 防抖请求编译。
    wrap.classList.add('cm-ink-typst-loading');
    mount.textContent = this.source;
    if (!typstReady()) ensureTypst(view);
    else requestCompile(view, String(this.from), this.source);
    return wrap;
  }
}

/**
 * SVG 字符串安全注入 mount（DOMParser + importNode，绝不裸 innerHTML，守 XSS 纪律——DOMParser 解析的文档惰性、
 * 不执行脚本）。用 **text/html** 而非 image/svg+xml：typst 的 SVG 对严格 XML 解析不友好（实测严格 XML 失败回退
 * html 文档），text/html 宽松、经外来内容正确处理 SVG，querySelector('svg') 取根节点稳。
 */
function injectSvg(svg: string, mount: HTMLElement, wrap: HTMLElement): void {
  const el = new DOMParser().parseFromString(svg, 'text/html').querySelector('svg');
  if (el) {
    mount.appendChild(document.importNode(el, true));
  } else {
    wrap.classList.add('cm-ink-typst-error');
    mount.textContent = 'typst 预览解析失败';
  }
}
