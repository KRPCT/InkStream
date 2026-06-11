import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { drawSelection, EditorView, highlightActiveLine, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * 基础扩展集（RESEARCH「基础扩展集」）：全 App 单内核的通用编辑能力。
 * 语言/高亮 Compartment 留 02-02 接入；本阶段先保证纯文本编辑 + undo 历史可用。
 *
 * 每次 openFile 新建 EditorState 时调用——history() 等带状态的扩展必须每个 state 各持一份，
 * 以保证 undo 历史按文件独立（Pitfall 3）。
 */
export function baseExtensions(): Extension[] {
  return [
    history(),
    drawSelection(),
    highlightActiveLine(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    search(),
  ];
}

/** EditorView 的重渲染监听位（Task 3 useCodeMirror 注入 updateListener；此处导出供组合）。 */
export { EditorView };
