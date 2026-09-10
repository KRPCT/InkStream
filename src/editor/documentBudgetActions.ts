import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { DocumentEditingPreference } from '../types/editor';
import { useEditorStore } from '../stores/useEditorStore';
import { queueAfterComposition } from './composition';
import { rememberFullRenderMode, setDocumentPreference } from './documentBudget';
import { currentDocumentNavigation, isCurrentDocumentNavigation } from './editorState.navigation';

/** 显式选择只 reconfigure 当前文档，不重建 State，不进入撤销历史。 */
export function setDocumentEditingMode(view: EditorView, preference: DocumentEditingPreference): void {
  const path = useEditorStore.getState().activePath;
  const navigation = currentDocumentNavigation();
  queueAfterComposition(view, 'document-budget', () => {
    if (path !== useEditorStore.getState().activePath || !isCurrentDocumentNavigation(navigation)) return;
    view.dispatch({
      effects: preference === 'full'
        ? [setDocumentPreference.of(preference), rememberFullRenderMode.of('live')]
        : [setDocumentPreference.of(preference)],
      annotations: Transaction.addToHistory.of(false),
    });
  });
}
