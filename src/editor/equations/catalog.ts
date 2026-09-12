import { syntaxTree } from '@codemirror/language';
import type { EditorState, Text } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import { isBasicEditing } from '../documentBudget';
import { formulaBlockFromNode, type FormulaBlock } from '../livepreview/formulaBlocks';
import { parseEquationMarker, type EquationMarker } from './markers';

export interface EquationEntry {
  readonly block: FormulaBlock;
  readonly ordinal: number;
  readonly label: string | null;
  readonly markerFrom: number | null;
  readonly renderTo: number;
}
export interface EquationIssue {
  readonly kind: 'invalid' | 'duplicate' | 'orphan' | 'unclosed';
  readonly label: string;
  readonly from: number;
}
export interface EquationCatalog {
  readonly enabled: boolean;
  readonly hasModeMarker: boolean;
  readonly entries: readonly EquationEntry[];
  readonly byFrom: ReadonlyMap<number, EquationEntry>;
  readonly byLabel: ReadonlyMap<string, EquationEntry>;
  readonly issues: readonly EquationIssue[];
  readonly modeMarkers: readonly { from: number; to: number }[];
}

const EMPTY: EquationCatalog = { enabled: false, hasModeMarker: false, entries: [], byFrom: new Map(), byLabel: new Map(), issues: [], modeMarkers: [] };
const cached = new WeakMap<Text, { tree: Tree; catalog: EquationCatalog }>();

/** 只读头部行，不把完整文档复制成第二份字符串。 */
export function equationBodyStart(doc: Text): number {
  if (doc.line(1).text !== '---') return 0;
  for (let number = 2; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    if (/^---[ \t]*$/.test(line.text)) return Math.min(doc.length, line.to + 1);
  }
  return 0;
}

/** 纯派生：编辑器与显式 HTML 导出共享同一标签关联及顺序规则。 */
export function buildEquationCatalog(state: EditorState, tree: Tree): EquationCatalog {
  const bodyFrom = equationBodyStart(state.doc);
  const blocks: FormulaBlock[] = [];
  const comments: { from: number; to: number; marker: EquationMarker }[] = [];
  tree.iterate({
    enter(node) {
      if (node.to <= bodyFrom) return false;
      const formula = formulaBlockFromNode(state, node.node);
      if (formula) { blocks.push(formula); return false; }
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
      if (node.name === 'CommentBlock' || node.name === 'HTMLBlock') {
        const marker = parseEquationMarker(state.doc.sliceString(node.from, node.to));
        if (marker) comments.push({ from: node.from, to: node.to, marker });
        return false;
      }
      return undefined;
    },
  });
  const entries: EquationEntry[] = blocks.map((block, index) => ({ block, ordinal: index + 1, label: null, markerFrom: null, renderTo: block.to }));
  const issues: EquationIssue[] = [];
  const modeMarkers: { from: number; to: number }[] = [];
  let blockIndex = -1;
  for (const comment of comments) {
    if (comment.marker.kind === 'mode') { modeMarkers.push({ from: comment.from, to: comment.to }); continue; }
    const { marker } = comment;
    if (marker.label === null) issues.push({ kind: 'invalid', label: marker.rawLabel, from: comment.from });
    while (blockIndex + 1 < blocks.length && blocks[blockIndex + 1].to <= comment.from) ++blockIndex;
    const entry = entries[blockIndex];
    if (!entry || !/^\s*$/.test(state.doc.sliceString(entry.block.to, comment.from))) {
      issues.push({ kind: 'orphan', label: marker.rawLabel, from: comment.from });
      continue;
    }
    entries[blockIndex] = { ...entry, label: marker.label, markerFrom: comment.from, renderTo: comment.to };
  }
  const byLabel = new Map<string, EquationEntry>();
  const duplicate = new Set<string>();
  for (const entry of entries) {
    if (entry.block.closingFrom === null) issues.push({ kind: 'unclosed', label: '', from: entry.block.from });
    if (entry.label === null) continue;
    if (byLabel.has(entry.label)) duplicate.add(entry.label);
    else byLabel.set(entry.label, entry);
  }
  for (const label of duplicate) {
    for (const entry of entries) if (entry.label === label) issues.push({ kind: 'duplicate', label, from: entry.markerFrom ?? entry.block.from });
    byLabel.delete(label);
  }
  return {
    enabled: comments.length > 0,
    hasModeMarker: modeMarkers.length > 0,
    entries,
    byFrom: new Map(entries.map((entry) => [entry.block.from, entry])),
    byLabel,
    issues,
    modeMarkers,
  };
}

/** Live Preview/命令读取受当前文档预算约束；显式导出使用上面的纯构建函数。 */
export function equationCatalog(state: EditorState, tree?: Tree): EquationCatalog {
  if (isBasicEditing(state)) return EMPTY;
  const currentTree = tree ?? syntaxTree(state);
  const previous = cached.get(state.doc);
  if (previous?.tree === currentTree) return previous.catalog;
  const catalog = buildEquationCatalog(state, currentTree);
  cached.set(state.doc, { tree: currentTree, catalog });
  return catalog;
}
