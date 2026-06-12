import { EditorSelection, StateEffect, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { createRelayTextarea, installRelayInput, rafDefer, type RelayDefer } from './textareaRelayM';

/**
 * M 区装配：CM6 只读渲染层（editable=false → contentDOM contenteditable=false 天然不可聚焦）+
 * 隐藏 textarea 作唯一焦点/输入面（中继核心见 textareaRelayM.ts）。
 *
 * 对 K 失败根因的本模块对策：
 *   1) installRelayZoneM 返回 input=textarea，ProbeZone 据此把 register/转焦/事件日志全部对准输入面；
 *   2) [data-relay-m-doc] 独立落子读数——「IME 未武装（无 composition）」vs「武装但中继断链（有
 *      composition 无落子）」可二分；
 *   3) 鼠标导流：view.dom mousedown 捕获 → preventDefault + posAtCoords 置光标 + textarea.focus()
 *      （真实手势内程序化转焦——探针 A 已证此组合可武装 IME）；
 *   4) caret 跟随：selectionSet 后 rAF 内 coordsAtPos 定位 textarea → 候选窗锚插入点。
 */

/** M 区接线产物：input 为探针对准的输入面（修 K 根因 1/2），teardown 在 view.destroy 前调。 */
export interface ZoneWiring {
  input: HTMLElement;
  teardown: () => void;
}

/** M 区 CM 扩展：只读渲染层 + 自绘光标 + keymap 桥所需键位 + 中继焦点态点亮光标。 */
export function relayZoneMExtensions(): Extension {
  return [
    EditorView.editable.of(false),
    drawSelection(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    // drawSelection 的 cursorLayer 仅 .cm-focused 显示（view dist L6618/6640）；中继架构下焦点在
    // textarea，故由 focus/blur 切 .cm-relay-focused 类，用同款规则点亮光标。
    EditorView.theme({
      '&.cm-relay-focused > .cm-scroller > .cm-cursorLayer .cm-cursor': { display: 'block' },
      '&.cm-relay-focused > .cm-scroller > .cm-cursorLayer': {
        animation: 'steps(1) cm-blink 1.2s infinite',
      },
    }),
  ];
}

/** M 区整装接线：隐藏 textarea + 落子读数 + caret 跟随 + 鼠标导流 + 焦点态 + 事件中继。 */
export function installRelayZoneM(
  view: EditorView,
  host: HTMLElement,
  defer: RelayDefer = rafDefer,
): ZoneWiring {
  const textarea = createRelayTextarea(view);
  const docOut = document.createElement('div');
  docOut.setAttribute('data-relay-m-doc', '');
  docOut.style.cssText = 'font:11px monospace;padding:2px 0;word-break:break-all;';
  const renderDoc = (): void => {
    docOut.textContent = `doc=${JSON.stringify(view.state.doc.toString())}`;
  };
  renderDoc();

  const prevPosition = host.style.position;
  host.style.position = 'relative';
  host.appendChild(textarea);
  host.appendChild(docOut);

  let disposed = false;
  const syncCaret = (): void => {
    if (disposed) return;
    const rect = view.coordsAtPos(view.state.selection.main.head);
    if (!rect) return;
    const base = host.getBoundingClientRect();
    textarea.style.left = `${rect.left - base.left}px`;
    textarea.style.top = `${rect.top - base.top}px`;
  };

  // 动态挂 updateListener：docChanged 刷新落子读数、selectionSet 后 rAF 定位 caret（全来源覆盖）。
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((u) => {
        if (u.docChanged) renderDoc();
        if (u.selectionSet || u.geometryChanged) requestAnimationFrame(syncCaret);
      }),
    ),
  });

  const onMouseDown = (e: MouseEvent): void => {
    e.preventDefault(); // 焦点不许跑、原生选区不许落进只读 DOM。
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos != null) view.dispatch({ selection: EditorSelection.cursor(pos) });
    textarea.focus();
  };
  view.dom.addEventListener('mousedown', onMouseDown, true);

  const onFocus = (): void => view.dom.classList.add('cm-relay-focused');
  const onBlur = (): void => view.dom.classList.remove('cm-relay-focused');
  textarea.addEventListener('focus', onFocus);
  textarea.addEventListener('blur', onBlur);

  const detachRelay = installRelayInput(view, textarea, defer);

  return {
    input: textarea,
    teardown: () => {
      disposed = true;
      detachRelay();
      view.dom.removeEventListener('mousedown', onMouseDown, true);
      textarea.removeEventListener('focus', onFocus);
      textarea.removeEventListener('blur', onBlur);
      textarea.remove();
      docOut.remove();
      host.style.position = prevPosition;
    },
  };
}
