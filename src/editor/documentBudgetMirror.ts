import type { EditorView } from '@codemirror/view';
import { useEditorStore } from '../stores/useEditorStore';
import { readDocumentBudget } from './documentBudget';

/** UI 只镜像预算描述，不复制正文或持有 EditorState。 */
export function syncDocumentBudget(view: EditorView): void {
  const { preference, mode, large } = readDocumentBudget(view.state);
  const previous = useEditorStore.getState().documentBudget;
  if (previous?.preference === preference && previous.mode === mode && previous.large === large) return;
  useEditorStore.setState({ documentBudget: { preference, mode, large } });
}
