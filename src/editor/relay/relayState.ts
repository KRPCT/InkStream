import { searchPanelOpen } from '@codemirror/search';
import { type Extension } from '@codemirror/state';
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
 * 点击 → 选区映射（纯函数，配对单测穷举）：
 *   - 三击（detail>=3）：整行，含行尾换行符（CM 内建三击语义；行末为 doc 末尾时不含）；
 *   - 双击（detail===2）：wordAt 语言感知词边界（charCategorizer），无词（空白/标点）退化为置光标；
 *   - Shift+点击：anchor 保持当前选区 anchor，head=点击 pos（扩展选区）；
 *   - 单击：cursor(pos)。
 */
export function clickSelection(
  view: EditorView,
  pos: number,
  e: MouseEvent,
): { anchor: number; head?: number } {
  if (e.detail >= 3) {
    const line = view.state.doc.lineAt(pos);
    const to = line.to < view.state.doc.length ? line.to + 1 : line.to;
    return { anchor: line.from, head: to };
  }
  if (e.detail === 2) {
    const word = view.state.wordAt(pos);
    return word ? { anchor: word.from, head: word.to } : { anchor: pos };
  }
  if (e.shiftKey) return { anchor: view.state.selection.main.anchor, head: pos };
  return { anchor: pos };
}

/**
 * 鼠标导流手势（mousedown）。在 baseExtensions 中注册于 renderModeCompartment 之后 =
 * linkGesture/tableGesture 先裁决（CM6 按注册序短路 domEventHandlers）：
 *   - 链接导航/表格穿透返回 true → 本手势不执行（光标语义与旧架构一致）；
 *   - 复选框 widget 自收 mousedown 并 preventDefault → defaultPrevented 守卫跳过（不动光标，
 *     镜像 CM 内建纪律）；
 *   - 组合中途点击：先 commitComposition（blur-commit，按旧选区落子）再处理点击——否则
 *     compositionend 一次性落子会插进点击后的新选区（§2.5 风险对策）；
 *   - 其余左键：preventDefault（焦点不许跑、原生选区不许落进只读 DOM）+ clickSelection
 *     置选区（单击/Shift/双击词/三击行）+ 单击与 Shift 点击启动拖拽（beginDrag 挂 document
 *     mousemove/mouseup）+ textarea.focus()——真实手势内程序化转焦，真机已证可武装 IME。
 */
const relayGesture = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.defaultPrevented || e.button !== 0) return false;
    const wiring = getRelayWiring(view);
    if (!wiring) return false;
    wiring.commitComposition(); // 非组合期 no-op；组合期先提交再算 pos（落子可能改变布局）。
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false; // 控制器 focus net（冒泡段）兜底回焦。
    e.preventDefault();
    const sel = clickSelection(view, pos, e);
    view.dispatch({ selection: sel, userEvent: 'select.pointer' });
    // 字符粒度拖拽仅随单击/Shift 点击（anchor=已置选区的 anchor）；双击/三击不拖（词粒度拖为后续可选）。
    if (e.detail < 2) wiring.beginDrag(sel.anchor);
    wiring.textarea.focus();
    return true;
  },
});

/**
 * search 面板关闭回焦（§2.2 风险项）：@codemirror/search 关面板后内部 view.focus() 在
 * editable=false 下是 no-op（contentDOM 无 tabindex 不可聚焦），焦点落 body。监听面板
 * 开→关事务补焦输入面；微任务推迟保证排在 search 内部 focus 之后。仅当焦点仍在编辑器内
 * （面板输入框/按钮，关闭瞬间 DOM 移除则为 body）时回焦——面板被程序化关闭而用户在
 * 文件树等处时不抢焦点。
 */
const relaySearchRefocus = EditorView.updateListener.of((u) => {
  if (!searchPanelOpen(u.startState) || searchPanelOpen(u.state)) return;
  const wiring = getRelayWiring(u.view);
  if (!wiring) return;
  const active = document.activeElement;
  if (!active || active === document.body || u.view.dom.contains(active)) {
    queueMicrotask(() => wiring.textarea.focus());
  }
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

/** 状态级五件套；flag 关返回空（完整旧路径：editable 默认 true、contentDOM 直输）。 */
export function relayExtensions(): Extension[] {
  if (!RELAY_ENABLED) return [];
  return [
    EditorView.editable.of(false),
    relayTheme,
    relayGesture,
    relayCaretListener,
    relaySearchRefocus,
  ];
}
