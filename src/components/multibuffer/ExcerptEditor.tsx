import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { useEffect, useRef } from 'react';

interface Props {
  /** 进入编辑时的摘录原文（初始 doc 快照）。 */
  initialText: string;
  /** Ctrl/Cmd+Enter 或「保存」：回传当前文本。 */
  onSave: (text: string) => void;
  /** Esc 或「取消」：放弃编辑。 */
  onCancel: () => void;
}

/**
 * 摘录行内编辑器（#2c 增量 2）：在全库搜索结果内就地挂一个**独立**次级 CM6 EditorView 编辑摘录文本。
 *
 * 与 tableCellEditor 同为「次级 EditorView 把编辑回写另一 doc 区间」范式，但本视图挂在 React 覆盖层
 * DOM 内、**不**嵌在主 contentDOM 子树——故无需 stopPropagation 事件隔离（主编辑器收不到这里的事件）。
 *
 * 焦点纪律（IME 铁律 / CONSTRAINTS §8）：**不程序化抢焦点**——WebView2 只在真实指针进入 contentDOM 时
 * 武装 OS IME；auto-focus 给的假光标会诱导首次中文组合吞字。故挂载即就绪，由用户点击编辑区自然落焦。
 * 创建/销毁严格配对（StrictMode：mount→cleanup→mount 各建各销）；handlers 经 ref 读取最新值，避免
 * props 变更触发 view 重建而丢失正在编辑的文本与撤销历史。Ctrl/Cmd+Enter 保存、Esc 取消、Enter 换行。
 */
export default function ExcerptEditor({ initialText, onSave, onCancel }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handlers = useRef({ onSave, onCancel });
  handlers.current = { onSave, onCancel };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: initialText,
        extensions: [
          history(),
          EditorView.lineWrapping,
          drawSelection(),
          EditorView.editable.of(true),
          keymap.of([
            {
              key: 'Mod-Enter',
              preventDefault: true,
              run: (v) => {
                handlers.current.onSave(v.state.doc.toString());
                return true;
              },
            },
            {
              key: 'Escape',
              preventDefault: true,
              run: () => {
                handlers.current.onCancel();
                return true;
              },
            },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          editorTheme,
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // 仅挂载时建一次：initialText 是初始 doc 快照，后续编辑由 CM 内核承载（不随 props 重建 view）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (): void => handlers.current.onSave(viewRef.current?.state.doc.toString() ?? initialText);

  return (
    <div className="mb-excerpt-edit">
      <div ref={hostRef} className="mb-excerpt-host" />
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          className="rounded-[4px] border border-[var(--background-modifier-border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => handlers.current.onCancel()}
          className="rounded-[4px] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]"
        >
          取消
        </button>
        <span className="text-[11px] text-[var(--text-faint)]">Ctrl+Enter 保存 · Esc 取消</span>
      </div>
    </div>
  );
}

/** 行内编辑器外观：与摘录 code 字体一致，左侧 accent 竖条标识编辑态；透明背景融入结果列表。 */
const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-monospace, monospace)',
    fontSize: '12px',
    lineHeight: '1.5',
    overflowX: 'hidden',
  },
  '.cm-content': {
    padding: '2px 0',
    caretColor: 'var(--text-normal)',
    color: 'var(--text-normal)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  },
  '.cm-line': { padding: '0' },
});
