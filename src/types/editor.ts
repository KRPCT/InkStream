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

/**
 * 大纲条目（RightPanel 大纲 tab）：从 markdown 语法树析出的标题。
 * - level：1-6（ATXHeading/SetextHeading 级别）；
 * - text：标题纯文本（剥 `#` 标记与首尾空白）；
 * - from：标题在文档中的起始位置（点击导航的滚动锚点，每次 docChanged 重算保新鲜）。
 */
export interface OutlineItem {
  level: number;
  text: string;
  from: number;
}
