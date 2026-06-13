import { selectAll, undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { getView } from './viewHandle';

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
 * 粘贴（菜单手势）：回焦 contentDOM 后 execCommand('paste') 触发 CM6 原生内建 paste（含
 * richtext 智能链接白名单——挂在 langCompartment 的 paste domEventHandler，T-02-17）。
 * 键盘 Ctrl+V 始终走浏览器原生 paste 事件，不依赖本命令。
 */
export function doPaste(): void {
  withView((view) => {
    view.focus();
    document.execCommand('paste');
  });
}
