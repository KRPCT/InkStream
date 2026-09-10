import { EditorState, type Extension } from '@codemirror/state';
import { budgetAfterTransaction, budgetForLength, documentBudgetField, documentLanguageHint, fullRenderModeAfterTransaction, readDocumentBudget } from './documentBudget';
import { extensionsForLanguage, langCompartment } from './languages';
import { readLanguage } from './frontmatter';
import { livePreviewExtensions, renderModeCompartment } from './livepreview/livePreview';

/** 与造成跨门限的输入共用一笔事务；配置先替换，旧语言字段就不会解析新正文。 */
const updateDocumentBudget = EditorState.transactionExtender.of((transaction) => {
  const before = readDocumentBudget(transaction.startState);
  const after = budgetAfterTransaction(transaction);
  if (before.mode === after.mode) return null;
  const basic = after.mode === 'basic';
  const language = basic ? null : readLanguage(transaction.newDoc.toString()) ?? transaction.startState.facet(documentLanguageHint);
  return { effects: [
    langCompartment.reconfigure(basic ? [] : extensionsForLanguage(language!)),
    renderModeCompartment.reconfigure(!basic && fullRenderModeAfterTransaction(transaction) === 'live' ? livePreviewExtensions() : []),
  ] };
});

export function documentBudgetExtensions(language: string, documentLength: number): Extension[] {
  const basic = budgetForLength(documentLength).mode === 'basic';
  return [
    documentBudgetField,
    documentLanguageHint.of(language),
    updateDocumentBudget,
    langCompartment.of(basic ? [] : extensionsForLanguage(language)),
    renderModeCompartment.of(basic ? [] : livePreviewExtensions()),
  ];
}
