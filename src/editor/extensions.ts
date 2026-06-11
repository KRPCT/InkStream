import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { drawSelection, EditorView, highlightActiveLine, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { inkstreamHighlightStyle } from './highlightTheme';
import { extensionsForLanguage, langCompartment } from './languages';

/**
 * 基础扩展集（RESEARCH「基础扩展集」）：全 App 单内核的通用编辑能力。
 *
 * 高亮：syntaxHighlighting(inkstreamHighlightStyle) 接 theme.css 的 --cm-* 变量（亮暗双套）。
 * 语言：langCompartment 承载当前语言扩展，默认 markdown，运行时经 switchLanguage 热切（Pattern 5）。
 *
 * 每次 openFile 新建 EditorState 时调用——history() 等带状态的扩展必须每个 state 各持一份，
 * 以保证 undo 历史按文件独立（Pitfall 3）。可传 lang 决定初始语言（openFile 用 languageForPath 提供）。
 */
export function baseExtensions(lang: string = 'markdown'): Extension[] {
  return [
    history(),
    drawSelection(),
    highlightActiveLine(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    search(),
    syntaxHighlighting(inkstreamHighlightStyle),
    langCompartment.of(extensionsForLanguage(lang)),
  ];
}

/** EditorView 的重渲染监听位（Task 3 useCodeMirror 注入 updateListener；此处导出供组合）。 */
export { EditorView };
