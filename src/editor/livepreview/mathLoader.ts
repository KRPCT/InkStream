import type { EditorView } from '@codemirror/view';
import { refreshLivePreview } from '../composition';

/**
 * KaTeX 懒加载器（Phase 5 W1 / BLOCK-04）：首屏零 KaTeX——JS / CSS / 字体全部按需。
 *
 * 范式镜像 languages.ts:loadTypst（dynamic import 单例），但 KaTeX 无 wasm / 无 reconfigure，故更简单：
 * 模块级单例 Promise + 加载完成后对发起 view 派一次 refreshLivePreview，使已渲染的「加载中占位」widget
 * 经 blockField 重建换成真公式。
 *
 * 字体方案（核心）：CSS 走动态 `import('katex/dist/katex.min.css')`，由 Vite 把 CSS 及其 url(fonts/*.woff2)
 * 收进独立 chunk、字体重写为**同源** hash 路径——满足 tauri.conf CSP `font-src 'self'`（绝不走 asset: 协议），
 * 首屏不含、首个 math 块出现时才拉。动态 import 而非静态，才能懒加载（静态会打进首屏 chunk）。
 */

type Katex = (typeof import('katex'))['default'];

let katex: Katex | null = null;
let loading: Promise<void> | null = null;

/** KaTeX 是否已就绪（MathWidget.toDOM 据此决定渲染公式还是占位）。 */
export function katexReady(): boolean {
  return katex !== null;
}

/** 已加载的 katex 实例（katexReady() 为 true 时非空）。 */
export function getKatex(): Katex | null {
  return katex;
}

/**
 * 触发 KaTeX 懒加载（幂等）。首个 math 块的 widget.toDOM 在未就绪时调用：并行 import JS + CSS，
 * 就绪后缓存实例，并对该 view 派一次 refreshLivePreview 让占位 widget 重建为真公式。
 *
 * 绝不抢焦点（仅 dispatch effect，零 view.focus，承 WebView2 IME 硬约束）；多块并发只 import 一次。
 */
export function ensureKatex(view: EditorView): void {
  if (katex) return;
  if (!loading) {
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([mod]) => {
      katex = mod.default;
    });
  }
  void loading.then(() => {
    view.dispatch({ effects: refreshLivePreview.of(null) });
  });
}

/** 仅供测试：注入/重置 katex 实例，绕过 jsdom 下的真 import + CSS 拉取。 */
export function __setKatexForTest(k: Katex | null): void {
  katex = k;
  loading = null;
}
