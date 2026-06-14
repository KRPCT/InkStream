import type {
  BlockContext,
  Element as MdElement,
  InlineContext,
  Line,
  MarkdownConfig,
} from '@lezer/markdown';

/**
 * 行内 `$...$` + 块 `$$...$$` 数学公式自研 @lezer/markdown MarkdownConfig（FEAT-INLINE-MATH）。
 *
 * 与 wikiLink.ts 同套路（扫描式，非 delimiter）：
 *   - 行内 `$...$`（parseInline，同行配对，不跨行）：InlineMath > InlineMathMark($) + InlineMathContent + InlineMathMark($)。
 *     货币（$5）/转义（\$）/代码 span（`$x$`）三启发式见下；`$$` 一律退让给块解析器。
 *   - 块 `$$...$$`（parseBlock，可跨行）：BlockMath > BlockMathMark($$) + BlockMathContent + BlockMathMark($$)。
 *     行首 `$$` 即起块，吃到闭 `$$` 或文档末（容错，同 FencedCode；流式 BlockParser 无法「扫完再 bail」）。
 *
 * 三种写法（$ / $$ / ```math 围栏）并存共用同一 KaTeX 引擎（mathLoader 单例）。
 */

const DOLLAR = 36; // '$'
const BACKSLASH = 92; // '\'
const NEWLINE = 10; // '\n'

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57;
}
/** 空白（开定界后 / 闭定界前不许紧邻空白，排除 `$ x $` 噪声；含换行）。 */
function isSpace(ch: number): boolean {
  return ch === 32 || ch === 9 || ch === NEWLINE;
}

export const inlineMath: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath' },
    { name: 'InlineMathMark' },
    { name: 'InlineMathContent' },
    { name: 'BlockMath', block: true },
    { name: 'BlockMathMark' },
    { name: 'BlockMathContent' },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis', // $ 在 * _ 之前认领；不设 before:'InlineCode'，让代码 span 先吞其内 $（§代码冲突）
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== DOLLAR) return -1;
        if (cx.char(pos + 1) === DOLLAR) return -1; // `$$` 退让给块解析器
        // 不把 `$$` 的第二个 `$` 当单 `$` 开定界（否则 `$$x$$` 中段误配成 `$x$`）。
        if (pos > cx.offset && cx.char(pos - 1) === DOLLAR) return -1;
        // 转义 `\$` 守卫（Escape 解析器通常已处理，此为双保险）。
        if (pos > cx.offset && cx.char(pos - 1) === BACKSLASH) return -1;

        const openEnd = pos + 1;
        const afterOpen = cx.char(openEnd);
        // 货币启发式：开 `$` 后紧跟空白/数字 → 非公式（`$5` / `$ x`）。
        if (isSpace(afterOpen) || isDigit(afterOpen)) return -1;

        let i = openEnd;
        while (i < cx.end) {
          const ch = cx.char(i);
          if (ch === NEWLINE) return -1; // 行内公式不跨行
          if (ch === BACKSLASH) {
            i += 2; // 跳过被转义字符（含 \$）
            continue;
          }
          if (ch === DOLLAR) {
            const beforeClose = cx.char(i - 1);
            const afterClose = cx.char(i + 1);
            // 闭 `$` 前非空白（排除 `$x $`）、后非数字（排除货币 `$x$5`）、后非 `$`（让 `$$` 归块）。
            if (!isSpace(beforeClose) && !isDigit(afterClose) && afterClose !== DOLLAR) break;
          }
          i += 1;
        }
        if (i >= cx.end || cx.char(i) !== DOLLAR) return -1; // 未闭合
        const contentEnd = i;
        if (contentEnd <= openEnd) return -1; // 空 `$$`/`$ $` 排除

        const closeEnd = contentEnd + 1;
        const children: MdElement[] = [
          cx.elt('InlineMathMark', pos, openEnd),
          cx.elt('InlineMathContent', openEnd, contentEnd),
          cx.elt('InlineMathMark', contentEnd, closeEnd),
        ];
        return cx.addElement(cx.elt('InlineMath', pos, closeEnd, children));
      },
    },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      parse(cx: BlockContext, line: Line): boolean {
        const start = line.pos;
        if (line.text.charCodeAt(start) !== DOLLAR || line.text.charCodeAt(start + 1) !== DOLLAR) {
          return false;
        }
        const from = cx.lineStart + start;
        const openTo = from + 2;

        // 同行闭合 `$$...$$`。
        const sameClose = line.text.slice(start + 2).indexOf('$$');
        if (sameClose >= 0) {
          const contentTo = cx.lineStart + start + 2 + sameClose;
          addBlockMath(cx, from, openTo, contentTo, contentTo + 2);
          cx.nextLine();
          return true;
        }

        // 跨行：吃后续行到含 `$$` 的行；流式解析器不能扫完再退让，故未闭合则容错吃到文档末（同 FencedCode）。
        let contentTo = -1;
        let closeTo = -1;
        while (cx.nextLine()) {
          const idx = line.text.indexOf('$$');
          if (idx >= 0) {
            contentTo = cx.lineStart + idx;
            closeTo = contentTo + 2;
            break;
          }
        }
        if (closeTo < 0) {
          // 未闭合到 EOF：整块吃到文档末，无闭标记（contentTo===to）。
          const to = cx.prevLineEnd();
          addBlockMath(cx, from, openTo, to, to);
          return true;
        }
        addBlockMath(cx, from, openTo, contentTo, closeTo);
        cx.nextLine(); // 跳过闭 `$$` 所在行
        return true;
      },
    },
  ],
};

/** 产出 BlockMath 节点（开标记 + 内容 +（有则）闭标记）。to===contentTo 表示未闭合（无闭标记）。 */
function addBlockMath(
  cx: BlockContext,
  from: number,
  openTo: number,
  contentTo: number,
  to: number,
): void {
  const children: MdElement[] = [
    cx.elt('BlockMathMark', from, openTo),
    cx.elt('BlockMathContent', openTo, contentTo),
  ];
  if (to > contentTo) children.push(cx.elt('BlockMathMark', contentTo, to));
  cx.addElement(cx.elt('BlockMath', from, to, children));
}
