import { Compartment, type Extension } from '@codemirror/state';
import { inlinePlugin } from './inlinePlugin';
import { blockExtensions } from './blockField';
import { linkGesture } from './linkGesture';
import { tableGesture } from './tableGesture';

/**
 * Live Preview 组合根（Pattern Map「livePreview.ts」/ RESEARCH Pattern 3+5）。
 *
 * 复制 extensions.ts:18-28 baseExtensions() 的 Extension[] 组合形态：把三层范式的各扩展聚到一处，
 * 经 renderModeCompartment 整体挂入单内核（默认 Live Preview，D-02）。
 *
 * CM6 自动合并多个 EditorView.decorations facet 输入（行内 ViewPlugin + 后续块级 StateField 共存，
 * 无需手动 merge，Pattern 3）。组合根设计为可扩展（前向兼容扩展点 2）：
 *   - Plan 05（已落地，表格 Wave 1/2 反转后）：块级 StateField（GFM 表格**恒渲染** TableWidget，
 *     就地编辑发生在 widget 内 contenteditable 单元格，非整块还原源码）+ atomicRanges 经 blockExtensions 追加；
 *   - Plan 06：删除线 / 行内代码 / 列表 / 引用 / 链接 / `<u>` / 水平线（inlinePlugin 扩 nodeNames）
 *     + 链接 Ctrl/Cmd+点击手势 linkGesture（D-10，经 Plan 02 openExternal 窄权限通道）。
 */

/**
 * 装饰扩展集组合根：返回 [inlinePlugin（行内层）, blockExtensions（块级层）, linkGesture, tableGesture]。
 *
 * 行内 ViewPlugin 与块级 StateField 共存（CM6 自动合并 decorations facet，Pattern 3）；
 * blockExtensions = [tableEditState（就地编辑态）, blockField（块级 replace provide）,
 * tableAtomicRanges（光标跳过）, tableTheme]。
 * linkGesture 是 mousedown domEventHandler：Ctrl/Cmd+点击外链经 openExternal 跳转 / 普通点击置光标（D-10）。
 * tableGesture 紧随其后（Typora 式就地编辑，反转旧「点表格→整块还原源码」）：截获落在表格单元格上的
 *   mousedown，DOM 上溯取 cell → dispatch setTableEdit 进就地编辑态（不 preventDefault，让浏览器原生
 *   聚焦 contenteditable td，IME 武装最稳）。表格**恒保持 widget 渲染态**，编辑发生在 widget 内的
 *   contenteditable 单元格，装饰不撤；Wave 2 起经悬浮工具条 / 右键菜单做行列操作 + 列对齐（皆 dispatch 改
 *   doc 表格源，保合法 GFM）。
 *   顺序关键——linkGesture 在前：Ctrl/Cmd+外链点击它返回 true 短路，tableGesture 不劫持导航；
 *   普通点击命中表格时 linkGesture 无链接返回 false，轮到 tableGesture（CM6 按注册序短路 domEventHandlers）。
 * IME（重构设计 §3.4）：组合冻结门已上移到 baseExtensions 顶层（compositionGate，不在本组合根）——
 * 渲染模式热切不卸载门，Source 模式 / 代码文件 / 所有语言下门都在册。行内层据 isComposing(view)、
 * 块级层据 isComposingTr(tr) 在组合期 map 装饰而非重建语法树，保住正在合成的文本节点 DOM（不撕 → 不吞字）；
 * 组合结束后门派发一次 refreshLivePreview 强刷，恰好重建一次还原渲染态（CR-01）。
 * Option 2 的「活动行整行纯源码」build 路径不变，作为重建路径的文本相等闸门不变量与门叠加。
 */
export function livePreviewExtensions(): Extension[] {
  return [inlinePlugin, blockExtensions, linkGesture, tableGesture];
}

/**
 * 渲染模式 Compartment（RESEARCH Pattern 5 / A3）：独立于 langCompartment，避免与语言热切耦合。
 *
 * 默认装 livePreviewExtensions()（D-02 默认 Live Preview）；setRenderMode / toggle / 指示器
 * 与 per-file 会话记忆留 Plan 04（本 plan 仅声明 compartment 并默认挂载）。
 */
export const renderModeCompartment = new Compartment();
