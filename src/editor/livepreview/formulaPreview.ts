import type { EditorView } from '@codemirror/view';
import { ensureKatex, getKatex, katexReady } from './mathLoader';
import { ensureMathjax, getMathjaxConvert, mathjaxReady } from './mathjaxLoader';
import {
  ERROR_SENTINEL,
  ensureTypst,
  getCachedSvg,
  requestCompile,
  typstReady,
} from './typst/typstClient';

/**
 * 公式块双栏编辑的实时预览统一接口（块编辑增强 W3）。三引擎统一入口：math(KaTeX)/latex(MathJax) 同步出图；
 * typst 查 typstClient 缓存→命中出图 / 未命中触发异步编译（200ms 防抖在 typstClient，编完经 refreshLivePreview
 * 重建→复用分支→再调本函数→缓存命中出图）。未就绪一律占位 + 触发懒加载。XSS：KaTeX render / MathJax convert 产
 * 真 DOM 直接 append；typst SVG 走 DOMParser+importNode，绝不裸 innerHTML。
 */
export type FormulaEngine = 'math' | 'latex' | 'typst';

/** mount 内放纯文本占位（清旧 + 单 span，永不硬编色经 class）。 */
function setText(mount: HTMLElement, cls: string, text: string): void {
  mount.replaceChildren();
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = text;
  mount.appendChild(span);
}

export function renderPreview(
  view: EditorView,
  engine: FormulaEngine,
  mount: HTMLElement,
  source: string,
  blockFrom: number,
): void {
  if (source.trim() === '') {
    setText(mount, 'cm-ink-formula-ph', '空白公式');
    return;
  }

  if (engine === 'math') {
    if (!katexReady()) {
      setText(mount, 'cm-ink-formula-ph', '加载中…');
      ensureKatex(view);
      return;
    }
    mount.replaceChildren();
    try {
      getKatex()?.render(source, mount, {
        displayMode: true,
        throwOnError: false,
        output: 'htmlAndMathml',
        strict: 'ignore',
      });
    } catch {
      setText(mount, 'cm-ink-formula-err', '数学公式渲染失败');
    }
    return;
  }

  if (engine === 'latex') {
    if (!mathjaxReady()) {
      setText(mount, 'cm-ink-formula-ph', '加载中…');
      ensureMathjax(view);
      return;
    }
    const convert = getMathjaxConvert();
    mount.replaceChildren();
    try {
      if (convert) mount.appendChild(convert(source, true));
    } catch {
      setText(mount, 'cm-ink-formula-err', '数学公式渲染失败');
    }
    return;
  }

  // typst（异步）
  if (!typstReady()) {
    setText(mount, 'cm-ink-formula-ph', '加载中…');
    ensureTypst(view);
    return;
  }
  const svg = getCachedSvg(source);
  if (svg === null) {
    setText(mount, 'cm-ink-formula-ph', '编译中…');
    requestCompile(view, `preview-${blockFrom}`, source);
    return;
  }
  if (svg.startsWith(ERROR_SENTINEL)) {
    setText(mount, 'cm-ink-formula-err', 'typst 编译失败：' + (svg.slice(ERROR_SENTINEL.length) || '未知错误'));
    return;
  }
  mount.replaceChildren();
  const el = new DOMParser().parseFromString(svg, 'text/html').querySelector('svg');
  if (el) {
    const holder = document.createElement('div');
    holder.className = 'cm-ink-formula-typst-paper'; // typst 黑字白纸兜底
    holder.appendChild(document.importNode(el, true));
    mount.appendChild(holder);
  } else {
    setText(mount, 'cm-ink-formula-err', 'typst 预览解析失败');
  }
}
