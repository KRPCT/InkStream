import { EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * 每文件 EditorState 缓存（D-03 会话内）。
 *
 * 模块级单例 Map（同 commands/registry.ts 单例纪律）——不可序列化的 EditorState 实例
 * 绝不进 Zustand，只在此模块内按 path 键缓存。关 tab 即 disposeState 释放。
 *
 * 真相源纪律：切换文件用 view.setState(整体换装)，绝不用 transaction/reconfigure 换文档
 * （Pitfall 3：避免 undo 历史跨文件串味）。每文件独立 EditorState 各持独立 history。
 */

const cache = new Map<string, EditorState>();

/**
 * 打开文件：命中缓存则恢复其完整 state（含光标/选区/undo 历史）；
 * 未命中则用 doc + ext 新建 EditorState 后整体换装。
 */
export function openFile(view: EditorView, path: string, doc: string, ext: Extension): void {
  const cached = cache.get(path);
  const state = cached ?? EditorState.create({ doc, extensions: ext });
  view.setState(state);
}

/** 切走当前文件前，把 view.state 快照存入缓存（含光标/选区/undo）。 */
export function snapshotBeforeSwitch(view: EditorView, path: string): void {
  cache.set(path, view.state);
}

/** 关 tab 时释放该文件缓存（D-03 会话内，关 tab 即释放）。 */
export function disposeState(path: string): void {
  cache.delete(path);
}

/** 仅供测试：清空缓存以隔离用例。 */
export function __clearCacheForTest(): void {
  cache.clear();
}
