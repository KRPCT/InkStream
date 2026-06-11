import type { EditorView } from '@codemirror/view';
import { getView } from '../viewHandle';
import { languageFromDoc } from '../languages';
import { useEditorStore } from '../../stores/useEditorStore';
import type { RenderMode } from '../../types/editor';
import { livePreviewExtensions, renderModeCompartment } from './livePreview';

/**
 * renderMode 运行时切换（EDIT-02 / RESEARCH Pattern 5）。
 *
 * 复制 languages.ts switchLanguage 的「热切纪律」：经 renderModeCompartment.reconfigure 切换装饰扩展，
 * 绝不 EditorState.create（保 undo/选区/滚动，D-03 / T-03-09）。renderModeCompartment 由 livePreview.ts
 * 声明并已挂入 baseExtensions（默认 Live Preview，D-02）；本模块 re-export 供消费方与测试。
 */

export { renderModeCompartment };

/**
 * 文档是否 markdown 可渲染（D-01）：解析语言为 markdown 或 richtext（二者共用 markdown 语法树）。
 *
 * 其余语言（latex/typst/python/...）无 Live Preview 装饰目标，指示器隐藏 + 命令 no-op。
 */
export function isMarkdownDoc(doc: string, path: string): boolean {
  const lang = languageFromDoc(doc, path);
  return lang === 'markdown' || lang === 'richtext';
}

/**
 * 热切渲染模式：'live' 装 livePreviewExtensions()，'source' 装空（[]）。
 *
 * reconfigure 只换 compartment 内容、不动 doc——切换前后 doc/选区/undo 全保留（热切非重建）。
 */
export function setRenderMode(view: EditorView, mode: RenderMode): void {
  view.dispatch({
    effects: renderModeCompartment.reconfigure(mode === 'live' ? livePreviewExtensions() : []),
  });
}

/**
 * 读当前 compartment 装的是否 Live Preview：空扩展（[]）即 source，否则 live。
 *
 * renderModeCompartment.get 返回当前装入的 Extension（'live' 时为 livePreviewExtensions() 数组，
 * 'source' 时为 setRenderMode 写入的 []）。以「是否空数组」判定，与 setRenderMode 写入形态对称。
 */
export function getRenderMode(view: EditorView): RenderMode {
  const current = renderModeCompartment.get(view.state);
  return Array.isArray(current) && current.length === 0 ? 'source' : 'live';
}

/**
 * 「视图：切换渲染模式」命令实现（仿 cycleDocumentLanguage 形态）。
 *
 * - 无 view（编辑器未挂载）→ null；
 * - 非 markdown/richtext 文档 → 静默 no-op 返回 null（D-01）；
 * - 否则取当前模式取反 setRenderMode，写 store UI 镜像，返回新模式。
 *
 * 非 markdown 判定走 store 镜像 `activeRenderMode === null`——editorState 在 openFile/switchToTab
 * 对非 markdown 文档把镜像置 null（单一来源），命令据此短路，与指示器隐藏同条件。
 * per-file 缓存写入下沉 editorState（按 activePath 键），避免本模块反向依赖缓存实现。
 */
export function toggleRenderMode(view: EditorView | null = getView()): RenderMode | null {
  if (!view) return null;
  if (useEditorStore.getState().activeRenderMode === null) return null;
  const next: RenderMode = getRenderMode(view) === 'live' ? 'source' : 'live';
  setRenderMode(view, next);
  useEditorStore.getState().setActiveRenderMode(next);
  return next;
}
