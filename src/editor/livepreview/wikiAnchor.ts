import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { bodyStart } from '../frontmatter';
import { FENCED_CODE_NODE, HIDE_MARK, WIKI_LINK_ALIAS, WIKI_LINK_NODE, WIKI_LINK_TARGET, headingLevel } from './nodeNames';
import type { WikiTarget } from './wikiTarget';

export type WikiAnchorResult =
  | { kind: 'found'; from: number; to: number }
  | { kind: 'missing' | 'ambiguous'; anchor: 'heading' | 'block'; label: string }
  | { kind: 'not-ready' };

const NON_BODY_NODES = new Set([FENCED_CODE_NODE, 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock', 'BlockMath', 'Escape']);
const normalizedLabel = (text: string): string => text.normalize('NFC').trim().replace(/\s+/gu, ' ');
const headingDepth = (name: string): number => name === 'SetextHeading1' ? 1 : name === 'SetextHeading2' ? 2 : headingLevel(name);

/** Heading text follows rendered inline labels, while original document offsets remain intact. */
function headingText(state: EditorState, node: SyntaxNode): string {
  if (HIDE_MARK.has(node.name) || node.name === 'LinkTitle' || node.name === 'HTMLTag') return '';
  if (node.name === 'URL' && node.parent?.name === 'Link') return '';
  if (node.name === 'Escape') return state.doc.sliceString(node.from + 1, node.to);
  if (node.name === WIKI_LINK_NODE) {
    const label = node.getChild(WIKI_LINK_ALIAS) ?? node.getChild(WIKI_LINK_TARGET);
    return label ? state.doc.sliceString(label.from, label.to) : '';
  }
  let text = '';
  let from = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    text += state.doc.sliceString(from, child.from) + headingText(state, child);
    from = child.to;
  }
  return text + state.doc.sliceString(from, node.to);
}

function inNonBodyNode(tree: Tree, pos: number): boolean {
  for (let node: SyntaxNode | null = tree.resolve(pos, 1); node; node = node.parent) {
    if (NON_BODY_NODES.has(node.name)) return true;
  }
  return false;
}

function blockStart(tree: Tree, pos: number, wholeBlock: boolean): number {
  let node = tree.resolve(pos, -1);
  while (node.parent && node.parent.name !== 'Document') {
    if (!wholeBlock && (node.name === 'Paragraph' || headingDepth(node.name) > 0)) return node.from;
    node = node.parent;
  }
  return node.from;
}

/**
 * Locate only body syntax. NFC-equivalent labels match; duplicate headings/IDs are explicit ambiguity.
 * Inline IDs refer to their paragraph; a standalone ID after a block refers to that preceding block.
 */
export function findWikiAnchor(state: EditorState, target: Pick<WikiTarget, 'heading' | 'block'>): WikiAnchorResult {
  const tree = ensureSyntaxTree(state, state.doc.length, 50);
  if (!tree) return { kind: 'not-ready' };
  const start = bodyStart(state.doc.toString());
  const headings: Array<{ from: number; level: number; label: string }> = [];
  tree.iterate({
    enter(node) {
      if (node.to <= start || NON_BODY_NODES.has(node.name)) return false;
      const level = headingDepth(node.name);
      if (level > 0 && node.from >= start) {
        headings.push({ from: node.from, level, label: normalizedLabel(headingText(state, node.node)) });
        return false;
      }
    },
  });

  let scopeFrom = start;
  let scopeTo = state.doc.length;
  if (target.heading) {
    const matches = headings.filter((heading) => heading.label === normalizedLabel(target.heading!));
    if (matches.length !== 1) return { kind: matches.length ? 'ambiguous' : 'missing', anchor: 'heading', label: target.heading };
    const heading = matches[0];
    scopeFrom = heading.from;
    scopeTo = headings.find((next) => next.from > heading.from && next.level <= heading.level)?.from ?? state.doc.length;
    if (!target.block) return { kind: 'found', from: heading.from, to: heading.from };
  }

  if (!target.block) return { kind: 'found', from: scopeFrom, to: scopeFrom };
  const matches: number[] = [];
  for (let lineNumber = state.doc.lineAt(scopeFrom).number; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (line.from >= scopeTo) break;
    const marker = /(?:^|\s)\^([\p{L}\p{N}\p{M}_-]+)[ \t]*$/u.exec(line.text);
    if (!marker || normalizedLabel(marker[1]) !== normalizedLabel(target.block)) continue;
    const markerAt = line.from + line.text.lastIndexOf('^');
    if (markerAt < start || inNonBodyNode(tree, markerAt)) continue;
    let from: number;
    if (line.text.trim() === `^${marker[1]}`) {
      let previous = lineNumber - 1;
      while (previous > 0 && !state.doc.line(previous).text.trim()) previous -= 1;
      if (previous < 1 || state.doc.line(previous).from < scopeFrom) continue;
      from = blockStart(tree, state.doc.line(previous).to, true);
    } else {
      from = blockStart(tree, markerAt, false);
    }
    if (from >= scopeFrom && from < scopeTo) matches.push(from);
  }
  return matches.length === 1
    ? { kind: 'found', from: matches[0], to: matches[0] }
    : { kind: matches.length ? 'ambiguous' : 'missing', anchor: 'block', label: target.block };
}
