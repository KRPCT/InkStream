import type { EditorView } from '@codemirror/view';
import { refreshLivePreview } from '../composition';

/**
 * MathJax v4（SVG 输出）懒加载器（Phase 5 W2 / 对标 W1 mathLoader.ts）：首屏零 MathJax——整套 ESM 模块 +
 * newcm 全字形数据仅当文档出现首个 ```latex 块才 dynamic import（MathJax 比 KaTeX 重得多）。
 *
 * 架构（守 CSP / 供应链零信任）：用「低层 ESM 直接装配」（mathjax.document + browserAdaptor + 显式 TeX/SVG），
 * **绝不**用 MathJax components/startup loader——后者运行时注入脚本（违 script-src 'self'）、注册全局 MathJax
 * 对象、默认扫整页 DOM 自动 typeset（会乱扫 CM 的 .cm-content）。低层路径下无 startup、无全局、无 eval、无页面
 * 扫描：只在 convert(latex) 时把指定串转成 SVG DOM 节点，挂进 widget 自己的 DOM（与 CM content 隔离）。
 *
 * 字体：SVG 输出把字形内嵌为 <path> 矢量（零 woff2、零 font-src 关切、零 FOUC），但 path 几何数据本身来自
 * @mathjax/mathjax-newcm-font（output/svg 不含默认字体，必须显式喂 fontData）。全部 dynamic 子文件经
 * mathjaxFonts.ts 预载 → convert 恒同步、运行时零动态 import。
 *
 * 与 W1 KaTeX 共存（BLOCK-04）：两引擎独立模块单例、互不引用；低层装配不创建 window.MathJax。
 */

/** convert 转换器：latex 源 → SVG DOM 节点（display 块级恒 true）。 */
type MathjaxConvert = (latex: string, display: boolean) => HTMLElement;

let convertFn: MathjaxConvert | null = null;
let loading: Promise<void> | null = null;

/** MathJax 是否已就绪（LatexWidget.toDOM 据此决定渲染公式还是占位）。 */
export function mathjaxReady(): boolean {
  return convertFn !== null;
}

/** 已构造的 convert 单例（mathjaxReady() 为 true 时非空）。 */
export function getMathjaxConvert(): MathjaxConvert | null {
  return convertFn;
}

/**
 * 触发 MathJax 懒加载 + 转换器装配（幂等）。首个 latex 块 widget.toDOM 未就绪时调用：dynamic import 全套
 * ESM 模块 + 全字形 → 装配 tex→svg 转换器单例 → 对该 view 派一次 refreshLivePreview，使占位 widget 重建为公式。
 * 绝不抢焦点（仅 dispatch effect，零 view.focus）；多块并发只装配一次。
 */
export function ensureMathjax(view: EditorView): void {
  if (convertFn) return;
  if (!loading) {
    loading = buildConverter().then((fn) => {
      convertFn = fn;
    });
  }
  void loading.then(() => {
    view.dispatch({ effects: refreshLivePreview.of(null) });
  });
}

/** 一次性装配 tex→svg 转换器（全部 dynamic import 在此，首屏 chunk 不含）。 */
async function buildConverter(): Promise<MathjaxConvert> {
  const [{ mathjax }, { TeX }, { SVG }, { browserAdaptor }, { RegisterHTMLHandler }, { MathJaxNewcmFont }] =
    await Promise.all([
      import('@mathjax/src/js/mathjax.js'),
      import('@mathjax/src/js/input/tex.js'),
      import('@mathjax/src/js/output/svg.js'),
      import('@mathjax/src/js/adaptors/browserAdaptor.js'),
      import('@mathjax/src/js/handlers/html.js'),
      import('@mathjax/mathjax-newcm-font/js/svg.js'),
    ]);
  // TeX 扩展（纯副作用 import，注册进 TeX 配置表）+ newcm 全字形预载（mathjaxFonts 副作用 dynamicSetup）。
  await Promise.all([
    import('@mathjax/src/js/input/tex/base/BaseConfiguration.js'),
    import('@mathjax/src/js/input/tex/ams/AmsConfiguration.js'),
    import('@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'),
    import('@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js'),
    import('./mathjaxFonts'),
  ]);

  const adaptor = browserAdaptor();
  RegisterHTMLHandler(adaptor);

  const tex = new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined'] });
  // fontCache:'local'：每个公式 SVG 自带 <defs> 路径缓存（自包含），规避多公式共用全局 <defs> 的 id 冲突。
  const svg = new SVG({ fontData: new MathJaxNewcmFont(), fontCache: 'local' });
  const mathDoc = mathjax.document('', { InputJax: tex, OutputJax: svg });

  return (latex: string, display: boolean): HTMLElement =>
    mathDoc.convert(latex, { display }) as HTMLElement;
}

/** 仅供测试：注入/重置 convert 单例，绕过 jsdom 下的真 import。 */
export function __setMathjaxConvertForTest(fn: MathjaxConvert | null): void {
  convertFn = fn;
  loading = null;
}
