import { Facet, StateEffect, StateField, type EditorState, type Transaction } from '@codemirror/state';
import type { DocumentBudget, DocumentEditingPreference, RenderMode } from '../types/editor';
import { isComposingTr } from './composition';

/** UTF-16 code units，与 CodeMirror Text.length 同单位，无需复制/重新编码全文。 */
export const LARGE_DOCUMENT_UNITS = 1_000_000;
export const documentLanguageHint = Facet.define<string, string>({ combine: (values) => values[0] ?? 'markdown' });
export const setDocumentPreference = StateEffect.define<DocumentEditingPreference>();
export const rememberFullRenderMode = StateEffect.define<RenderMode>();

interface BudgetState extends DocumentBudget { fullRenderMode: RenderMode }

export function budgetForLength(length: number, preference: DocumentEditingPreference = 'auto'): DocumentBudget {
  const large = length >= LARGE_DOCUMENT_UNITS;
  return { preference, large, mode: preference === 'basic' || (preference === 'auto' && large) ? 'basic' : 'full' };
}

export const documentBudgetField = StateField.define<BudgetState>({
  create: (state) => ({ ...budgetForLength(state.doc.length), fullRenderMode: 'live' }),
  update: (previous, transaction) => {
    const next = budgetAfterTransaction(transaction);
    const fullRenderMode = fullRenderModeAfterTransaction(transaction);
    if (previous.preference === next.preference && previous.mode === next.mode && previous.large === next.large && previous.fullRenderMode === fullRenderMode) return previous;
    return { ...next, fullRenderMode };
  },
});

export function readDocumentBudget(state: EditorState): DocumentBudget {
  return state.field(documentBudgetField, false) ?? budgetForLength(state.doc.length);
}

export function isBasicEditing(state: EditorState): boolean {
  return readDocumentBudget(state).mode === 'basic';
}

/** 不读 transaction.state：该 getter 会提前构建语言字段，导致保护发生在解析之后。 */
export function budgetAfterTransaction(transaction: Transaction): DocumentBudget {
  const previous = readDocumentBudget(transaction.startState);
  let preference = previous.preference;
  for (const effect of transaction.effects) if (effect.is(setDocumentPreference)) preference = effect.value;
  const next = budgetForLength(transaction.newDoc.length, preference);
  // 组合候选期间不卸载正在保护输入的装饰；compositionend 的刷新事务会补齐预算切换。
  // 普通粘贴仍在同一事务、语言解析之前生效。
  return next.mode === 'basic' && previous.mode === 'full' && isComposingTr(transaction)
    ? { ...next, mode: 'full' } : next;
}

export function fullRenderModeAfterTransaction(transaction: Transaction): RenderMode {
  let mode = transaction.startState.field(documentBudgetField, false)?.fullRenderMode ?? 'live';
  for (const effect of transaction.effects) if (effect.is(rememberFullRenderMode)) mode = effect.value;
  return mode;
}
