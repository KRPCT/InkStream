import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { inlineMath } from './livepreview/inlineMath';
import { wikiLink } from './livepreview/wikiLink';
import { wikiTargetPath } from './livepreview/wikiTarget';
import { typstBlockSyntax } from './livepreview/typstBlockSyntax';

/** from/to/contextFrom 均为 JavaScript/CodeMirror 的 UTF-16 偏移，context 保留原文用于重定位。 */
export interface WikiReference {
  targetPath: string;
  from: number;
  to: number;
  contextFrom: number;
  context: string;
  linkText: string;
}

export interface BacklinkReference extends WikiReference {
  sourcePath: string;
}

const markdown = parser.configure([GFM, wikiLink, inlineMath, typstBlockSyntax]);
export const MAX_REFERENCE_UNITS = 1_000_000;

function paragraphOf(node: SyntaxNode): SyntaxNode {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'Paragraph' || parent.name === 'TableCell' || /^(ATX|Setext)Heading/.test(parent.name)) return parent;
  }
  return node;
}

/** 使用编辑器同源 Markdown 语法树，原样保留同段/跨段重复引用。 */
export function collectWikiReferences(doc: string): WikiReference[] {
  // Raw files may use CRLF; navigation addresses the LF text held by CodeMirror.
  doc = doc.replace(/\r\n?/g, '\n');
  const references: WikiReference[] = [];
  let replyUnits = 0;
  markdown.parse(doc).iterate({
    enter: (entry) => {
      if (entry.name !== 'WikiLink') return;
      const node = entry.node;
      const target = node.getChild('WikiLinkTarget');
      if (!target) return false;
      const targetPath = wikiTargetPath(doc.slice(target.from, target.to));
      if (!targetPath) return false;
      const paragraph = paragraphOf(node);
      const contextFrom = paragraph.to - paragraph.from <= 1024 ? paragraph.from : Math.max(paragraph.from, node.from - 480);
      const contextTo = Math.min(paragraph.to, contextFrom + 1024);
      replyUnits += contextTo - contextFrom + node.to - node.from + targetPath.length + 100;
      if (replyUnits > MAX_REFERENCE_UNITS) throw new Error('单篇文档的关联引用超过显示预算，未返回部分结果。请使用全文搜索定位。');
      references.push({
        targetPath, from: node.from, to: node.to,
        contextFrom, context: doc.slice(contextFrom, contextTo),
        linkText: doc.slice(node.from, node.to),
      });
      return false;
    },
  });
  return references;
}

/** 当前正文重新解析：段落重排可重定位，删除、代码化或重复段落歧义均不盲跳旧偏移。 */
export function findReferenceRange(doc: string, reference: WikiReference): { from: number; to: number } | null {
  return referenceRangeFrom(doc, reference, collectWikiReferences(doc));
}

/** Match the same bounded context against a previously parsed, identical document snapshot. */
export function referenceRangeFrom(doc: string, reference: WikiReference, references: WikiReference[]): { from: number; to: number } | null {
  doc = doc.replace(/\r\n?/g, '\n');
  const sameLink = references.filter((candidate) => candidate.linkText === reference.linkText);
  const relative = reference.from - reference.contextFrom;
  const sameContext = sameLink.filter((candidate) =>
    candidate.from >= relative && doc.slice(candidate.from - relative, candidate.from - relative + reference.context.length) === reference.context,
  );
  if (sameContext.length !== 1) return null;
  const { from, to } = sameContext[0];
  return { from, to };
}

/** Literal mentions belong to visible prose, not links, code examples, comments or formulas. */
export function hasUnlinkedMention(doc: string, name: string): boolean {
  const needle = name.trim().normalize('NFC').toLocaleLowerCase();
  if (!needle) return false;
  doc = doc.normalize('NFC').toLocaleLowerCase();
  const excluded: Array<{ from: number; to: number }> = [];
  markdown.parse(doc).iterate({ enter(node) {
    if (/^(FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag|Comment|CommentBlock|WikiLink|Link|Image|InlineMath|BlockMath|TypstBlock)$/.test(node.name)) {
      excluded.push({ from: node.from, to: node.to });
      return false;
    }
  } });
  let range = 0;
  for (let from = doc.indexOf(needle); from >= 0; from = doc.indexOf(needle, from + 1)) {
    const to = from + needle.length;
    while (range < excluded.length && excluded[range].to <= from) range++;
    if (range < excluded.length && excluded[range].from < to) continue;
    if (/^[a-z0-9_]/.test(needle) && from > 0 && /[a-z0-9_]/.test(doc[from - 1])) continue;
    if (/[a-z0-9_]$/.test(needle) && /[a-z0-9_]/.test(doc[to] ?? '')) continue;
    return true;
  }
  return false;
}
