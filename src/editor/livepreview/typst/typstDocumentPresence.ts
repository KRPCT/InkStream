import type { EditorView } from '@codemirror/view';

const managed = new WeakSet<EditorView>();
export const isTypstDocumentManaged = (view: EditorView): boolean => managed.has(view);
export function markTypstDocumentManaged(view: EditorView, value: boolean): void {
  if (value) managed.add(view);
  else managed.delete(view);
}
