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
 * 行内「内容样式」节点：渲染态给「整个元素 range」加 Decoration.mark 视觉样式（line-through / 等宽底纹），
 * 与 HIDE_MARK（隐藏其内部标记）正交叠加。光标行还原由活动行整行硬跳过统一接管（inlinePlugin）。
 *
 * - Strikethrough → 删除线 line-through；InlineCode → 等宽 + var(--cm-inline-code-bg) 底纹圆角。
 */
export const INLINE_STYLE: ReadonlyMap<string, string> = new Map([
  ['Strikethrough', 'cm-ink-strike'],
  ['InlineCode', 'cm-ink-code'],
]);

/**
 * 逐行还原节点（D-06 行级）：列表项 / 引用块——光标所在行显标记保排版，其余行保渲染。
 *
 * 列表/引用是多行容器，按「光标所在行」粒度还原（inlinePlugin 活动行整行硬跳过），而非整个容器一并还原。
 */
export const LINE_REVEAL_MARK: ReadonlySet<string> = new Set([
  'ListMark', // - / * / + / 1. 列表项标记（逐行还原）
  'QuoteMark', // > 引用前缀（逐行还原 D-06）
]);

/** 水平线节点：Decoration.replace 为 <hr> widget（var(--cm-hr)）。 */
export const HR_NODE = 'HorizontalRule';

/** 行内 HTML 标签节点：`<u>` 开/闭各一，须跨开闭自配对加 underline（A2，03-01 固化结构）。 */
export const HTML_TAG_NODE = 'HTMLTag';

/**
 * 图片节点（D-09）：`![alt](url)` 整节点 → Decoration.replace 为 ImageWidget（行内 replace，block:false）。
 * 子节点为 LinkMark + URL（+ 可选 LinkTitle），整节点替换故子 URL 不再单独隐藏。
 */
export const IMAGE_NODE = 'Image';

/**
 * 链接 / 图片的 URL 子节点（lezerNodes dump 固化）：取真实 url 须读此子节点而非裸正则切片（WR-02）。
 * 裸正则 `^!\[...\]\(`/`\)$` 对 titled `![a](u "t")`、spaced `![a]( u )` 形态会把标题/空格并入 url，
 * 解析失败。语法树 URL 子节点对全部形态精确给出 url 区间（lezerNodes.test 固化 [from-to]）。
 */
export const URL_NODE = 'URL';

/**
 * 任务标记节点（D-09）：GFM `- [ ] x` 的 `[ ]`/`[x]`（TaskMarker，长 3，中间状态字符在 from+1）
 * → Decoration.replace 为 TaskCheckboxWidget（行内 replace）。点击改写中间字符走 history 可撤销。
 * 结构据 03-01/03-07 lezerNodes dump：ListItem > ListMark + Task > TaskMarker。
 */
export const TASK_MARKER_NODE = 'TaskMarker';

/**
 * wiki-link 节点（Phase 4 W2 / LINK-01，自研 MarkdownConfig 见 wikiLink.ts）：`[[target#h^b|alias]]`。
 * inlinePlugin 在 WIKI_LINK_NODE 整节点处理（return false 不下钻）：隐 WikiLinkMark（`[[`/`]]`/`|`）；
 * 有 WikiLinkAlias 则隐 WikiLinkTarget 显 alias，否则显 target——皆加 .cm-ink-wikilink 链接样式。
 * 活动行经 active 分支跳过 → 显 `[[...]]` 源码（Typora 范式）。子节点名供 getChild/getChildren 取用。
 */
export const WIKI_LINK_NODE = 'WikiLink';
export const WIKI_LINK_MARK = 'WikiLinkMark';
export const WIKI_LINK_TARGET = 'WikiLinkTarget';
export const WIKI_LINK_ALIAS = 'WikiLinkAlias';

/**
 * 块级原子节点：blockField 用 Decoration.replace({ block: true }) 整块替换，光标进块整还原（D-06）。
 * 这些是「半渲染会错乱」的多行原子块（RESEARCH「元素识别」表 / UI-SPEC GFM 表格）。
 *
 * 前向兼容扩展点（RESEARCH）：Phase 5 的 math/typst/latex 块、HTML 块（HTMLBlock）按同范式追加表项。
 * 当前 plan 仅落地 GFM 表格（Table），证明块级范式（StateField provide + atomicRanges + 整块还原）。
 */
export const BLOCK_REPLACE: ReadonlySet<string> = new Set([
  'Table', // GFM 表格（TableHeader/TableRow/TableCell/TableDelimiter 为其子节点）
]);

/**
 * Fenced 块识别（Phase 5 / BLOCK-01..03）：lezer 把 ```lang 解析为 `FencedCode` >
 * `CodeMark` + `CodeInfo`(=lang) + `CodeText`(=正文) + `CodeMark`（已 vitest 实测固化）。
 * 块级层据 CodeInfo 首词判定渲染引擎：math→KaTeX（W1）、latex→MathJax（W2）、typst→typst.ts（W3）。
 * 没有专门的 math/typst 节点——靠 info 串判定；正文取 CodeText 子节点（绝不裸正则切围栏）。
 */
export const FENCED_CODE_NODE = 'FencedCode';
export const CODE_INFO_NODE = 'CodeInfo';
export const CODE_TEXT_NODE = 'CodeText';
/** 块级层就地渲染的 fenced info 串 → 引擎（随 wave 增补；W1 math→KaTeX、W2 latex→MathJax）。 */
export const MATH_INFO = 'math';
export const LATEX_INFO = 'latex';

/** 由 ATXHeadingN 节点名取标题级别（1-6）；非标题节点返回 0。 */
export function headingLevel(nodeName: string): number {
  const m = /^ATXHeading([1-6])$/.exec(nodeName);
  return m ? Number(m[1]) : 0;
}

/**
 * ListMark 文本是否有序列表标记（lezerNodes dump 固化两形态）：
 *   - 无序：单字符 `-` / `*` / `+`（长 1）；
 *   - 有序：数字 + 定界符 `1.` / `2)` 等（末字符 `.` 或 `)`）。
 *
 * 有序标记的数字是有语义可见文本，渲染态保留不替换；无序标记换 `•` 项目符号 widget。
 */
export function isOrderedListMark(markText: string): boolean {
  return /^\d+[.)]$/.test(markText);
}
