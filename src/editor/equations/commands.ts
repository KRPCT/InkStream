import { ensureSyntaxTree } from '@codemirror/language';
import type { ChangeSpec, EditorState } from '@codemirror/state';
import { useToastStore } from '../../stores/useToastStore';
import { isBasicEditing } from '../documentBudget';
import { queueAfterComposition } from '../composition';
import { currentDocumentNavigation, isCurrentDocumentNavigation } from '../editorState.navigation';
import { getView } from '../viewHandle';
import { equationBodyStart, equationCatalog, type EquationCatalog, type EquationIssue } from './catalog';
import { EQUATION_NUMBERING_MARKER, equationLabelMarker } from './markers';

function warning(message: string): void { useToastStore.getState().showToast('warning', message); }
function issueMessage(issue: EquationIssue): string {
  if (issue.kind === 'duplicate') return `公式标签重复：${issue.label}。请先更正标签。`;
  if (issue.kind === 'invalid') return `公式标签非法：${issue.label || '空标签'}。请使用字母、数字、下划线、点或连字符。`;
  if (issue.kind === 'orphan') return `标签 ${issue.label} 未关联公式。请把标签放在对应公式之后。`;
  return '公式块尚未闭合，请先补全结束标记。';
}

function newLabel(used: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const label = 'e-' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (!used.has(label)) { used.add(label); return label; }
  }
  throw new Error('无法生成唯一公式标签，请重试。');
}

function changesForNumbering(state: EditorState, catalog: EquationCatalog): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  if (!catalog.hasModeMarker) changes.push({ from: equationBodyStart(state.doc), insert: EQUATION_NUMBERING_MARKER + '\n\n' });
  const used = new Set(catalog.byLabel.keys());
  for (const entry of catalog.entries) {
    if (entry.label !== null) continue;
    changes.push({ from: entry.block.to, insert: '\n' + equationLabelMarker(newLabel(used)) + (entry.block.to === state.doc.length ? '\n' : '') });
  }
  return changes;
}

/** 一个用户动作只写一次标签事务；编号在呈现时派生，不向公式引擎源码注入数字。 */
export function numberEquations(): void {
  const view = getView();
  if (!view) { warning('请先打开包含公式的文档。'); return; }
  if (isBasicEditing(view.state)) { warning('基础编辑模式下暂停完整公式编号，请先显式启用完整排版。'); return; }
  const navigation = currentDocumentNavigation();
  queueAfterComposition(view, 'number-equations', () => {
    if (getView() !== view || !isCurrentDocumentNavigation(navigation)) return;
    if (isBasicEditing(view.state)) { warning('基础编辑模式下暂停完整公式编号。'); return; }
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 50);
    if (!tree) { warning('文档尚未完成解析，请稍后再执行公式编号。'); return; }
    const catalog = equationCatalog(view.state, tree);
    if (catalog.issues.length) { warning(issueMessage(catalog.issues[0])); return; }
    if (!catalog.entries.length) { warning('当前文档没有可编号的块公式。'); return; }
    try {
      const changes = changesForNumbering(view.state, catalog);
      if (changes.length) view.dispatch({ changes, userEvent: 'input.equation-numbering' });
    } catch (error) { warning(error instanceof Error ? error.message : '公式编号失败。'); }
  });
}
