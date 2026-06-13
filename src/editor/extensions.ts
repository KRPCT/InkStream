import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { drawSelection, EditorView, highlightActiveLine, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { inkstreamHighlightStyle } from './highlightTheme';
import { extensionsForLanguage, langCompartment } from './languages';
import { livePreviewExtensions, renderModeCompartment } from './livepreview/livePreview';
import { compositionGate } from './composition';
import { mirrorListener } from './mirrorListener';

/**
 * 编辑器正文排版基线 theme（R5-typography §3.3；F4 CDP 实机修正）。
 *
 * 顶层挂入（与 compositionGate 同级，所有模式 / 语言生效）——正文字号 16px、行高 1.7（中文优先）。
 * 取值全部消费 base.css 的 --editor-* / --font-editor token，**永不硬编码**。
 *
 * 版心改 Zettlr 式（MainEditor.vue:693-714）：留白属于 .cm-scroller 的水平 padding，**绝不**压
 * .cm-content 盒模型。CM6 坐标系（posAtCoords/coordsAtPos）以 .cm-content 几何为准——往 content 叠
 * max-width/margin-inline/padding-inline 会破坏视口宽度计算与命中测试（F2/F3/CM6 官方铁律），故：
 *   - .cm-content 只保留 paddingBlock（垂直，官方允许）+ color/字体平滑；加 minWidth:0（Zettlr :704）
 *     允许内容盒在 flex scroller 里收缩，杜绝撑破与左侧露底。
 *   - .cm-scroller 用 paddingInline 居中内容列：max(留白, 1.5rem 下限) 纯 CSS 居中，留白属 scroller，
 *     点击留白由 CM6 映射到行首/行尾（Zettlr 同款），左侧不再露裸 scroller 底。
 *
 * IME 安全（铁律 1）：纯静态 CSS，不触焦点、不程序化抢焦点、不引重排时序，与组合冻结门正交。
 */
const editorBaseTheme = EditorView.theme({
  '.cm-scroller': {
    fontFamily: 'var(--font-editor)',
    fontSize: 'var(--editor-font-size)',
    lineHeight: 'var(--editor-line-height)',
    paddingInline: 'max(calc((100% - var(--editor-max-width)) / 2), 1.5rem)',
  },
  '.cm-content': {
    minWidth: '0',
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
 *
 * 镜像 listener（P0）：mirrorListener（markDirty/autosave/语言热切/richtext 镜像）必须在此
 * 而非 useCodeMirror 初始 state——updateListener 是 state 级 facet，换装即失联（铁律 0）。
 *
 * 输入路径：CM6 原生 contenteditable（editable 默认 true）。中文 IME 由 WebView2 148 Fixed
 * Runtime 承载（Chromium 149 回归 crbug 521205128 已坐实，pin 148 后原生输入全部正常）；
 * 组合期数据安全由 compositionGate 统一收口（contentDOM compositionstart/end 门）。
 */
export function baseExtensions(lang: string = 'markdown'): Extension[] {
  return [
    compositionGate,
    editorBaseTheme,
    // 软换行（无条件常开）：Zettlr editor-extension-sets.ts:192 / SilverBullet editor_state.ts:165 /
    // MarkFlowy setup.ts:72 三家同款。把 .cm-content 置 pre-wrap 且将行宽约束到 scroller（比纯 CSS 正确）。
    EditorView.lineWrapping,
    history(),
    drawSelection(),
    highlightActiveLine(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    search(),
    syntaxHighlighting(inkstreamHighlightStyle),
    langCompartment.of(extensionsForLanguage(lang)),
    renderModeCompartment.of(livePreviewExtensions()),
    mirrorListener,
  ];
}

/** EditorView 的重渲染监听位（Task 3 useCodeMirror 注入 updateListener；此处导出供组合）。 */
export { EditorView };
