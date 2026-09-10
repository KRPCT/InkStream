import { syntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { BLOCK_MATH_CONTENT, BLOCK_MATH_NODE, CODE_INFO_NODE, CODE_TEXT_NODE, FENCED_CODE_NODE } from './nodeNames';

/** 公式编辑、预览和导出共享的文档范围契约。范围均为 CM UTF-16 偏移，右端不包含。 */
export type FormulaEngine = 'math' | 'latex' | 'typst';
export type FormulaSyntax = 'fenced' | 'typst-container' | 'block-math';

export interface FormulaBlock {
  readonly engine: FormulaEngine;
  readonly syntax: FormulaSyntax;
  readonly from: number;
  readonly to: number;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly source: string;
  readonly closingFrom: number | null;
  readonly closingLineFrom: number | null;
}

export function formulaBlockFromNode(state: EditorState, node: SyntaxNode): FormulaBlock | null {
  let engine: FormulaEngine;
  let syntax: FormulaSyntax;
  let content: SyntaxNode | null;
  let closingFrom: number | null;
  let emptyFrom: number;
  if (node.name === FENCED_CODE_NODE) {
    const info = node.getChild(CODE_INFO_NODE);
    const word = info ? state.doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : '';
    if (word !== 'math' && word !== 'latex' && word !== 'typst') return null;
    engine = word;
    syntax = 'fenced';
    content = node.getChild(CODE_TEXT_NODE);
    const marks = node.getChildren('CodeMark');
    closingFrom = marks.length > 1 ? marks[marks.length - 1].from : null;
    emptyFrom = Math.min(node.to, state.doc.lineAt(node.from).to + 1);
  } else if (node.name === 'TypstBlock') {
    engine = 'typst';
    syntax = 'typst-container';
    content = node.getChild('TypstBlockContent');
    const marks = node.getChildren('TypstBlockMark');
    closingFrom = marks.length > 1 ? marks[marks.length - 1].from : null;
    emptyFrom = Math.min(node.to, state.doc.lineAt(node.from).to + 1);
  } else if (node.name === BLOCK_MATH_NODE) {
    engine = 'math';
    syntax = 'block-math';
    content = node.getChild(BLOCK_MATH_CONTENT);
    const marks = node.getChildren('BlockMathMark');
    closingFrom = marks.length > 1 ? marks[marks.length - 1].from : null;
    emptyFrom = Math.min(node.to, node.from + 2);
  } else {
    return null;
  }
  const sourceFrom = content?.from ?? emptyFrom;
  const sourceTo = content?.to ?? sourceFrom;
  const closingLineFrom = closingFrom === null ? null : state.doc.lineAt(closingFrom).from;
  return { engine, syntax, from: node.from, to: node.to, sourceFrom, sourceTo, closingFrom, closingLineFrom, source: state.doc.sliceString(sourceFrom, sourceTo) };
}

/** 使用已有解析树，不在编译镜像的热路径强制解析全文。 */
export function collectFormulaBlocks(state: EditorState, tree: Tree = syntaxTree(state)): FormulaBlock[] {
  const blocks: FormulaBlock[] = [];
  tree.iterate({
    enter(node) {
      const block = formulaBlockFromNode(state, node.node);
      if (block) {
        blocks.push(block);
        return false;
      }
      if (node.name === FENCED_CODE_NODE) return false;
      return undefined;
    },
  });
  return blocks;
}

export function formulaBlockAt(state: EditorState, from: number): FormulaBlock | null {
  if (from < 0 || from > state.doc.length) return null;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    const block = formulaBlockFromNode(state, node);
    if (block && block.from === from) return block;
  }
  return null;
}

/** 空围栏编辑时补上源码与结束围栏之间的换行，避免把闭标记粘在源码末尾。 */
export function formulaSourceEdit(block: FormulaBlock, source: string): ChangeSpec {
  const separator = block.syntax !== 'block-math' && block.closingLineFrom === block.sourceTo && source.length > 0 && !source.endsWith('\n') ? '\n' : '';
  return { from: block.sourceFrom, to: block.sourceTo, insert: source + separator };
}
