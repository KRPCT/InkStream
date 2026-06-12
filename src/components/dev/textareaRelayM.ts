import { EditorSelection } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';

/**
 * M 区【textarea 输入中继・K 区重做】核心：隐藏 textarea 构造 + 事件中继（设计：
 * .planning/rebuild/ux/H-relay-design.md §2/§3；区装配见 relayZoneM.ts）。
 *
 * 对 K 失败根因的本模块对策：
 *   - 隐藏 = Monaco 式 1px × 行高 + 透明前景 + z-index:-10（禁 opacity:0 整面覆盖，修 K 根因 4）；
 *   - keydown 经 isComposing||229 放行 IME 键后桥给 CM6 keymap（替代 K 手写的 ±1 方向键）；
 *   - compositionend 落子后 reset 延迟到 defer，下一 compositionstart 已到则取消（避 EDIT-06
 *     二次组合竞态）；组合期绝不落子、绝不清空 textarea（CM5 铁律）。
 */

/** 可注入的延迟调度（真机 rAF；测试传手动队列锁定 reset 时序）。 */
export interface RelayDefer {
  schedule: (task: () => void) => number;
  cancel: (id: number) => void;
}

export const rafDefer: RelayDefer = {
  schedule: (task) => requestAnimationFrame(task),
  cancel: (id) => cancelAnimationFrame(id),
};

/** Monaco 式隐藏 textarea：1px × 行高、透明前景、z-index:-10（绝不拦鼠标、绝不 opacity:0）。 */
export function createRelayTextarea(view: EditorView): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.setAttribute('data-relay-m-input', '');
  ta.setAttribute('aria-label', 'M 中继 textarea');
  ta.setAttribute('wrap', 'off');
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocorrect', 'off');
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('spellcheck', 'false');
  Object.assign(ta.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '1px',
    height: `${view.defaultLineHeight}px`,
    margin: '0',
    padding: '0',
    border: 'none',
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre',
    color: 'transparent',
    background: 'transparent',
    caretColor: 'transparent',
    zIndex: '-10',
  } satisfies Partial<CSSStyleDeclaration>);
  return ta;
}

/** 统一落子原语：替换当前选区插入文本，光标移到其后，带 input.type 语义（history/扩展可识别）。 */
export function relayInsert(view: EditorView, text: string): void {
  if (!text) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    scrollIntoView: true,
    userEvent: 'input.type',
  });
}

/**
 * 事件中继：非组合 input 即时落子并清空；组合期（compositionstart→end）不动 CM；compositionend 取
 * e.data（空则退回 value）一次性落子；keydown 桥 CM6 keymap。返回 cleanup。
 */
export function installRelayInput(
  view: EditorView,
  textarea: HTMLTextAreaElement,
  defer: RelayDefer = rafDefer,
): () => void {
  let composing = false;
  let pendingReset: number | null = null;
  let residue = ''; // compositionend 已落子但尚未 reset 的 textarea 残文（防尾随 input 双插）。

  const onCompositionStart = (): void => {
    composing = true;
    if (pendingReset != null) {
      defer.cancel(pendingReset); // 连续组合：上一轮的延迟 reset 取消，不打断新组合。
      pendingReset = null;
    }
  };

  const onCompositionEnd = (e: CompositionEvent): void => {
    composing = false;
    relayInsert(view, e.data || textarea.value); // 个别 IME compositionend 时 data 为空，退回 value。
    residue = textarea.value;
    pendingReset = defer.schedule(() => {
      pendingReset = null;
      if (!composing) {
        textarea.value = '';
        residue = '';
      }
    });
  };

  const onInput = (): void => {
    if (composing) return; // 组合期不落子、不清空，留给 compositionend 一次性插入。
    let text = textarea.value;
    if (pendingReset != null) {
      // reset 未到而新输入已至（如 Firefox 序：compositionend 后补一发 input）：剥掉已落子残文。
      defer.cancel(pendingReset);
      pendingReset = null;
      if (text.startsWith(residue)) text = text.slice(residue.length);
      residue = '';
    }
    relayInsert(view, text);
    textarea.value = '';
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing || e.keyCode === 229) return; // IME 键绝不拦。
    if (runScopeHandlers(view, e, 'editor')) e.preventDefault(); // 方向/退格/回车/undo 全桥 keymap。
  };

  textarea.addEventListener('compositionstart', onCompositionStart);
  textarea.addEventListener('compositionend', onCompositionEnd);
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('keydown', onKeyDown);
  return () => {
    textarea.removeEventListener('compositionstart', onCompositionStart);
    textarea.removeEventListener('compositionend', onCompositionEnd);
    textarea.removeEventListener('input', onInput);
    textarea.removeEventListener('keydown', onKeyDown);
    if (pendingReset != null) defer.cancel(pendingReset);
  };
}
