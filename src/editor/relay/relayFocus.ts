import type { EditorView } from '@codemirror/view';
import { getView } from '../viewHandle';
import { RELAY_ENABLED } from './index';

/**
 * 中继接线注册表 + 全项目唯一编辑器焦点出口（PROD-RELAY-DESIGN §2.2）。
 *
 * relayState（状态级扩展，随每个 EditorState 重建）与 relayController（视图级接线，
 * 随 useCodeMirror 生命周期一次安装）经本 WeakMap 关联（composition.ts frozenFlags
 * 同模式）：状态级代码经 getRelayWiring(view) 取本 view 的 textarea/syncCaret，
 * openFile/switchToTab 换装后天然存活（铁律 0）。
 */

export interface RelayWiring {
  /** 编辑器唯一焦点/输入面（Monaco 式隐藏 textarea）。 */
  textarea: HTMLTextAreaElement;
  /** textarea 跟随插入点（候选窗锚定）；rAF 体内调用，无布局时静默。 */
  syncCaret: () => void;
  /** 开始拖拽选区（relayGesture 单击置 anchor 后调用；控制器挂 document mousemove/mouseup）。 */
  beginDrag: (anchor: number) => void;
  /** 提交进行中的 IME 组合（组合中途点击的 blur-commit 策略入口）；非组合期为 no-op。 */
  commitComposition: () => void;
}

const wirings = new WeakMap<EditorView, RelayWiring>();

export function registerRelayWiring(view: EditorView, wiring: RelayWiring): void {
  wirings.set(view, wiring);
}

export function unregisterRelayWiring(view: EditorView): void {
  wirings.delete(view);
}

export function getRelayWiring(view: EditorView): RelayWiring | undefined {
  return wirings.get(view);
}

/** 取中继输入面（测试断言 / CDP 诊断用）；未接线返回 null。 */
export function getRelayInput(view: EditorView): HTMLTextAreaElement | null {
  return wirings.get(view)?.textarea ?? null;
}

/**
 * 全项目唯一编辑器焦点导流口（替代所有 view.focus() 调用点）。
 *
 * 中继在册 → 聚焦 textarea：程序化 textarea.focus() 即武装 IME（探针 A 铁证）——这是对旧
 * 架构的升级，命令面板/菜单驱动的回焦此后也能直接打中文。flag 关 / 未接线 → 回退
 * view.focus()（旧 contentDOM 路径）。不传 view 时取单内核句柄；无 view 静默 no-op。
 */
export function focusEditor(view?: EditorView | null): void {
  const v = view ?? getView();
  if (!v) return;
  const wiring = RELAY_ENABLED ? wirings.get(v) : undefined;
  if (wiring) wiring.textarea.focus();
  else v.focus();
}

/**
 * 换装通知（editorState swapState 尾部一行）：setState 不触 updateListener，
 * caret 跟随由此显式补一帧。flag 关 / 未接线为 no-op。
 */
export function relayNotifySwap(view: EditorView): void {
  const wiring = wirings.get(view);
  if (wiring) requestAnimationFrame(wiring.syncCaret);
}
