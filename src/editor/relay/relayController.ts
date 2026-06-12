import type { EditorView } from '@codemirror/view';
import { registerRelayWiring, unregisterRelayWiring } from './relayFocus';
import {
  createRelayTextarea,
  installRelayInput,
  rafDefer,
  type RelayDefer,
} from './textareaRelay';

/**
 * 视图级中继接线（PROD-RELAY-DESIGN §1.1）：useCodeMirror effect 内安装、cleanup 内销毁
 * （StrictMode 双跑严格配对，同 view.destroy 纪律）。单内核单 textarea，换装不重建。
 *
 * 职责：textarea 挂载（host = cm-mount div，position:relative）、focus net 兜底回焦、
 * scroll 跟随 caret、focus/blur ↔ .cm-relay-focused、事件中继安装、WeakMap 注册。
 */
export function installRelayController(
  view: EditorView,
  host: HTMLElement,
  defer: RelayDefer = rafDefer,
): () => void {
  const textarea = createRelayTextarea(view);
  const prevPosition = host.style.position;
  host.style.position = 'relative';
  host.appendChild(textarea);

  let disposed = false;
  /** textarea 跟随插入点（候选窗锚定）；jsdom/无布局时 coordsAtPos 为 null 静默跳过。 */
  const syncCaret = (): void => {
    if (disposed) return;
    const rect = view.coordsAtPos(view.state.selection.main.head);
    if (!rect) return;
    const base = host.getBoundingClientRect();
    textarea.style.left = `${rect.left - base.left}px`;
    textarea.style.top = `${rect.top - base.top}px`;
  };

  /**
   * focus net（兜底回焦）：挂 scrollDOM 冒泡段而非 view.dom——search 面板（.cm-panels）也在
   * view.dom 内，挂 view.dom 会抢走面板输入框的焦点；scrollDOM 恰好只覆盖内容命中面。
   * 无论哪个手势消费了 mousedown（linkGesture/tableGesture 返回 true、复选框 preventDefault），
   * 事件仍冒泡至此：焦点不在输入面则 preventDefault（阻止浏览器默认焦点转移）并收回。
   * 保证「点编辑器内容区任何地方，焦点必落输入面」。
   */
  const onMouseDownNet = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if (document.activeElement !== textarea) {
      e.preventDefault();
      textarea.focus();
    }
  };
  view.scrollDOM.addEventListener('mousedown', onMouseDownNet);

  const onScroll = (): void => {
    requestAnimationFrame(syncCaret);
  };
  view.scrollDOM.addEventListener('scroll', onScroll);

  const onFocus = (): void => view.dom.classList.add('cm-relay-focused');
  const onBlur = (): void => view.dom.classList.remove('cm-relay-focused');
  textarea.addEventListener('focus', onFocus);
  textarea.addEventListener('blur', onBlur);

  /** DEV 焦点泄漏探测器：editable=false 下 contentDOM 不应再收到 focus（残留 view.focus 即告警）。 */
  const onContentFocus = (): void => {
    if (import.meta.env.DEV) {
      console.warn('[relay] contentDOM 收到 focus——焦点泄漏，应经 focusEditor 落 textarea');
    }
  };
  view.contentDOM.addEventListener('focus', onContentFocus);

  const detachInput = installRelayInput(view, textarea, defer);
  registerRelayWiring(view, { textarea, syncCaret });

  return () => {
    disposed = true;
    unregisterRelayWiring(view);
    detachInput();
    view.scrollDOM.removeEventListener('mousedown', onMouseDownNet);
    view.scrollDOM.removeEventListener('scroll', onScroll);
    view.contentDOM.removeEventListener('focus', onContentFocus);
    textarea.removeEventListener('focus', onFocus);
    textarea.removeEventListener('blur', onBlur);
    textarea.remove();
    host.style.position = prevPosition;
  };
}
