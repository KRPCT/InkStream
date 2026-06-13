import type { Element as MdElement, InlineContext, MarkdownConfig } from '@lezer/markdown';

/**
 * Obsidian 风 wiki-link 自研 `@lezer/markdown` MarkdownConfig（Phase 4 W2 / LINK-01）。
 *
 * 全语法：`[[target#heading^block|alias]]`——`#heading` / `^block` / `|alias` 皆可选。扫描式行内解析器
 * （非 delimiter）：见 `[[` 即在同一行内扫到 `]]`，整段产 WikiLink 节点 + 子节点，绝不跨行。
 *
 * 节点结构（供 inlinePlugin 渲染隐藏结构字符/显示展示文本，及 W2' 抽链入 links 表）：
 *   WikiLink                       整段 `[[...]]`
 *     WikiLinkMark `[[`            前括号（渲染隐藏）
 *     WikiLinkTarget `t#h^b`       `|` 前的链接规格（路径#标题^块；无 alias 时即展示文本）
 *     WikiLinkMark `|`             别名分隔（有 alias 时；渲染隐藏）
 *     WikiLinkAlias `alias`        别名展示文本（有 alias 时）
 *     WikiLinkMark `]]`            后括号（渲染隐藏）
 *
 * 排序于默认 `Link` 解析器之前（`before: 'Link'`）：`[[` 以 `[` 开头，若 Link 先压入 LinkStart delimiter
 * 会把 `[[...]]` 误解析为嵌套链接；本解析器先认领整段 `[[...]]`，Link 再不会触达这些字符。
 */

const BRACKET = 91; // '['
const CLOSE = 93; // ']'
const PIPE = 124; // '|'
const NEWLINE = 10; // '\n'

export const wikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink' },
    { name: 'WikiLinkMark' },
    { name: 'WikiLinkTarget' },
    { name: 'WikiLinkAlias' },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      parse(cx: InlineContext, next: number, pos: number): number {
        // 仅 `[[` 触发；单 `[` 交回默认 Link 解析器。
        if (next !== BRACKET || cx.char(pos + 1) !== BRACKET) return -1;
        const openEnd = pos + 2; // `[[` 之后
        // 同行内扫到 `]]`，途中记首个 `|`（别名分隔）。跨行 / 无闭合 → 非 wiki-link。
        let i = openEnd;
        let pipe = -1;
        while (i < cx.end) {
          const ch = cx.char(i);
          if (ch === NEWLINE) return -1;
          if (ch === CLOSE && cx.char(i + 1) === CLOSE) break;
          if (ch === PIPE && pipe < 0) pipe = i;
          i += 1;
        }
        if (i >= cx.end || cx.char(i) !== CLOSE) return -1; // 未闭合
        const contentEnd = i; // 首个 `]`（`]]` 起点）
        if (contentEnd <= openEnd) return -1; // 空 `[[]]` 不成链
        const end = contentEnd + 2; // `]]` 之后

        const children: MdElement[] = [cx.elt('WikiLinkMark', pos, openEnd)];
        const targetEnd = pipe >= 0 ? pipe : contentEnd;
        if (targetEnd > openEnd) children.push(cx.elt('WikiLinkTarget', openEnd, targetEnd));
        if (pipe >= 0) {
          children.push(cx.elt('WikiLinkMark', pipe, pipe + 1));
          if (contentEnd > pipe + 1) children.push(cx.elt('WikiLinkAlias', pipe + 1, contentEnd));
        }
        children.push(cx.elt('WikiLinkMark', contentEnd, end));
        return cx.addElement(cx.elt('WikiLink', pos, end, children));
      },
      before: 'Link',
    },
  ],
};
