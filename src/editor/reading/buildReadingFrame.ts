import type { ReadingGenre, ReadingPrefs } from '../../types/reading';
import { GENRE_PRESETS, READING_THEMES } from './readingPresets';

/**
 * 把正文 HTML 包成 sandbox iframe 的 srcdoc（FEAT-READ）：内联阅读排版 CSS（文体 + 偏好 + 主题 token）。
 * 在无 allow-scripts 的 sandbox iframe 渲染 → 内容里的脚本 / 事件处理 / javascript: 链接一律不执行（XSS 安全），
 * 故正文无需逐节点 sanitize。配色全用 var(--reading-* / 应用主题) token，无硬编码。
 */
export function buildReadingFrame(content: string, genre: ReadingGenre, prefs: ReadingPrefs): string {
  const g = GENRE_PRESETS[genre];
  const t = READING_THEMES[prefs.theme];
  const css = `
html,body{margin:0;height:100%;}
body{background:${t.bg};color:${t.text};overflow-y:auto;}
.ink-reading{max-width:${g.measure};margin:0 auto;padding:3rem 1.5rem 6rem;
  font-family:${g.fontFamily};font-size:${prefs.fontSize}px;line-height:${g.lineHeight};text-align:${g.textAlign};}
.ink-reading p{margin:0 0 .35em;text-indent:${g.textIndent};}
.ink-reading h1,.ink-reading h2,.ink-reading h3,.ink-reading h4{line-height:1.3;text-indent:0;margin:1.4em 0 .6em;}
.ink-reading img{max-width:100%;height:auto;}
.ink-reading a{color:inherit;text-decoration:underline;}
.ink-reading pre,.ink-reading code{font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap;}
.ink-reading blockquote{margin:.6em 0;padding:.2em 1em;border-left:3px solid currentColor;opacity:.85;}
.ink-reading table{border-collapse:collapse;margin:1em 0;}
.ink-reading td,.ink-reading th{border:1px solid currentColor;padding:.3em .6em;}
.ink-reading section + section{margin-top:2em;}
`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body><article class="ink-reading">${content}</article></body></html>`;
}
