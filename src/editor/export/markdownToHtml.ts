import { GFM, parser as baseParser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import { bodyStart } from '../frontmatter';
import { inlineMath } from '../livepreview/inlineMath';
import { wikiLink } from '../livepreview/wikiLink';

/**
 * 文档导出用 markdown → 语义 HTML 串（FEAT-EXPORT 基石）。HTML / PDF / DOCX 三导出共用此一次解析输出。
 *
 * 用与编辑器同款的 @lezer/markdown 解析器谱系（GFM + 自研 wikiLink + inlineMath，见 languages.ts），
 * 递归走语法树（同 renderInlineCell 的间隙文本重建法）逐节点拼 HTML，全程 escape 文本（导出产物可被浏览器
 * 打开，正文为不可信用户内容，守 XSS）。数学经注入的 renderMath（KaTeX/MathJax 串）；缺省降级为代码。
 * frontmatter（YAML 头）按 bodyStart 剔除，不进正文。
 */

const parser = baseParser.configure([GFM, wikiLink, inlineMath]);

export type MathRenderer = (src: string, display: boolean) => string;
export interface MdToHtmlOptions {
  /** 数学渲染器（KaTeX/MathJax → HTML 串）。缺省时 $..$/$$..$$/```math 降级为代码块。 */
  renderMath?: MathRenderer;
}

interface Ctx {
  src: string;
  opts: MdToHtmlOptions;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

/** URL 协议（相对路径经哑 base 仍判 http(s)）；非法 URL 返空。 */
function urlProtocol(raw: string): string {
  try {
    return new URL(raw, 'https://_/').protocol;
  } catch {
    return '';
  }
}
/**
 * 链接 href 协议白名单（镜像 ipc/opener.ts，防 `[x](javascript:alert(1))` / `data:` XSS——导出 HTML 在外部
 * 浏览器打开，无 WebView2 导航拦截兜底，须在产出端拦）。剥 `<url>` 角括号；白名单外（javascript/data/vbscript/file…）落 `#`。
 */
function safeHref(u: string): string {
  const raw = u.replace(/^<|>$/g, '').trim();
  const p = urlProtocol(raw);
  return p === 'http:' || p === 'https:' || p === 'mailto:' || p === 'tel:' ? raw : '#';
}
/** 图片 src 白名单：另放行 `data:image/`（内嵌图片合法，img src 不执行脚本），其余仅 http(s)。 */
function safeSrc(u: string): string {
  const raw = u.replace(/^<|>$/g, '').trim();
  if (/^data:image\//i.test(raw)) return raw;
  const p = urlProtocol(raw);
  return p === 'http:' || p === 'https:' ? raw : '#';
}

/** 标记 / url 等结构节点：行内与块上下文均不直接产出（按需在专门分支取值）。 */
const HIDDEN: ReadonlySet<string> = new Set([
  'HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark', 'QuoteMark', 'ListMark',
  'LinkMark', 'LinkTitle', 'URL', 'WikiLinkMark', 'InlineMathMark', 'BlockMathMark',
]);

function text(node: SyntaxNode, ctx: Ctx): string {
  return ctx.src.slice(node.from, node.to);
}
function childOf(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) return c;
  return null;
}
function childText(node: SyntaxNode, name: string, ctx: Ctx): string {
  const c = childOf(node, name);
  return c ? text(c, ctx) : '';
}

/** 行内内容：逐子节点 + 子节点间隙纯文本补回（间隙是 markdown 的行内文本，escape 后并入）。 */
function inlineChildren(node: SyntaxNode, from: number, to: number, ctx: Ctx): string {
  let html = '';
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) html += esc(ctx.src.slice(pos, child.from));
    html += renderInline(child, ctx);
    pos = Math.max(pos, child.to);
  }
  if (pos < to) html += esc(ctx.src.slice(pos, to));
  return html;
}

