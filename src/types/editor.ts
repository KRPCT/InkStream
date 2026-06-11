/**
 * 编辑器相关类型集中处（CLAUDE.md：类型集中 src/types/）。
 */

/**
 * 渲染模式（EDIT-02 / D-02..D-05）：
 * - 'source'：源码模式，renderModeCompartment 装空扩展（无 Live Preview 装饰）；
 * - 'live'：实时预览，renderModeCompartment 装 livePreviewExtensions()（默认，D-02）。
 *
 * 切换经 Compartment.reconfigure 热切（不重建 EditorState，保 undo/选区/滚动，D-03）。
 */
export type RenderMode = 'source' | 'live';
