import { Compartment, type Extension } from '@codemirror/state';
import { composingGuard } from './composingGuard';
import { inlinePlugin } from './inlinePlugin';

/**
 * Live Preview 组合根（Pattern Map「livePreview.ts」/ RESEARCH Pattern 3+5）。
 *
 * 复制 extensions.ts:18-28 baseExtensions() 的 Extension[] 组合形态：把三层范式的各扩展聚到一处，
 * 经 renderModeCompartment 整体挂入单内核（默认 Live Preview，D-02）。
 *
 * CM6 自动合并多个 EditorView.decorations facet 输入（行内 ViewPlugin + 后续块级 StateField 共存，
 * 无需手动 merge，Pattern 3）。组合根设计为可扩展（前向兼容扩展点 2）：
 *   - Plan 05：块级 StateField（GFM 表格 / HTML 块整块还原）+ atomicRanges 追加进此数组；
 *   - Plan 06：删除线 / 行内代码 / 列表 / 引用 / 链接 / 水平线（inlinePlugin 内按同范式扩 nodeNames）；
 *   - Plan 07：链接 Ctrl/Cmd+点击手势 linkGesture 追加。
 */

/**
 * 装饰扩展集组合根：返回 [inlinePlugin（行内层）, composingGuard（IME 全局闸门）]。
 *
 * composingGuard 是全局护栏：后续装饰只要走同一 isFrozen / view.composing 短路即自动受保护（D-13）。
 */
export function livePreviewExtensions(): Extension[] {
  return [inlinePlugin, composingGuard];
}

/**
 * 渲染模式 Compartment（RESEARCH Pattern 5 / A3）：独立于 langCompartment，避免与语言热切耦合。
 *
 * 默认装 livePreviewExtensions()（D-02 默认 Live Preview）；setRenderMode / toggle / 指示器
 * 与 per-file 会话记忆留 Plan 04（本 plan 仅声明 compartment 并默认挂载）。
 */
export const renderModeCompartment = new Compartment();
