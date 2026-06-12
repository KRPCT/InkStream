import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { RELAY_ENABLED } from './index';
import { getRelayWiring } from './relayFocus';

/**
 * 状态级中继扩展（进 baseExtensions()，随每个 EditorState 重建——铁律 0：updateListener/
 * domEventHandlers 是 state 级 facet，只挂初始 state 会在第一次 openFile 换装后失联）。
 *
 * 组成（PROD-RELAY-DESIGN §1.1）：
 *   - editable.of(false)：contentDOM contenteditable=false、无 tabindex，天然不可聚焦——
 *     纯渲染 + 装饰 + 鼠标命中面；
 *   - relayGesture：单击置光标 + 焦点导流（textarea 为唯一焦点/输入面）；
 *   - relayTheme：.cm-relay-focused 点亮 drawSelection 光标层与聚焦选区色；
 *   - relayCaretListener：选区/几何变化 → rAF syncCaret（textarea 跟随插入点锚候选窗）。
 */

/**
 * 鼠标导流手势（mousedown）。在 baseExtensions 中注册于 renderModeCompartment 之后 =
 * linkGesture/tableGesture 先裁决（CM6 按注册序短路 domEventHandlers）：
 *   - 链接导航/表格穿透返回 true → 本手势不执行（光标语义与旧架构一致）；
 *   - 复选框 widget 自收 mousedown 并 preventDefault → defaultPrevented 守卫跳过（不动光标，
 *     镜像 CM 内建纪律）；
 *   - 其余左键单击：preventDefault（焦点不许跑、原生选区不许落进只读 DOM）+ posAtCoords
 *     置光标 + textarea.focus()——真实手势内程序化转焦，真机已证可武装 IME。
 * 拖拽/Shift 点击/双击词/三击行为 Wave 2。
 */
const relayGesture = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.defaultPrevented || e.button !== 0) return false;
    const wiring = getRelayWiring(view);
    if (!wiring) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false; // 控制器 focus net（冒泡段）兜底回焦。
    e.preventDefault();
    view.dispatch({ selection: EditorSelection.cursor(pos), userEvent: 'select.pointer' });
    wiring.textarea.focus();
    return true;
  },
});

/**
 * drawSelection 的光标/选区仅 .cm-focused 显示（view dist cursorLayer 规则）；中继架构下
 * 焦点在 textarea，由控制器经 focus/blur 切 .cm-relay-focused 类，用同款规则点亮：
 * 光标 display+blink（M 区已验证）+ 聚焦选区色（M 区缺这条会呈失焦灰），色走主题变量。
 */
const relayTheme = EditorView.theme({
  '&.cm-relay-focused > .cm-scroller > .cm-cursorLayer .cm-cursor': { display: 'block' },
  '&.cm-relay-focused > .cm-scroller > .cm-cursorLayer': {
    animation: 'steps(1) cm-blink 1.2s infinite',
  },
  '&.cm-relay-focused .cm-selectionBackground': {
    background: 'var(--text-selection)',
  },
});

/** caret 跟随：选区/几何变化后 rAF 内同步 textarea 位置（state 级，换装后天然存活）。 */
const relayCaretListener = EditorView.updateListener.of((u) => {
  if (!u.selectionSet && !u.geometryChanged) return;
  const wiring = getRelayWiring(u.view);
  if (wiring) requestAnimationFrame(wiring.syncCaret);
});

/** 状态级四件套；flag 关返回空（完整旧路径：editable 默认 true、contentDOM 直输）。 */
export function relayExtensions(): Extension[] {
  if (!RELAY_ENABLED) return [];
  return [EditorView.editable.of(false), relayTheme, relayGesture, relayCaretListener];
}
