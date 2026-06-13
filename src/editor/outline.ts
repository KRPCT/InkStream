import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useOutlineStore } from '../stores/useOutlineStore';
import type { OutlineItem } from '../types/editor';
import { getView, scrollContainer } from './viewHandle';

/**
 * 文档大纲（RightPanel 大纲 tab）：从 markdown 语法树析出 H1-H6 标题。
 *
 * 单向纪律（仿 syncRichtext）：CM → useOutlineStore，store 永不回写 CM。docChanged 经 mirrorListener
 * 触发，换装（openFile/switchToTab，不触发 updateListener）经 editorState 显式触发。
 */

/** ATXHeading1-6 / SetextHeading1-2 → 级别 1-6（HeaderMark 等子节点不匹配，不重复计入）。 */
const HEADING_RE = /^(?:ATX|Setext)Heading([1-6])$/;
/** 强制解析整篇的时间预算（ms）：长文档远处标题须强制解析才有节点（同 blockField 纪律）。 */
const PARSE_BUDGET_MS = 50;

/** 从 EditorState 析出有序大纲（纯函数，可测）。 */
export function extractOutline(state: EditorState): OutlineItem[] {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const items: OutlineItem[] = [];
  tree.iterate({
    enter(node) {
      const m = HEADING_RE.exec(node.name);
      if (m === null) return;
      const firstLine = state.doc.sliceString(node.from, node.to).split('\n')[0];
      const text = firstLine
        .replace(/^#+\s*/, '')
        .replace(/\s+#+\s*$/, '')
        .trim();
      items.push({ level: Number(m[1]), text, from: node.from });
    },
  });
  return items;
}

/** 两份大纲是否等价（级别/位置/文本逐项相同）——避免无变化时的无谓 setState 与面板重渲染。 */
function sameOutline(a: OutlineItem[], b: OutlineItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.level === b[i].level && x.from === b[i].from && x.text === b[i].text);
}

/** 把当前 view 的大纲镜像到 store（变化才写）。 */
export function syncOutline(view: EditorView): void {
  const items = extractOutline(view.state);
  if (sameOutline(useOutlineStore.getState().items, items)) return;
  useOutlineStore.getState().setOutline(items);
}

/**
 * 跳到某标题位置：移动光标 + 把该标题滚到编辑区顶部。
 *
 * 滚动作用于 #17 的真实滚动容器（外层 overflow-auto，非恒 0 的 scrollDOM）——故不用 CM 的
 * scrollIntoView（它只动 scrollDOM）。不程序化抢焦点（CONSTRAINTS §8 IME 纪律），由用户点击落焦。
 */
export function scrollToHeading(from: number): void {
  const view = getView();
  if (view === null) return;
  const pos = Math.min(Math.max(from, 0), view.state.doc.length);
  view.dispatch({ selection: { anchor: pos } });
  const container = scrollContainer(view);
  const editorTop =
    view.dom.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  container.scrollTop = Math.max(0, editorTop + view.lineBlockAt(pos).top - 8);
}
