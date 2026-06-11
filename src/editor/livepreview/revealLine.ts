import type { EditorState } from '@codemirror/state';

/**
 * 光标行还原纯函数工具（Pattern Map「revealLine.ts」/ UI-SPEC「显标记保排版」D-07）。
 *
 * inlinePlugin 据此判定：光标落在某元素 range 内（或与某行同行）则 return false 还原源码。
 * 纯函数（只读 state.selection / state.doc），无副作用，便于配对单测穷举边界。
 */

/**
 * 主光标 head 是否落在 [from,to]（闭区间，含端点）。
 *
 * 用主选区（state.selection.main）的 head；多光标场景以主光标为还原判据（与 CM6 视觉焦点一致）。
 * 含端点：光标贴在元素边界时也算「在元素内」，避免边界处装饰闪烁。
 */
export function cursorInRange(state: EditorState, from: number, to: number): boolean {
  const head = state.selection.main.head;
  return head >= from && head <= to;
}

/** 主光标是否与 pos 处于同一行（行级还原：光标所在列表项/引用行显标记，其余行保渲染 D-06）。 */
export function isCursorOnLineOf(state: EditorState, pos: number): boolean {
  const head = state.selection.main.head;
  return state.doc.lineAt(head).number === state.doc.lineAt(pos).number;
}
