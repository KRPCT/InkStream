import { EditorSelection } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { setRelayComposing } from '../composition';

/**
 * 生产输入中继核心：隐藏 textarea 构造 + 事件中继（提炼自 dev/textareaRelayM.ts，
 * M 区 MVP 真机 WebView2+Edg149 中文阳性；设计 PROD-RELAY-DESIGN §2.1/§2.4/§2.5）。
 *
 * 机制要点：
 *   - 隐藏 = Monaco 式 1px × 行高 + 透明前景 + z-index:-10（禁 opacity:0 整面覆盖）；
 *   - 非组合 input 即时落子并清空；组合期（compositionstart→end）不碰 CM6；
 *     compositionend 取 e.data（空则退回 value）一次性落子；
 *   - compositionend 落子后 reset 延迟到 defer，下一 compositionstart 已到则取消
 *     （避二次组合竞态）；组合期绝不清空 textarea（CM5 铁律）；
 *   - keydown 经 isComposing||229 放行 IME 键后桥给 CM6 keymap（runScopeHandlers 读
 *     state 内全部 keymap facet：default/history/search/indentWithTab/markdown/richtext
 *     键位含 Prec 排序全覆盖，零枚举）；
 *   - 组合态经 setRelayComposing 喂给统一冻结门：isComposing/queueAfterComposition
 *     全部消费方（swapState/autosave/externalChange/languages/renderMode）语义不变。
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
  ta.setAttribute('data-relay-input', '');
  ta.setAttribute('aria-label', '编辑器输入');
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

/**
 * 统一落子原语：替换当前选区插入文本，光标移到其后。
 *
 * userEvent 决定 CM6 history 撤销分组（§2.9）：默认 `input.type`（连续输入相邻事务自动归组）；
 * 粘贴传 `input.paste`（独立成组，不与相邻键入合并）。组合落子复用默认 `input.type`——
 * compositionend 已解冻，作为「组合结束的常规提交」整词一事务，装饰层正常重建（§2.5 裁决）。
 */
export function relayInsert(view: EditorView, text: string, userEvent = 'input.type'): void {
  if (!text) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    scrollIntoView: true,
    userEvent,
  });
}

/** installRelayInput 的接线句柄：cleanup + 组合提交入口（控制器注入 RelayWiring）。 */
export interface RelayInputHandle {
  detach: () => void;
  /** 提交进行中的组合（组合中途点击用，§2.5 风险对策）；非组合期 no-op。 */
  commitComposition: () => void;
}

/**
 * 事件中继：input/composition/keydown 三路，返回 detach（与控制器生命周期配对）+
 * commitComposition（组合中途点击的 blur-commit 入口）。
 *
 * compositionend 固定序（PROD-RELAY-DESIGN §2.5 裁决）：解冻（setRelayComposing false）→
 * relayInsert 落子（组合已结束的常规提交，装饰层正常重建）→ 微任务 drain 排空队列
 * （落子事务必先于排队的换装/autosave 执行）。
 */
export function installRelayInput(
  view: EditorView,
  textarea: HTMLTextAreaElement,
  defer: RelayDefer = rafDefer,
): RelayInputHandle {
  let composing = false;
  let pendingReset: number | null = null;
  let residue = ''; // compositionend 已落子但尚未 reset 的 textarea 残文（防尾随 input 双插）。

  const onCompositionStart = (): void => {
    composing = true;
    setRelayComposing(view, true); // 冻结门置位：组合期换装/autosave/reload 全部排队。
    if (pendingReset != null) {
      defer.cancel(pendingReset); // 连续组合：上一轮的延迟 reset 取消，不打断新组合。
      pendingReset = null;
    }
  };

  const onCompositionEnd = (e: CompositionEvent): void => {
    composing = false;
    setRelayComposing(view, false); // 解冻 + 微任务 drain（落子同步在前，drain 微任务在后）。
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

  /**
   * 组合中途点击的 blur-commit（PROD-RELAY-DESIGN §2.5 风险对策）：焦点不离 textarea 时浏览器
   * 不自动 commit，点击 dispatch 会移走插入点 → compositionend 一次性落子错位。先 blur 触发
   * 浏览器标准 compositionend（onCompositionEnd 按旧选区正常落子）；个别 IME / jsdom 不派发时
   * 走强制兜底：按当前 value 落子 + 解冻，状态与正常 end 完全一致。最后回焦保持输入面武装。
   */
  const commitComposition = (): void => {
    if (!composing) return;
    textarea.blur(); // 真机（Chromium/WebView2）：blur 同步触发 compositionend → 正常提交路径。
    if (composing) {
      composing = false;
      setRelayComposing(view, false);
      relayInsert(view, textarea.value); // 兜底强制落子（空值时 relayInsert 自身 no-op）。
      textarea.value = '';
      residue = '';
      if (pendingReset != null) {
        defer.cancel(pendingReset);
        pendingReset = null;
      }
    }
    textarea.focus();
  };

  textarea.addEventListener('compositionstart', onCompositionStart);
  textarea.addEventListener('compositionend', onCompositionEnd);
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('keydown', onKeyDown);
  const detach = (): void => {
    textarea.removeEventListener('compositionstart', onCompositionStart);
    textarea.removeEventListener('compositionend', onCompositionEnd);
    textarea.removeEventListener('input', onInput);
    textarea.removeEventListener('keydown', onKeyDown);
    if (pendingReset != null) defer.cancel(pendingReset);
    if (composing) setRelayComposing(view, false); // 卸载时绝不留死冻结（门永不失配）。
  };
  return { detach, commitComposition };
}
