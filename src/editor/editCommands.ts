import { selectAll, undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { focusEditor } from './relay/relayFocus';
import { getView } from './viewHandle';

/**
 * 「编辑」菜单的视图级命令（R4 §1.3 编辑组）：撤销/重做/全选/查找/替换/剪贴板。
 *
 * 全部经 getView() 取单内核 EditorView（EditorView 不进 store 纪律）；无活动编辑器时 no-op。
 * 撤销/重做/全选/查找直接调 @codemirror/commands / @codemirror/search（不需 DOM 焦点即生效）。
 *
 * 剪贴板（剪切/复制/粘贴）：菜单点击是真实用户手势——回焦编辑器（铁律 1 豁免：真实手势后合法回焦）
 * 后走浏览器原生 execCommand，复用 CM6 已挂的剪贴板处理（不程序化抢焦点武装 IME）。
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
 * 剪贴板三命令：菜单手势后经 focusEditor 回焦输入面再走浏览器原生剪贴板。
 * 旧路径（flag 关）：焦点落 contentDOM，execCommand 触发 CM6 既有 cut/copy/paste 处理。
 * 中继路径：焦点落隐藏 textarea——paste 经 execCommand 注入 textarea 触发 input 中继可用；
 * copy/cut 需 textarea 侧剪贴板事件接管（Wave 3，PROD-RELAY-DESIGN §2.8），当前暂降级。
 */
function clipboard(action: 'cut' | 'copy' | 'paste'): void {
  withView((view) => {
    focusEditor(view);
    // execCommand 已弃用但在 WebView2/Chromium 仍受支持，且菜单点击是合法手势——
    // 是触发既有剪贴板处理最稳的桥（不引 navigator.clipboard 权限复杂度）。
    document.execCommand(action);
  });
}

export function doCut(): void {
  clipboard('cut');
}

export function doCopy(): void {
  clipboard('copy');
}

export function doPaste(): void {
  clipboard('paste');
}
