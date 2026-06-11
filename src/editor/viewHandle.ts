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
