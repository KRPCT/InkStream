import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * IME 组合输入测试桩（EDIT-06，Option 1 / RESEARCH「Validation Architecture」）。
 *
 * 背景：Option 1 删除了自建 composition 冻结闸门，改信赖 CM6 6.43.1 内置合成保护；装饰层照常规范重建。
 * jsdom 不会真正驱动浏览器的 IME 组合状态（无 inputState.composing / MutationObserver），故真实吞字
 * 类回归在 jsdom 复现不了——本桩只用于锁「组合期 docChange 照常重建」契约与 useCodeMirror 的
 * `!view.composing` 副作用门。EDIT-06 的真验收是手动 Windows+WebView2 拼音测试（咕咕咕 + 长句）。
 *   1. dispatchComposition：经 contentDOM 派发真实 CompositionEvent；
 *   2. mockComposing：直接覆写 view.composing getter，供「composing 期副作用/重建」断言。
 *
 * 真实 EditorView 在 afterEach 必须 destroyTestView（承 Pitfall 5 StrictMode 泄漏纪律）。
 */

/** IME 组合事件的三个阶段。 */
export type CompositionPhase = 'compositionstart' | 'compositionupdate' | 'compositionend';

/**
 * 经 view.contentDOM 派发一个真实 CompositionEvent，驱动注册其上的 domEventHandlers。
 *
 * jsdom 原生支持 CompositionEvent 构造器与 `data` 字段，无需自建 polyfill。
 */
export function dispatchComposition(
  view: EditorView,
  opts: { phase: CompositionPhase; data?: string },
): void {
  const event = new CompositionEvent(opts.phase, {
    data: opts.data ?? '',
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
}

/**
 * 包裹一次完整组合序列：compositionstart → fn（组合期操作）→ compositionend。
 *
 * 用于「组合期内执行某操作、断言装饰未重算，结束后恢复」的回归测试骨架。
 */
export function withComposition(
  view: EditorView,
  fn: () => void,
  data = '',
): void {
  dispatchComposition(view, { phase: 'compositionstart', data });
  fn();
  dispatchComposition(view, { phase: 'compositionend', data });
}

/**
 * 强制覆写 view.composing 的返回值（jsdom 不会自动置 true）。
 *
 * `composing` 是 EditorView 上的只读 getter，故用 Object.defineProperty 在实例层遮蔽，
 * 供「`if (update.view.composing) return` 短路」类断言驱动。
 */
export function mockComposing(view: EditorView, value: boolean): void {
  Object.defineProperty(view, 'composing', {
    configurable: true,
    get: () => value,
  });
}

/**
 * 测试用 EditorView 工厂：EditorState.create + new EditorView 一步到位。
 *
 * 与 destroyTestView 严格配对（afterEach 调用）——单内核纪律下任何遗漏的 view
 * 都会在 StrictMode 双跑场景泄漏（Pitfall 5）。
 */
export function makeTestView(doc = '', extensions: Extension = []): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions }),
  });
}

/** 销毁测试 view（afterEach 调用，与 makeTestView 配对）。 */
export function destroyTestView(view: EditorView | null | undefined): void {
  view?.destroy();
}
