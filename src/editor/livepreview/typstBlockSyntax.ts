import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';

function opening(line: Line): boolean {
  return line.indent < line.baseIndent + 4 && /^:::[ \t]*typst[ \t]*$/.test(line.text.slice(line.pos));
}

/** :::typst 块为叶子节点，内部内容不会被再次解析成 Markdown。 */
export const typstBlockSyntax: MarkdownConfig = {
  defineNodes: ['TypstBlock', 'TypstBlockMark', 'TypstBlockContent'],
  parseBlock: [{
    name: 'TypstBlock',
    before: 'FencedCode',
    endLeaf: (_cx: BlockContext, line: Line) => opening(line),
    parse(cx: BlockContext, line: Line): boolean {
      if (!opening(line)) return false;
      const from = cx.lineStart + line.pos;
      const openTo = cx.lineStart + line.text.length;
      const sourceFrom = openTo + 1;
      let closingFrom: number | null = null;
      let to = openTo;
      while (cx.nextLine()) {
        if (line.indent < line.baseIndent + 4 && /^:::[ \t]*$/.test(line.text.slice(line.pos))) {
          closingFrom = cx.lineStart + line.pos;
          to = cx.lineStart + line.text.length;
          break;
        }
        to = cx.lineStart + line.text.length;
      }
      const sourceTo = closingFrom === null ? to : Math.max(sourceFrom, cx.lineStart - 1);
      const children = [cx.elt('TypstBlockMark', from, openTo)];
      if (sourceTo > sourceFrom) children.push(cx.elt('TypstBlockContent', sourceFrom, sourceTo));
      if (closingFrom !== null) children.push(cx.elt('TypstBlockMark', closingFrom, to));
      cx.addElement(cx.elt('TypstBlock', from, to, children));
      if (closingFrom !== null) cx.nextLine();
      return true;
    },
  }],
};
