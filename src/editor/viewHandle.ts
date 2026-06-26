import type { EditorView } from '@codemirror/view';

/**
 * 全 App 唯一 EditorView 的模块级句柄。
 *
 * useCodeMirror 在 effect 创建/销毁时 set/clear 此句柄；非 React 模块（FileTree 点击、
 * 命令面板「打开文件夹」）经 getView() 访问单内核，无需经 props 透传。
 * 不可序列化对象不进 Zustand（registry.ts 同纪律）——故用独立模块单例承载。
 */

let current: EditorView | null = null;

export function setView(view: EditorView | null): void {
  current = view;
}

export function getView(): EditorView | null {
  return current;
}

/**
 * 真实滚动容器（#17 根因）：本应用 CM6 的 scrollDOM（.cm-scroller）高度自适应、自身不滚动，真正滚动的是
 * 外层挂载容器 div.h-full.overflow-auto（EditorArea）。故滚动位置的存/取须作用于 view.dom 最近的**可滚
 * 祖先**（overflow-y auto/scroll 且内容溢出），而非恒为 0 的 scrollDOM——后者导致切 tab 往返存的恒是 0、
 * 还原也是空操作（滚动位置永不恢复）。找不到（短文档无溢出 / jsdom 无布局）时回退 scrollDOM：此时各处
 * scrollTop 皆 0、存取 0 等价无害，且兼容「.cm-scroller 自身滚动」的布局。
 *
 * 视图级 DOM 工具，置于 viewHandle（叶子模块）供 editorState 滚动存取 + outline 跳转复用，免成 import 环。
 */
export function scrollContainer(view: EditorView): HTMLElement {
  for (let n = view.dom.parentElement; n; n = n.parentElement) {
    const overflowY = getComputedStyle(n).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) {
      return n;
    }
  }
  return view.scrollDOM;
}

/**
 * 选中 [from,to) 并把其首行滚到编辑区顶部（标题跳转 `@` / 全文搜索定位 `#` 共用）。
 *
 * 滚动作用于 #17 的真实滚动容器（外层 overflow-auto，非恒 0 的 scrollDOM）——故不用 CM 的
 * scrollIntoView。不程序化抢焦点（CONSTRAINTS §8 IME 纪律），由用户点击落焦。from===to 即折叠光标。
 */
export function revealRange(view: EditorView, from: number, to: number): void {
  const len = view.state.doc.length;
  const a = Math.min(Math.max(from, 0), len);
  const b = Math.min(Math.max(to, a), len);
  view.dispatch({ selection: { anchor: a, head: b } });
  const container = scrollContainer(view);
  const editorTop =
    view.dom.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  container.scrollTop = Math.max(0, editorTop + view.lineBlockAt(a).top - 8);
}
