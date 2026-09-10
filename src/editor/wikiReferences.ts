import type { SyntaxNode } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { inlineMath } from './livepreview/inlineMath';
import { wikiLink } from './livepreview/wikiLink';
import { wikiTargetPath } from './livepreview/wikiTarget';

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

const markdown = parser.configure([GFM, wikiLink, inlineMath]);

function paragraphOf(node: SyntaxNode): SyntaxNode {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === 'Paragraph' || parent.name === 'TableCell' || /^(ATX|Setext)Heading/.test(parent.name)) return parent;
  }
  return node;
}

/** 使用编辑器同源 Markdown 语法树，原样保留同段/跨段重复引用。 */
export function collectWikiReferences(doc: string): WikiReference[] {
  const references: WikiReference[] = [];
  markdown.parse(doc).iterate({
    enter: (entry) => {
      if (entry.name !== 'WikiLink') return;
      const node = entry.node;
      const target = node.getChild('WikiLinkTarget');
      if (!target) return false;
      const targetPath = wikiTargetPath(doc.slice(target.from, target.to));
      if (!targetPath) return false;
      const paragraph = paragraphOf(node);
      references.push({
        targetPath, from: node.from, to: node.to,
        contextFrom: paragraph.from, context: doc.slice(paragraph.from, paragraph.to),
        linkText: doc.slice(node.from, node.to),
      });
      return false;
    },
  });
  return references;
}

/** 当前正文重新解析：段落重排可重定位，删除、代码化或重复段落歧义均不盲跳旧偏移。 */
export function findReferenceRange(doc: string, reference: WikiReference): { from: number; to: number } | null {
  const sameLink = collectWikiReferences(doc).filter((candidate) => candidate.linkText === reference.linkText);
  const relative = reference.from - reference.contextFrom;
  const sameContext = sameLink.filter((candidate) =>
    candidate.context === reference.context && candidate.from - candidate.contextFrom === relative,
  );
  if (sameContext.length !== 1) return null;
  const { from, to } = sameContext[0];
  return { from, to };
}
