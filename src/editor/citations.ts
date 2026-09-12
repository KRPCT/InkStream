import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCitationStore, type CitationEntry } from '../stores/useCitationStore';
import { isBasicEditing } from './documentBudget';
import { citationDocument } from './citationDocument';

/**
 * 引用面板镜像：复用文档级 Markdown / Typst / LaTeX 引用模型，排除示例并按首现顺序计数。
 *
 * 单向纪律（仿 editor/outline.ts）：CM doc → useCitationStore，store 永不回写 CM。
 * docChanged 经 mirrorListener 触发，换装经 editorState 显式触发。
 */

/** 从 doc 文本析出引用条目（去重 + 计数，按首现顺序）。纯函数，可测。 */
export function extractCitations(state: EditorState): CitationEntry[] {
  return citationDocument(state).citations;
}

/** 两份引用列表是否等价（key/count 逐项相同）——无变化不 setState，避免面板无谓重渲染。 */
function sameCitations(a: CitationEntry[], b: CitationEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.key === b[i].key && x.count === b[i].count);
}

/** 把当前 view 的引用镜像到 store（变化才写）。 */
export function syncCitations(view: EditorView): void {
  const items = isBasicEditing(view.state) ? [] : extractCitations(view.state);
  if (sameCitations(useCitationStore.getState().citations, items)) return;
  useCitationStore.getState().setCitations(items);
}
