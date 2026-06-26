import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useOutlineStore } from '../stores/useOutlineStore';
import type { OutlineItem } from '../types/editor';
import { getView, revealRange } from './viewHandle';

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

/**
 * 光标所在的标题路径（面包屑 + 大纲活动项双向同步共用，v1.2 #2b）。
 *
 * active = 最后一个 `from <= pos` 的标题（items 按 from 单调递增，文档序）；祖先链 = 自 active 向前
 * 收集每个「严格更浅层级」的最近标题，直到 H1。光标在首个标题之前时返回空数组（面包屑据此自隐）。
 * 纯函数（不读 view/store），供组件按 (items, cursor) 反应式推导，无需另开镜像通道。
 */
export function activeHeadingPath(items: OutlineItem[], pos: number): OutlineItem[] {
  let activeIdx = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].from <= pos) activeIdx = i;
    else break;
  }
  if (activeIdx === -1) return [];
  const path: OutlineItem[] = [items[activeIdx]];
  let level = items[activeIdx].level;
  for (let i = activeIdx - 1; i >= 0 && level > 1; i--) {
    if (items[i].level < level) {
      path.unshift(items[i]);
      level = items[i].level;
    }
  }
  return path;
}

/** 光标所在的最深标题起始偏移（大纲活动项高亮键）；无则 null。 */
export function activeHeadingFrom(items: OutlineItem[], pos: number): number | null {
  const path = activeHeadingPath(items, pos);
  return path.length === 0 ? null : path[path.length - 1].from;
}

/** 把当前 view 的大纲镜像到 store（变化才写）。 */
export function syncOutline(view: EditorView): void {
  const items = extractOutline(view.state);
  if (sameOutline(useOutlineStore.getState().items, items)) return;
  useOutlineStore.getState().setOutline(items);
}

/**
 * 跳到某标题位置：移动光标 + 把该标题滚到编辑区顶部（大纲点击 / 命令面板 `@` 标题跳转共用）。
 * 滚动纪律下沉 viewHandle.revealRange（#17 真实滚动容器 + 不抢焦点），此处只解析 view。
 */
export function scrollToHeading(from: number): void {
  const view = getView();
  if (view === null) return;
  revealRange(view, from, from);
}
