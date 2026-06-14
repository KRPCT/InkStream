import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useCitationStore, type CitationEntry } from '../stores/useCitationStore';

/**
 * 文档引用析出（Phase 8 ZOT-03，RightPanel 引用 tab）：扫文档全部 pandoc 式 `[@citekey]`
 * （含多选 `[@a; @b]`、行内 `@key`），去重 + 计数。
 *
 * 单向纪律（仿 editor/outline.ts）：CM doc → useCitationStore，store 永不回写 CM。
 * docChanged 经 mirrorListener 触发，换装经 editorState 显式触发。
 */

// citekey 仅在引用语境出现：行首 / 空白 / `[` / `;` / `(` 之后，避免误吞邮箱（user@host 的 @ 前是字母）。
// key 首字符 letter/digit/_（含 CJK \p{L}），后接 citekey 合法字符。
const CITE_RE = /(?:^|[\s[;(])@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)/gu;

/** 从 doc 文本析出引用条目（去重 + 计数，按首现顺序）。纯函数，可测。 */
export function extractCitations(state: EditorState): CitationEntry[] {
  const text = state.doc.toString();
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    const key = m[1];
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order.map((key) => ({ key, count: counts.get(key) ?? 1 }));
}

/** 两份引用列表是否等价（key/count 逐项相同）——无变化不 setState，避免面板无谓重渲染。 */
function sameCitations(a: CitationEntry[], b: CitationEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.key === b[i].key && x.count === b[i].count);
}

/** 把当前 view 的引用镜像到 store（变化才写）。 */
export function syncCitations(view: EditorView): void {
  const items = extractCitations(view.state);
  if (sameCitations(useCitationStore.getState().citations, items)) return;
  useCitationStore.getState().setCitations(items);
}
