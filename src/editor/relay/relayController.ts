import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { installRelayClipboard } from './relayClipboard';
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
 * 拖拽选区（document mousemove/mouseup）、scroll 跟随 caret、focus/blur ↔ .cm-relay-focused、
 * 事件中继安装、WeakMap 注册。
 */

/** 装饰内原生可聚焦控件选择器（focus net 放行名单：未被 widget 消费时不抢浏览器默认聚焦）。 */
const NATIVE_FOCUSABLE = 'input,textarea,select,button,[contenteditable="true"]';
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
   *
   * widget 原生交互不被吃掉（Wave 1 遗留 ② 收口）：target 段 widget 监听器先于本冒泡段执行，
   * preventDefault 不取消已执行的处理（复选框翻转照常）；唯「未被 widget 消费（!defaultPrevented）
   * 的原生可聚焦控件」（未来表格就地编辑输入框等）放行浏览器默认聚焦，不抢焦点。
   */
  const onMouseDownNet = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if (document.activeElement === textarea) return;
    const target = e.target instanceof Element ? e.target : null;
    const focusable = target?.closest(NATIVE_FOCUSABLE);
    if (!e.defaultPrevented && focusable && focusable !== textarea) return;
    e.preventDefault();
    textarea.focus();
  };
  view.scrollDOM.addEventListener('mousedown', onMouseDownNet);

  /**
   * 拖拽选区（PROD-RELAY-DESIGN §2.3）：editable=false 后 CM 内建 MouseSelection 不再工作
   * （依赖 contentDOM 可聚焦 + 原生选区），自研最小实现——relayGesture 单击置 anchor 后调
   * beginDrag，document 段 mousemove 经 defer（真机 rAF）节流 posAtCoords → dispatch
   * range(anchor, head)，head 带 scrollIntoView（边缘自动滚动最小实现）；mouseup 卸载并回焦。
   * 范围收敛：单 range + 字符粒度（词粒度拖拽为后续可选项），不复刻 Alt 矩形/bidi 长尾。
   */
  let dragAnchor = 0;
  let dragging = false;
  let dragFrame: number | null = null;
  let dragCoords: { x: number; y: number } | null = null;

  const dragFlush = (): void => {
    dragFrame = null;
    if (disposed || !dragCoords) return;
    const head = view.posAtCoords(dragCoords);
    if (head == null) return;
    const cur = view.state.selection.main;
    if (cur.anchor === dragAnchor && cur.head === head) return; // 同帧同位不重复 dispatch。
    view.dispatch({
      selection: EditorSelection.range(dragAnchor, head),
      scrollIntoView: true,
      userEvent: 'select.pointer',
    });
  };

  const onDragMove = (e: MouseEvent): void => {
    dragCoords = { x: e.clientX, y: e.clientY };
    if (dragFrame == null) dragFrame = defer.schedule(dragFlush);
  };

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);
    if (dragFrame != null) {
      defer.cancel(dragFrame);
      dragFrame = null;
    }
    dragCoords = null;
  };

  const onDragUp = (): void => {
    dragFlush(); // 收尾帧：mouseup 前最后一段位移即最终选区。
    endDrag();
    textarea.focus(); // 拖拽结束焦点必回输入面（候选窗/键入即续）。
  };

  const beginDrag = (anchor: number): void => {
    endDrag(); // 防御：异常路径（窗口失焦丢 mouseup）残留的上一轮拖拽先卸干净。
    dragAnchor = anchor;
    dragging = true;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  };

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

  const input = installRelayInput(view, textarea, defer);
  // 剪贴板（§2.8）：copy/cut/paste 从 CM doc 选区取/写（textarea 恒空），Ctrl+C/X/V 原生派发至此。
  const detachClipboard = installRelayClipboard(view, textarea);
  registerRelayWiring(view, {
    textarea,
    syncCaret,
    beginDrag,
    commitComposition: input.commitComposition,
  });

  return () => {
    disposed = true;
    endDrag();
    unregisterRelayWiring(view);
    detachClipboard();
    input.detach();
    view.scrollDOM.removeEventListener('mousedown', onMouseDownNet);
    view.scrollDOM.removeEventListener('scroll', onScroll);
    view.contentDOM.removeEventListener('focus', onContentFocus);
    textarea.removeEventListener('focus', onFocus);
    textarea.removeEventListener('blur', onBlur);
    textarea.remove();
    host.style.position = prevPosition;
  };
}
