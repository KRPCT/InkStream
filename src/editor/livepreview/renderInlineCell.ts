import { GFM, parser as baseMarkdownParser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';

/**
 * 表格单元格行内 markdown → DOM 渲染（Typora 式：非激活单元格渲染行内样式，激活编辑时显示源码）。
 *
 * 背景：GFM 表格单元格支持行内 markdown（**粗** / *斜* / `代码` / ~~删除~~ / [链接]），但表格是块级
 * widget（Decoration.replace block），其单元格内容在 widget DOM 里——主编辑器的 inlinePlugin 装饰作用于
 * EditorView 文本 range，触达不到 widget 内部。故单元格此前一律 `textContent` 纯文本显示源码（用户报
 * 「表格内 markdown 渲染坏了」的根因）。
 *
 * 本模块用 `@lezer/markdown`（配 GFM，与编辑器同款解析器谱系）解析单元格文本，递归走语法树、用
 * createElement 构建 DOM（绝不 innerHTML，守 T-03-12 XSS 纪律）：StrongEmphasis→<strong>、
 * Emphasis→<em>、InlineCode→<code class=cm-ink-code>、Strikethrough→<span class=cm-ink-strike>、
 * Link→<span class=cm-link>（仅链接文字，隐 url；不用 <a href> 以免 webview 整页跳转）。各 Mark/URL
 * 节点隐藏（不渲染标记字符）。复用 inlinePlugin 已在册的 .cm-ink-code / .cm-ink-strike / .cm-link 样式
 * （表格 widget 在主编辑器 DOM 内，class 天然生效）；<strong>/<em> 用浏览器默认粗体/斜体。
 *
 * 安全：行内 HTML 标签（如 `<img onerror=...>`）落 default 分支按 createTextNode 原样作纯文本，
 * 绝不生成对应元素（与旧 textContent 行为一致，XSS 回归门不破）。
 */

/** 配 GFM 的 markdown 解析器（含 Strikethrough/Autolink；Table 在单行单元格文本上不触发）。 */
const inlineParser = baseMarkdownParser.configure(GFM);

/** 隐藏节点（标记字符 / url / 链接标题）：渲染态不产出 DOM（仅显内容文本）。 */
const HIDDEN_NODES: ReadonlySet<string> = new Set([
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'LinkMark',
  'URL',
  'LinkTitle',
]);

/**
 * 把单元格文本渲染为行内 markdown DOM 片段。`<br>`（经 unescapePipes 已转 `\n`）按硬换行分段，
 * 段间插 `<br>`，每段独立解析行内 markdown。
 */
export function renderInlineCell(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement('br'));
    frag.appendChild(renderLine(line));
  });
  return frag;
}

/** 解析单行并渲染其行内 markdown（Document 作透明容器，逐子节点 + 间隙文本重建）。 */
function renderLine(line: string): DocumentFragment {
  const tree = inlineParser.parse(line);
  return renderChildren(tree.topNode, 0, line.length, line);
}

/**
 * 渲染 node 的 [from,to] 区间：逐子节点构建，子节点间的「间隙」按纯文本补回（markdown 的行内文本不成
 * 独立节点，是 Mark/元素节点之间的空隙——故 StrongEmphasis 内 `**` 与 `**` 之间的 "粗" 由间隙逻辑捕获）。
 */
function renderChildren(node: SyntaxNode, from: number, to: number, src: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let pos = from;
  let child = node.firstChild;
  while (child) {
    if (child.from > pos) frag.appendChild(document.createTextNode(src.slice(pos, child.from)));
    const rendered = renderNode(child, src);
    if (rendered) frag.appendChild(rendered);
    pos = Math.max(pos, child.to);
    child = child.nextSibling;
  }
  if (pos < to) frag.appendChild(document.createTextNode(src.slice(pos, to)));
  return frag;
}

/** 单节点 → DOM（容器节点递归填内容；Mark/URL 隐藏；HTML 标签等未知叶子按纯文本，守 XSS）。 */
function renderNode(node: SyntaxNode, src: string): Node | null {
  switch (node.name) {
    case 'Document':
    case 'Paragraph':
      return renderChildren(node, node.from, node.to, src);
    case 'StrongEmphasis':
      return wrap('strong', undefined, node, src);
    case 'Emphasis':
      return wrap('em', undefined, node, src);
    case 'Strikethrough':
      return wrap('span', 'cm-ink-strike', node, src);
    case 'InlineCode':
      return wrap('code', 'cm-ink-code', node, src);
    case 'Link':
      // 仅渲染链接文字（隐 url）；用 <span> 而非 <a href> 避免 webview 整页导航（点击仍走 tableGesture 进编辑）。
      return wrap('span', 'cm-link', node, src);
    case 'Escape':
      // 转义序列 `\*` 等：只显被转义的字符（剥前导反斜杠）。
      return document.createTextNode(src.slice(node.from + 1, node.to));
    default:
      if (HIDDEN_NODES.has(node.name)) return null;
      // 未知节点：有子则递归（保内部样式），纯叶子（含行内 HTML 标签）按原文纯文本（不生成元素，守 XSS）。
      return node.firstChild
        ? renderChildren(node, node.from, node.to, src)
        : document.createTextNode(src.slice(node.from, node.to));
  }
}

/** 建一个标签元素并以 node 区间的内容（间隙 + 嵌套子节点，Mark 已隐）填充。 */
function wrap(
  tag: string,
  className: string | undefined,
  node: SyntaxNode,
  src: string,
): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.appendChild(renderChildren(node, node.from, node.to, src));
  return el;
}
