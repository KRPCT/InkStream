import type { ExportMeta } from '../../types/export';

/**
 * 导出 HTML 文档外壳（FEAT-EXPORT）：把 markdownToHtml 的正文 HTML 包成自包含的 `<!doctype html>` 文档，
 * 供 HTML 导出落盘与 PDF 打印共用。品牌页脚（默认开，受 exportBrandingFooter 控制）+ 生成器元数据（始终写）。
 *
 * 样式说明：导出产物是脱离应用的独立文件，外部浏览器 / 打印里没有 InkStream 的 theme.css，var(--...) 无从解析，
 * 故此处内联一套面向阅读/打印的字面配色（这是独立文档样式，非应用内 UI；不适用「禁硬编码颜色」约束）。
 */

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #ffffff; color: #1f2328;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.7; }
.ink-export { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem; font-size: 16px; }
.ink-export h1, .ink-export h2, .ink-export h3, .ink-export h4, .ink-export h5, .ink-export h6 {
  line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 600; }
.ink-export h1 { font-size: 1.9em; } .ink-export h2 { font-size: 1.55em; }
.ink-export h3 { font-size: 1.3em; } .ink-export h4 { font-size: 1.1em; }
.ink-export p { margin: 0.8em 0; }
.ink-export a { color: #0969da; text-decoration: none; }
.ink-export code { background: #eff1f3; padding: 0.1em 0.35em; border-radius: 4px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 0.9em; }
.ink-export pre { background: #f6f8fa; padding: 1em; border-radius: 8px; overflow: auto; }
.ink-export pre code { background: none; padding: 0; }
.ink-export blockquote { margin: 0.8em 0; padding: 0.2em 1em; border-left: 4px solid #d0d7de; color: #57606a; }
.ink-export table { border-collapse: collapse; margin: 1em 0; }
.ink-export th, .ink-export td { border: 1px solid #d0d7de; padding: 0.4em 0.8em; }
.ink-export th { background: #f6f8fa; }
.ink-export img { max-width: 100%; }
.ink-export hr { border: none; border-top: 1px solid #d0d7de; margin: 2em 0; }
.ink-export .wikilink { color: #8250df; }
.ink-export-footer { max-width: 46rem; margin: 2rem auto 3rem; padding-top: 1rem;
  border-top: 1px solid #d0d7de; color: #8c959f; font-size: 0.85em; text-align: center; }
@media print { .ink-export { padding: 0; max-width: none; } @page { margin: 2cm; } }
`.trim();

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 正文 HTML + 元数据 → 完整自包含 HTML 文档串。 */
export function buildHtmlDocument(bodyHtml: string, meta: ExportMeta): string {
  const brand = meta.brandingText.trim();
  const footer =
    meta.brandingFooter && brand
      ? `\n<footer class="ink-export-footer">${esc(brand)}</footer>`
      : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${esc(meta.generator)}">
<title>${esc(meta.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<article class="ink-export">
${bodyHtml}
</article>${footer}
</body>
</html>`;
}