function renderInline(node: SyntaxNode, ctx: Ctx): string {
  const inner = (): string => inlineChildren(node, node.from, node.to, ctx);
  switch (node.name) {
    case 'StrongEmphasis': return `<strong>${inner()}</strong>`;
    case 'Emphasis': return `<em>${inner()}</em>`;
    case 'Strikethrough': return `<s>${inner()}</s>`;
    case 'InlineCode': return `<code>${inner()}</code>`;
    case 'Escape': return esc(ctx.src.slice(node.from + 1, node.to));
    case 'HardBreak': return '<br>';
    case 'TaskMarker': return `<input type="checkbox" disabled${/x/i.test(text(node, ctx)) ? ' checked' : ''}> `;
    case 'Task': return inner();
    case 'Link': {
      const raw = childText(node, 'URL', ctx);
      return raw ? `<a href="${escAttr(safeHref(raw))}">${inner()}</a>` : inner();
    }
    case 'Image': {
      const url = childOf(node, 'URL');
      // alt = `![` 与 url 前 `](` 之间的原文（含 `]` 也不截断，不靠贪婪正则）。
      const alt = ctx.src.slice(node.from + 2, url ? url.from : node.to).replace(/\]\s*\(?\s*$/, '');
      return `<img src="${escAttr(safeSrc(url ? text(url, ctx) : ''))}" alt="${escAttr(alt)}">`;
    }
    case 'Autolink': {
      const u = safeHref(text(node, ctx));
      return `<a href="${escAttr(u)}">${esc(u)}</a>`;
    }
    case 'WikiLink': {
      const display = childText(node, 'WikiLinkAlias', ctx) || childText(node, 'WikiLinkTarget', ctx);
      return `<span class="wikilink">${esc(display)}</span>`;
    }
    case 'InlineMath': {
      const c = childText(node, 'InlineMathContent', ctx);
      return ctx.opts.renderMath ? ctx.opts.renderMath(c, false) : `<code>${esc(c)}</code>`;
    }
    default:
      if (HIDDEN.has(node.name)) return '';
      return node.firstChild ? inner() : esc(text(node, ctx));
  }
}

const HEADING_RE = /^(?:ATX|Setext)Heading([1-6])$/;

function blockChildren(node: SyntaxNode, ctx: Ctx): string {
  let html = '';
  for (let c = node.firstChild; c; c = c.nextSibling) html += renderBlock(c, ctx);
  return html;
}
function listItems(node: SyntaxNode, ctx: Ctx): string {
  let html = '';
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'ListItem') html += `<li>${blockChildren(c, ctx)}</li>`;
  }
  return html;
}
function cells(row: SyntaxNode, tag: 'th' | 'td', ctx: Ctx): string {
  let html = '';
  for (let c = row.firstChild; c; c = c.nextSibling) {
    if (c.name === 'TableCell') html += `<${tag}>${inlineChildren(c, c.from, c.to, ctx)}</${tag}>`;
  }
  return html;
}
function renderTable(node: SyntaxNode, ctx: Ctx): string {
  let head = '';
  let body = '';
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'TableHeader') head = `<tr>${cells(c, 'th', ctx)}</tr>`;
    else if (c.name === 'TableRow') body += `<tr>${cells(c, 'td', ctx)}</tr>`;
  }
  return `<table>${head ? `<thead>${head}</thead>` : ''}${body ? `<tbody>${body}</tbody>` : ''}</table>`;
}
function renderFence(node: SyntaxNode, ctx: Ctx): string {
  const lang = childText(node, 'CodeInfo', ctx).trim().split(/\s+/)[0].toLowerCase();
  const code = childText(node, 'CodeText', ctx);
  if (lang === 'math' && ctx.opts.renderMath) return ctx.opts.renderMath(code, true);
  const cls = lang ? ` class="language-${escAttr(lang)}"` : '';
  return `<pre><code${cls}>${esc(code)}</code></pre>`;
}

function renderBlock(node: SyntaxNode, ctx: Ctx): string {
  const h = HEADING_RE.exec(node.name);
  if (h) return `<h${h[1]}>${inlineChildren(node, node.from, node.to, ctx).trim()}</h${h[1]}>`;
  switch (node.name) {
    case 'Document': return blockChildren(node, ctx);
    case 'Paragraph': return `<p>${inlineChildren(node, node.from, node.to, ctx)}</p>`;
    case 'Blockquote': return `<blockquote>${blockChildren(node, ctx)}</blockquote>`;
    case 'BulletList': return `<ul>${listItems(node, ctx)}</ul>`;
    case 'OrderedList': return `<ol>${listItems(node, ctx)}</ol>`;
    case 'FencedCode': return renderFence(node, ctx);
    case 'CodeBlock': return `<pre><code>${esc(text(node, ctx))}</code></pre>`;
    case 'HorizontalRule': return '<hr>';
    case 'Table': return renderTable(node, ctx);
    case 'BlockMath': {
      const c = childText(node, 'BlockMathContent', ctx);
      return ctx.opts.renderMath ? ctx.opts.renderMath(c, true) : `<pre><code>${esc(c)}</code></pre>`;
    }
    case 'HTMLBlock': return `<pre>${esc(text(node, ctx))}</pre>`; // 原样 HTML 一律 escape（守 XSS）
    default:
      if (HIDDEN.has(node.name)) return '';
      return node.firstChild ? blockChildren(node, ctx) : '';
  }
}

/** markdown 文档 → 正文 HTML 串（剔除 frontmatter）。 */
export function markdownToHtml(markdown: string, opts: MdToHtmlOptions = {}): string {
  const src = markdown.slice(bodyStart(markdown));
  const tree = parser.parse(src);
  return renderBlock(tree.topNode, { src, opts });
}
