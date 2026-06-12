import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { drawSelection, EditorView, highlightActiveLine, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { inkstreamHighlightStyle } from './highlightTheme';
import { extensionsForLanguage, langCompartment } from './languages';
import { livePreviewExtensions, renderModeCompartment } from './livepreview/livePreview';
import { compositionGate } from './composition';

/**
 * 编辑器正文排版基线 theme（R5-typography §3.3，D-1/D-3 修复）。
 *
 * 顶层挂入（与 compositionGate 同级，所有模式 / 语言生效）——正文字号 16px、行高 1.7（中文优先）、
 * 版心 46rem 居中。取值全部消费 base.css 的 --editor-* / --font-editor token，**永不硬编码**。
 *
 * IME 安全（铁律 1）：纯静态 CSS（font-size / line-height / max-width / margin / padding），
 * 不触焦点、不程序化抢焦点、不引重排时序，与组合冻结门正交。但 .cm-content 盒模型变更（max-width /
 * margin-inline）会改 CM6 视口宽度计算——须按 specs/03 矩阵第 4 判据真机复验候选窗锚点（记入交付提醒）。
 */
const editorBaseTheme = EditorView.theme({
  '.cm-scroller': {
    fontFamily: 'var(--font-editor)',
    fontSize: 'var(--editor-font-size)',
    lineHeight: 'var(--editor-line-height)',
  },
  '.cm-content': {
    maxWidth: 'var(--editor-max-width)',
    marginInline: 'auto',
    paddingInline: 'var(--editor-padding-x)',
    paddingBlock: '2rem',
    color: 'var(--text-normal)',
    WebkitFontSmoothing: 'antialiased',
    textRendering: 'optimizeLegibility',
  },
});

/**
 * 基础扩展集（RESEARCH「基础扩展集」）：全 App 单内核的通用编辑能力。
 *
 * 高亮：syntaxHighlighting(inkstreamHighlightStyle) 接 theme.css 的 --cm-* 变量（亮暗双套）。
 * 语言：langCompartment 承载当前语言扩展，默认 markdown，运行时经 switchLanguage 热切（Pattern 5）。
 *
 * 每次 openFile 新建 EditorState 时调用——history() 等带状态的扩展必须每个 state 各持一份，
 * 以保证 undo 历史按文件独立（Pitfall 3）。可传 lang 决定初始语言（openFile 用 languageForPath 提供）。
 *
 * 装饰层（D-02 默认 Live Preview）：renderModeCompartment 默认装 livePreviewExtensions()——
 * 新打开的 Markdown 文档即渲染（标题/加粗 + 光标行还原 + IME 安全）。compartment 独立于 langCompartment，
 * Plan 04 经 setRenderMode reconfigure 切 Source('[]')/Live。非 Markdown 文档无 HIDE_MARK 节点，
 * 装饰天然空操作（D-01）；指示器/命令的显隐由 Plan 04 处理。
 *
 * IME 组合冻结门（重构设计 §3.4 / 铁律 1#A）：compositionGate 挂在**顶层而非 renderModeCompartment 内**——
 * 渲染模式热切（Live↔Source）不得卸载门，Source 模式 / 代码文件 / 所有语言下门都须在册，否则
 * 组合期 setState/reconfigure 仍撕 DocView 吞字（A 独有的最深真缝）。门提供全项目唯一组合判据与排队收口。
 */
export function baseExtensions(lang: string = 'markdown'): Extension[] {
  return [
    compositionGate,
    editorBaseTheme,
    history(),
    drawSelection(),
    highlightActiveLine(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    search(),
    syntaxHighlighting(inkstreamHighlightStyle),
    langCompartment.of(extensionsForLanguage(lang)),
    renderModeCompartment.of(livePreviewExtensions()),
  ];
}

/** EditorView 的重渲染监听位（Task 3 useCodeMirror 注入 updateListener；此处导出供组合）。 */
export { EditorView };
