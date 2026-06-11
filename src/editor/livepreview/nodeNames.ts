/**
 * lezer（markdown + GFM）节点名集中表（Pattern Map「nodeNames.ts」/ RESEARCH「元素识别 via tree」）。
 *
 * 风格仿 languages.ts:67-88 EXT_TO_LANG 集中常量表：装饰层一切「节点名 → 行为」判定都查这两张表，
 * 框架代码（inlinePlugin / 块级层）不内联裸字符串，节点名只在此处登记。
 *
 * 前向兼容扩展点 1（RESEARCH）：后续 Phase 只**追加表项**，不改框架——
 *   - Phase 4：WikiLink / WikiLinkMark / Citation / CitationMark（Obsidian 变体 MarkdownConfig）；
 *   - Phase 5：math / typst / latex 块的围栏标记（CodeMark 已覆盖 ```，块级层另立）；
 *   - Phase 8/9：脚注 / 高亮标记等。
 * 当前 plan 仅落地标题 H1-H6 + 加粗 + 斜体（证明 ≥1 元素 + 光标行还原，建立范式）；
 * 删除线 / 行内代码 / 列表 / 引用 / 链接 / `<u>` / 水平线在 Plan 06 按同范式追加（节点名已在表中预登记）。
 */

/**
 * 标记字符节点：渲染态用 Decoration.mark 隐藏其字符（绝不从 doc 删除，真相源不变 T-03-06）。
 * 节点名取自 03-01 lezerNodes.test.ts 固化的 markdown + GFM 解析结构。
 */
export const HIDE_MARK: ReadonlySet<string> = new Set([
  'HeaderMark', // # / ## ... 标题前缀（含尾随空格由装饰层一并处理）
  'EmphasisMark', // * / _ 斜体与 ** / __ 加粗的标记符
  'CodeMark', // ` 行内代码围栏
  'StrikethroughMark', // ~~ 删除线（GFM）
  'LinkMark', // [ ] ( ) 链接括号
  'QuoteMark', // > 引用前缀
  'ListMark', // - / * / + / 1. 列表项标记
]);

/**
 * 可还原元素节点：光标落在其 range 内时 inlinePlugin return false（显标记保排版，D-07）。
 * 这些是「整个元素」节点（含其标记 + 内容），非标记节点本身。
 */
export const REVEALABLE: ReadonlySet<string> = new Set([
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'StrongEmphasis', // **加粗**
  'Emphasis', // *斜体*
  'Strikethrough', // ~~删除线~~（GFM，Plan 06 渲染）
  'InlineCode', // `代码`（Plan 06 渲染）
  'Link', // [文本](url)（Plan 06 渲染）
]);

/** 由 ATXHeadingN 节点名取标题级别（1-6）；非标题节点返回 0。 */
export function headingLevel(nodeName: string): number {
  const m = /^ATXHeading([1-6])$/.exec(nodeName);
  return m ? Number(m[1]) : 0;
}
