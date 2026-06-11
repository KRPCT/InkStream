import { EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useEditorStore } from '../stores/useEditorStore';
import { getView } from './viewHandle';

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
 * 每文件滚动位置缓存（D-03 滚动位置显式恢复）。
 *
 * 滚动是 CM6 view 级关注点——view.setState 还原 doc/光标/选区/undo，但**不**携带 view 级
 * 滚动状态。故独立 Map 缓存 scrollTop，切走时记录、切回时在 setState 后回填（D-03 原文列项）。
 */
const scrollCache = new Map<string, number>();

/** 在 setState 之后推迟一帧回填滚动位置：避免被 setState 触发的布局重排覆盖。 */
function restoreScroll(view: EditorView, top: number): void {
  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = top;
  });
}

/**
 * 打开文件：命中缓存则恢复其完整 state（含光标/选区/undo 历史）；
 * 未命中则用 doc + ext 新建 EditorState 后整体换装。
 *
 * 换装后回填该 path 的滚动位置（缓存有则还原，无则置 0），实现 D-03 滚动位置恢复。
 */
export function openFile(view: EditorView, path: string, doc: string, ext: Extension): void {
  const cached = cache.get(path);
  const state = cached ?? EditorState.create({ doc, extensions: ext });
  view.setState(state);
  restoreScroll(view, scrollCache.get(path) ?? 0);
}

/**
 * 切到已打开（缓存命中）的 tab：快照当前活动文件 → setState 还原目标 + setActive + 滚动还原。
 *
 * 单内核换装的统一入口（EditorTabs 点击调用，组件不重复实现滚动/快照逻辑）。view 经 getView()
 * 解析。与 openFile 区别：不重读磁盘 doc——已开文件的最新编辑就在缓存 state 里。缓存缺失（异常）
 * 时仍 setActive，由 EditorArea 的打开流程兜底；无 view（未挂载）时静默返回。
 */
export function switchToTab(path: string): void {
  const view = getView();
  if (!view) return;
  const active = useEditorStore.getState().activePath;
  if (active && active !== path) snapshotBeforeSwitch(view, active);
  const cached = cache.get(path);
  if (cached) {
    view.setState(cached);
    restoreScroll(view, scrollCache.get(path) ?? 0);
  }
  useEditorStore.getState().setActive(path);
}

/** 切走当前文件前，把 view.state 快照与当前 scrollTop 存入缓存（含光标/选区/undo + 滚动位置）。 */
export function snapshotBeforeSwitch(view: EditorView, path: string): void {
  cache.set(path, view.state);
  scrollCache.set(path, view.scrollDOM.scrollTop);
}

/** 关 tab 时释放该文件 state 与滚动缓存（D-03 会话内，关 tab 即释放）。 */
export function disposeState(path: string): void {
  cache.delete(path);
  scrollCache.delete(path);
}

/** 仅供测试：清空缓存以隔离用例。 */
export function __clearCacheForTest(): void {
  cache.clear();
  scrollCache.clear();
}
