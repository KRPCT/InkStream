import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { useEditorStore } from '../../stores/useEditorStore';
import { smartLinkPaste } from '../richtext/commands';
import { relayInsert } from './textareaRelay';

/**
 * 中继剪贴板（PROD-RELAY-DESIGN §2.8）。
 *
 * 焦点在隐藏 textarea，contentDOM 的 copy/cut/paste 不再发生——CM6 内建剪贴板处理全部失效。
 * 本模块在 textarea 上接管三事件，从 **CM6 doc 选区** 取/写文本（textarea 本身恒空）：
 *   - copy：写 CM 选区文本；空选区写整行 + '\n'（对齐 CM/VSCode 行级复制）；
 *   - cut：copy + 删除（userEvent 'delete.cut'，独立撤销分组）；
 *   - paste：先过 richtext 智能粘贴白名单（isRichtext 时），未处理则 relayInsert（'input.paste'）。
 *
 * Ctrl+C/X/V 不在 CM keymap 也不在 window 分发器，故由浏览器原生派发到 textarea → 本 handler；
 * 菜单三命令经 editCommands 回焦后 execCommand（copy/cut）或 navigator.clipboard（paste 降级）。
 */

/** 复制/剪切取文本：有选区取选区；空选区取整行 + '\n'（行级复制语义）。 */
export function clipboardText(view: EditorView): string {
  const sel = view.state.selection.main;
  if (!sel.empty) return view.state.doc.sliceString(sel.from, sel.to);
  return view.state.doc.lineAt(sel.head).text + '\n';
}

/** 剪切删除：有选区删选区；空选区删整行（含行尾换行，末行无换行可删）。userEvent 'delete.cut'。 */
function deleteForCut(view: EditorView): void {
  const sel = view.state.selection.main;
  if (!sel.empty) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to },
      selection: EditorSelection.cursor(sel.from),
      userEvent: 'delete.cut',
    });
    return;
  }
  const line = view.state.doc.lineAt(sel.head);
  const to = line.to < view.state.doc.length ? line.to + 1 : line.to;
  view.dispatch({
    changes: { from: line.from, to },
    selection: EditorSelection.cursor(line.from),
    userEvent: 'delete.cut',
  });
}

/**
 * 把文本粘贴进 CM doc 当前选区：richtext 文档先过智能链接白名单（URL + 有选区 → 包成链接），
 * 未处理则 relayInsert 带 'input.paste'（独立撤销分组）。空文本 no-op。
 */
export function relayPasteText(view: EditorView, text: string): void {
  if (!text) return;
  if (useEditorStore.getState().isRichtext && smartLinkPaste(view, text)) return;
  relayInsert(view, text, 'input.paste');
}

/** 在 textarea 上安装 copy/cut/paste 三事件接管，返回 detach（与控制器生命周期配对）。 */
export function installRelayClipboard(view: EditorView, textarea: HTMLTextAreaElement): () => void {
  const onCopy = (e: ClipboardEvent): void => {
    e.preventDefault();
    e.clipboardData?.setData('text/plain', clipboardText(view));
  };
  const onCut = (e: ClipboardEvent): void => {
    e.preventDefault();
    e.clipboardData?.setData('text/plain', clipboardText(view));
    deleteForCut(view);
  };
  const onPaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    relayPasteText(view, e.clipboardData?.getData('text/plain') ?? '');
  };
  textarea.addEventListener('copy', onCopy);
  textarea.addEventListener('cut', onCut);
  textarea.addEventListener('paste', onPaste);
  return () => {
    textarea.removeEventListener('copy', onCopy);
    textarea.removeEventListener('cut', onCut);
    textarea.removeEventListener('paste', onPaste);
  };
}

/**
 * 菜单粘贴的中继路径（§2.8 真机门）：WebView2 常禁脚本触发的 execCommand('paste')，故菜单
 * 「粘贴」在中继下降级为 navigator.clipboard.readText + relayPasteText。无权限 / 无 API 时静默
 * （键盘 Ctrl+V 走浏览器原生 paste 事件，是不依赖本路径的主路）。
 */
export async function relayPasteFromClipboard(view: EditorView): Promise<void> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  relayPasteText(view, text);
}
