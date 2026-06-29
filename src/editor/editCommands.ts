import { selectAll, undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import type { EditorView } from '@codemirror/view';
import { getView } from './viewHandle';
import { isMarkdownFamily } from './markdownCommands';
import { smartLinkPaste } from './richtext/commands';

/**
 * 「编辑」菜单的视图级命令（R4 §1.3 编辑组）：撤销/重做/全选/查找/替换/剪贴板。
 *
 * 全部经 getView() 取单内核 EditorView（EditorView 不进 store 纪律）；无活动编辑器时 no-op。
 * 撤销/重做/全选/查找直接调 @codemirror/commands / @codemirror/search（不需 DOM 焦点即生效）。
 *
 * 剪贴板（剪切/复制/粘贴）：菜单点击是真实用户手势——回焦编辑器（铁律 1 豁免：真实手势后合法回焦）
 * 后走浏览器原生 execCommand，复用 CM6 原生 contenteditable 的内建剪贴板处理。
 */

function withView(fn: (view: EditorView) => void): void {
  const view = getView();
  if (view) fn(view);
}

export function doUndo(): void {
  withView((view) => void undo(view));
}

export function doRedo(): void {
  withView((view) => void redo(view));
}

export function doSelectAll(): void {
  withView((view) => void selectAll(view));
}

export function doFind(): void {
  withView((view) => {
    openSearchPanel(view);
  });
}

/** 替换：CM6 搜索面板默认含替换行（openSearchPanel 即可达替换 UI）。 */
export function doReplace(): void {
  withView((view) => {
    openSearchPanel(view);
  });
}

/**
 * 复制/剪切（菜单手势）：view.focus() 回焦 contentDOM 后走浏览器原生 execCommand——在聚焦的
 * .cm-content 上触发同名事件，由 CM6 原生 contenteditable 的内建剪贴板处理接管。菜单点击是
 * 合法用户手势，execCommand('copy'/'cut') 在 WebView2/Chromium 此语境下可靠。
 */
function copyCut(action: 'cut' | 'copy'): void {
  withView((view) => {
    view.focus();
    document.execCommand(action);
  });
}

export function doCut(): void {
  copyCut('cut');
}

export function doCopy(): void {
  copyCut('copy');
}

/**
 * 粘贴（菜单 / 命令面板手势，v1.2.1 修复）：WebView2/Chromium 对**网页内容**禁用
 * `execCommand('paste')`（出于安全：网页不能静默读系统剪贴板），原实现是个空操作——故菜单粘贴
 * 粘不进外部应用复制的文本（而键盘 Ctrl+V 走浏览器受信任原生 paste 事件，clipboardData 已填好，
 * 命中 CM6 内建 paste handler，不受影响）。改为经 OS 剪贴板插件 readText() 主动读系统剪贴板，
 * 再 dispatch CM6 插入事务；并复用 smartLinkPaste 受信白名单（URL 包裹选区，与 Ctrl+V 行为一致，T-02-17）。
 *
 * 剪切/复制（copyCut）保留 execCommand：剪贴板**写**在 WebView2 用户手势下被允许，仍写入系统剪贴板。
 */
export async function doPaste(): Promise<void> {
  const view = getView();
  if (!view) return;
  view.focus();
  let text: string;
  try {
    text = await readText();
  } catch {
    return; // 剪贴板无文本 / 读取被拒 / 非 Tauri 运行时：静默 no-op
  }
  if (!text) return;
  // 智能链接仅限 markdown 家族文档（markdown/richtext，isMarkdownFamily=activeRenderMode!==null）：
  // smartLinkPaste 语言无关，若不门控会在 .py/.rs/.json 等代码文件里把选中源码误包成 [选区](URL)，
  // 污染源码且与 Ctrl+V（代码文件走纯文本粘贴）分叉。门控后与键盘路径对齐。
  if (isMarkdownFamily() && smartLinkPaste(view, text)) return; // http(s) URL + 有选区 → 包成 [选区](URL)
  view.dispatch(view.state.replaceSelection(text), {
    userEvent: 'input.paste',
    scrollIntoView: true,
  });
}
