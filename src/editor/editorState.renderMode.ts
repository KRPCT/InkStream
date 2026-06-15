import type { EditorView } from '@codemirror/view';
import { useEditorStore } from '../stores/useEditorStore';
import { getRenderMode, isMarkdownDoc, setRenderMode } from './livepreview/renderMode';
import type { RenderMode } from '../types/editor';

/**
 * 每文件渲染模式记忆（D-03 会话内，EDIT-02）。从 editorState 析出（Phase 3 renderMode 重设计预备隔离面）。
 *
 * 平行 scrollCache：renderMode 是 view 级关注点（compartment 装的扩展），view.setState 换装
 * 不携带它。故按 path 缓存当前文件的 source/live 选择，切走时记录、切回时 setRenderMode 重放，
 * 关 tab 即释放、不跨重启持久化。store.activeRenderMode 仅镜像当前活动文件（权威在此 Map）。
 */
const renderModeCache = new Map<string, RenderMode>();

/** 取某 path 的会话内 renderMode 记忆（无记忆返回 null；测试/调用方据此判初次打开）。 */
export function getRenderModeForPath(path: string): RenderMode | null {
  return renderModeCache.get(path) ?? null;
}

/**
 * 把当前 view 的 renderMode 态镜像到 store（仿 syncRichtext 单向纪律，D-01 显隐）。
 *
 * markdown/richtext 文档：镜像当前 compartment 模式（source/live）；
 * 非 markdown 文档：镜像置 null——指示器隐藏、toggle 命令 no-op（D-01 同条件）。
 */
export function syncRenderMode(view: EditorView, path: string): void {
  const md = isMarkdownDoc(view.state.doc.toString(), path);
  useEditorStore.getState().setActiveRenderMode(md ? getRenderMode(view) : null);
}

/**
 * 打开/切到文件时应用其会话内 renderMode 记忆并同步镜像。
 *
 * 仅 markdown/richtext 文档应用：无记忆默认 'live'（D-02）；非 markdown 文档跳过 setRenderMode
 * （其 compartment 本就空），镜像由 syncRenderMode 置 null。
 */
export function applyRenderMode(view: EditorView, path: string): void {
  if (isMarkdownDoc(view.state.doc.toString(), path)) {
    setRenderMode(view, renderModeCache.get(path) ?? 'live');
  }
  syncRenderMode(view, path);
}

/** 切走某文件前记录其 renderMode 记忆（仅 markdown/richtext 文档有切换语义）。 */
export function snapshotRenderMode(view: EditorView, path: string): void {
  if (isMarkdownDoc(view.state.doc.toString(), path)) {
    renderModeCache.set(path, getRenderMode(view));
  }
}

/** 关 tab 时释放该 path 的 renderMode 记忆。 */
export function disposeRenderMode(path: string): void {
  renderModeCache.delete(path);
}

/** 切库重归位：把 renderMode 记忆从旧 key 迁到新 key（保留 source/live 选择）。 */
export function rekeyRenderMode(oldPath: string, newPath: string): void {
  if (oldPath === newPath) return;
  const mode = renderModeCache.get(oldPath);
  if (mode !== undefined) {
    renderModeCache.set(newPath, mode);
    renderModeCache.delete(oldPath);
  }
}

/** 仅供测试：清空 renderMode 记忆以隔离用例。 */
export function clearRenderModeCache(): void {
  renderModeCache.clear();
}
