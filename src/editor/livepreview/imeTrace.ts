/**
 * DEV-ONLY IME 诊断追踪器（EDIT-06 真机定位工具）。
 *
 * 背景：中文 IME × Live Preview 的吞字 bug 只在真实 WebView2 + 微软/搜狗拼音下复现，jsdom
 * 自动桩无法触发真实 composition 状态机（见 specs/03 §5）。本追踪器在 DEV 构建（`import.meta.env.DEV`）
 * 下把组合期的关键事件与装饰路径打到 devtools Console，使下一次真机测试产出「ground truth」，
 * 不必再靠肉眼猜测哪条路径泄漏。
 *
 * 纪律：
 *   - 生产构建（`import.meta.env.DEV` 为 false）一律 no-op，零运行时成本（Vite 会把 `if (DEV)` 死分支
 *     摇树消除——DEV 是编译期常量）。
 *   - 输出全部带 `[IME-TRACE]` 前缀，便于 Console 过滤与一键移除（grep 即可定位所有调用点）。
 *   - 仅在「组合活跃期」（compositionstart→compositionend，本模块自持标志）记录每事务的诊断，
 *     避免污染非组合期的 Console。组合外的高危调用（setState/reload during composition）仍以
 *     warn 级别穿透——那正是要抓的「冒烟枪」。
 *
 * 移除方式：删本文件 + `rg '\[IME-TRACE\]|imeTrace' src` 清理调用点即可，无任何生产耦合。
 */

/** DEV 编译期常量（Vite define）：false 时下方所有函数体被摇树消除。 */
const DEV = import.meta.env.DEV;

/** 组合活跃标志（本追踪器自持，与 composingGuard 的 frozenFlags 独立，仅用于决定是否记录每事务诊断）。 */
let composing = false;

/** 进入组合活跃期（compositionstart 时由调用点置位）。 */
export function imeTraceComposingStart(): void {
  composing = true;
}

/** 退出组合活跃期（compositionend 时由调用点复位）。 */
export function imeTraceComposingEnd(): void {
  composing = false;
}

/** 当前是否处于组合活跃期（供调用点决定是否记录组合期专项诊断）。 */
export function imeTraceIsComposing(): boolean {
  return composing;
}

/**
 * 通用追踪：DEV 下 `console.log('[IME-TRACE]', tag, data?)`，生产 no-op。
 *
 * 组合事件（compositionstart/update/end）无条件记录；其余 tag 仅在组合活跃期记录（减噪）。
 */
export function imeTrace(tag: string, data?: unknown): void {
  if (!DEV) return;
  const alwaysLog =
    tag === 'compositionstart' || tag === 'compositionupdate' || tag === 'compositionend';
  if (!alwaysLog && !composing) return;
  if (data === undefined) {
    console.log('[IME-TRACE]', tag);
  } else {
    console.log('[IME-TRACE]', tag, data);
  }
}

/**
 * 冒烟枪追踪：组合期发生的 setState / reload / watcher 重载等撕 DOM 高危调用。
 *
 * DEV 下以 `console.warn` 穿透（即便记录器自身的 composing 标志未置位也打——调用点已据
 * `view.composing` 判定）；生产 no-op。这是 autosave/setState 组合期门若仍泄漏时的直接证据。
 */
export function imeTraceSmokingGun(what: string, data?: unknown): void {
  if (!DEV) return;
  if (data === undefined) {
    console.warn(`[IME-TRACE] ${what} during composition!`);
  } else {
    console.warn(`[IME-TRACE] ${what} during composition!`, data);
  }
}
