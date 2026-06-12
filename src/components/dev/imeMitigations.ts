import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * 三个候选解法的可测逻辑核心（R3 候选解法验证台 I/J/K）。
 *
 * 二分定位铁证：CM6 区「焦点落定后首次组合被吞、重试恢复」。机理假说=CM6 聚焦/点击时程序化改写 DOM
 * selection（docView.updateSelection / mousedown 后 dispatch+写 selection），打断 WebView2 TSF 首次组合
 * 初始化；首次失败后 TSF 自行重建，故重试成功。本模块把三种「迫使 TSF 在 CM6 改写之后重绑」的尝试做成
 * 可在 jsdom 断言的纯接线函数（ProbeZone 只负责把它挂到 throwaway view，卸载即调返回的 cleanup）。
 *
 * 调度注入：focus-cycle / ce-flip 的「微任务后执行一次」经 schedule 参数注入——真机用 queueMicrotask，
 * 测试传同步执行器即可断言「blur+focus 各一次、不递归」。
 */

/** 微任务调度器（真机 queueMicrotask；测试可传同步执行器锁定调用次数）。 */
export type Scheduler = (task: () => void) => void;

const microtask: Scheduler = (task) => queueMicrotask(task);

/**
 * I 区【焦点循环缓解】：contentDOM 每获得焦点，微任务内做一次「牺牲性 blur→focus」。
 *
 * 原理：让 TSF 在 CM6 的 selection 改写**之后**重建文本存储绑定，把真实首次组合放进「重试成功」态。
 * 每焦点会话只循环一次——cycling 标志在我们自己触发的 blur/focus 期间为 true，吞掉它们再触发的 focus
 * 事件（防递归）；自然失焦（blur 到别处，非循环中）清 armed，下次获得焦点重新武装。
 *
 * 返回 cleanup：摘 focus 监听（throwaway view 卸载时调）。
 */
export function installFocusCycle(view: EditorView, schedule: Scheduler = microtask): () => void {
  const dom = view.contentDOM;
  let armed = true; // 本焦点会话是否仍可循环（获得焦点即武装，循环一次即解除）。
  let cycling = false; // 正在执行我们自己的 blur/focus，吞掉其再触发的 focus（防递归）。

  const onFocus = () => {
    if (cycling) return; // 循环自身触发的 focus，忽略。
    if (!armed) return; // 本会话已循环过，不再重复。
    armed = false;
    schedule(() => {
      cycling = true;
      dom.blur();
      dom.focus();
      cycling = false;
    });
  };

  const onBlur = () => {
    if (cycling) return; // 循环中的 blur 不重置武装。
    armed = true; // 真实失焦：下次获得焦点重新武装。
  };

  dom.addEventListener('focus', onFocus);
  dom.addEventListener('blur', onBlur);
  return () => {
    dom.removeEventListener('focus', onFocus);
    dom.removeEventListener('blur', onBlur);
  };
}

/**
 * J 区【contenteditable 翻转缓解】：contentDOM 每获得焦点，微任务内把 contentEditable 'true'→'false'→'true'。
 *
 * 原理同 I——另一种迫使 TSF 重绑文本存储的途径。翻转为 'false' 会让 contentDOM 失去焦点（不可编辑元素
 * 不持文本输入焦点），故置回 'true' 后补一次 focus() 还原焦点。实际序列（每焦点会话一次）：
 *   focus 触发 → 微任务 → contentEditable='false'（此刻 DOM 自动 blur）→ contentEditable='true' → focus()。
 *
 * flipping 标志吞掉「置回 focus()」再触发的 focus 事件（防递归）；自然失焦清 armed 重新武装。
 *
 * 返回 cleanup：摘 focus 监听。
 */
export function installContentEditableFlip(
  view: EditorView,
  schedule: Scheduler = microtask,
): () => void {
  const dom = view.contentDOM;
  let armed = true;
  let flipping = false;

  const onFocus = () => {
    if (flipping) return;
    if (!armed) return;
    armed = false;
    schedule(() => {
      flipping = true;
      dom.contentEditable = 'false';
      dom.contentEditable = 'true';
      dom.focus(); // 翻转丢焦点，补回（CM6 默认 contentDOM 可聚焦）。
      flipping = false;
    });
  };

  const onBlur = () => {
    if (flipping) return;
    armed = true;
  };

  dom.addEventListener('focus', onFocus);
  dom.addEventListener('blur', onBlur);
  return () => {
    dom.removeEventListener('focus', onFocus);
    dom.removeEventListener('blur', onBlur);
  };
}

/**
 * 把一段文本插入到 view 当前选区头部（替换选区），并把光标移到插入文本之后。
 * K 区中继的统一落子原语：非组合 input 与 compositionend 都经此把字符落进 CM 文档（doc.toString 真相源）。
 */
function insertAtSelection(view: EditorView, text: string): void {
  if (!text) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    scrollIntoView: true,
  });
}

/** 删除 CM 光标前一字符（K 区 Backspace 在 textarea 为空时桥到 CM）。 */
function deleteBackwardInCm(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  if (from !== to) {
    // 有选区：删选区。
    view.dispatch({
      changes: { from, to, insert: '' },
      selection: EditorSelection.cursor(from),
    });
    return;
  }
  if (from === 0) return; // 文档头，无前一字符。
  view.dispatch({
    changes: { from: from - 1, to: from, insert: '' },
    selection: EditorSelection.cursor(from - 1),
  });
}

/** 在 CM 光标左/右移一位（K 区方向键 MVP，clamp 到文档边界）。 */
function moveCursorInCm(view: EditorView, delta: -1 | 1): void {
  const pos = view.state.selection.main.head;
  const next = Math.max(0, Math.min(view.state.doc.length, pos + delta));
  view.dispatch({ selection: EditorSelection.cursor(next), scrollIntoView: true });
}

/**
 * K 区【textarea 中继 MVP】：把覆盖在只读 CM 上的透明 textarea 的输入中继进 CM 文档。
 *
 * - 非组合期 input：textarea.value 插入 CM 选区头 → 清空 textarea；
 * - 组合期（compositionstart→end）：input 不动 CM（避免逐拼音落子）；compositionend 取最终文本一次性
 *   插入 → 清空 textarea；
 * - keydown：Backspace 且 textarea 空 → 删 CM 前一字符；Enter（非组合，isComposing||keyCode 229 防御）
 *   → 插换行；ArrowLeft/Right → 移 CM 光标。
 *
 * 目的只为证明「IME 经 textarea 中继落入 CM 文档」可行（MVP，不接 undo/keymap 全桥）。
 * 返回 cleanup：摘 textarea 监听（throwaway view 卸载时调）。
 */
export function installTextareaRelay(view: EditorView, textarea: HTMLTextAreaElement): () => void {
  let composing = false;

  const onCompositionStart = () => {
    composing = true;
  };

  const onCompositionEnd = (e: CompositionEvent) => {
    composing = false;
    // 优先 event.data，退回 textarea.value（个别 IME compositionend 时 data 为空）。
    const text = e.data || textarea.value;
    insertAtSelection(view, text);
    textarea.value = '';
  };

  const onInput = () => {
    if (composing) return; // 组合期不落子，留给 compositionend 一次性插入。
    insertAtSelection(view, textarea.value);
    textarea.value = '';
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // 组合期键（IME 合成中）一律放行给 IME，不桥任何编辑键。
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Backspace' && textarea.value === '') {
      e.preventDefault();
      deleteBackwardInCm(view);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insertAtSelection(view, '\n');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveCursorInCm(view, -1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveCursorInCm(view, 1);
    }
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
  };
}
