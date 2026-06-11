/**
 * DEV-ONLY IME 诊断追踪器（EDIT-06 真机定位工具）。
 *
 * 背景：中文 IME × Live Preview 的吞字 bug 只在真实 WebView2 + 微软/搜狗拼音下复现，jsdom
 * 自动桩无法触发真实 composition 状态机（见 specs/03 §5）。本追踪器在 DEV 构建（`import.meta.env.DEV`）
 * 下把组合期的关键事件与装饰路径**同时**打到 devtools Console 与一个会话级临时文件
 * （`%TEMP%/inkstream-ime-trace.log`，Rust `ime_trace_append` 落盘），使下一次真机测试产出
 * 「ground truth」——WebView2 的 Console 偶发抓不到输出（缓冲 / 焦点切走 / 组合期重绘竞态），
 * 文件通道则可离线直读（`Get-Content -Wait`），不再靠肉眼猜哪条路径泄漏。
 *
 * 每条 trace 是**扁平单行**字符串（非嵌套对象），含毫秒时间戳、事件 tag、以及尽量丰富的字段——
 * 其中 `activeEl=`（document.activeElement 摘要为 `TAG#id.class`）是「焦点被偷」假设的关键证据：
 * 首次合成吞字 + 零编辑器 trace + 重试成功，强烈指向首次组合落到了一个游离的可聚焦 input
 * 而非编辑器的 contentEditable。故每条 trace 都带 activeEl。
 *
 * 纪律：
 *   - 生产构建（`import.meta.env.DEV` 为 false）一律 no-op，零运行时成本（Vite 把 `if (DEV)` 死分支
 *     摇树消除——DEV 是编译期常量）。
 *   - 输出全部带 `[IME-TRACE]` 前缀，便于 Console 过滤与一键移除（grep 即可定位所有调用点）。
 *   - 仅在「组合活跃期」（compositionstart→compositionend，本模块自持标志）记录每事务的诊断，
 *     避免污染非组合期的 Console。组合外的高危调用（setState/reload during composition）仍以
 *     warn 级别穿透——那正是要抓的「冒烟枪」。
 *   - 落盘 fire-and-forget：invoke 包 try/catch + `.catch()`，永不抛、永不阻塞输入；Rust 端
 *     失败只回 Err 由此处吞掉。
 *
 * 时间戳纪律：仓库禁用 `Date.now()`，统一用 `performance.now()`（单调毫秒，含小数）。
 *
 * 移除方式：删本文件 + `rg '\[IME-TRACE\]|imeTrace' src` 清理调用点 + 撤销 Rust `ime_trace_append`。
 */

import { invoke } from '../../ipc/invoke';

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

/** trace 字段表：扁平 key→标量（嵌套对象会被 String() 摊平，调用点应只传标量）。 */
export type ImeTraceFields = Record<string, string | number | boolean | null | undefined>;

/**
 * 当前 document.activeElement 摘要为 `TAG#id.class1.class2`（焦点被偷假设的核心证据）。
 *
 * 例：`DIV.cm-content` / `INPUT#path` / `BODY` / `(none)`（无 activeElement 或非浏览器环境）。
 * 无 id/class 只回 TAG；class 全量拼接（首次合成若落到游离 input 此处即为 `INPUT` 或带其 id）。
 */
function activeElSummary(): string {
  if (typeof document === 'undefined') return '(no-document)';
  const el = document.activeElement;
  if (!el) return '(none)';
  let s = el.tagName;
  if (el.id) s += `#${el.id}`;
  const cls = typeof el.className === 'string' ? el.className.trim() : '';
  if (cls) s += `.${cls.split(/\s+/).join('.')}`;
  return s;
}

/** 把扁平字段表格式化为 ` key=value` 串联（undefined 字段跳过；字符串值含空格则加引号）。 */
function formatFields(fields: ImeTraceFields): string {
  let out = '';
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const raw = v === null ? 'null' : String(v);
    const val = /\s/.test(raw) ? `"${raw}"` : raw;
    out += ` ${k}=${val}`;
  }
  return out;
}

/** 落盘单行 trace（fire-and-forget）：invoke 失败一律吞，绝不抛、绝不阻塞输入。 */
function appendToFile(line: string): void {
  try {
    void invoke('ime_trace_append', { line }).catch(() => {
      /* 诊断通道失败静默：绝不影响输入 */
    });
  } catch {
    /* invoke 同步抛（非 Tauri 环境等）亦吞 */
  }
}

/**
 * 通用追踪：DEV 下构造扁平单行 `[IME-TRACE] <ts> <tag> activeEl=... <fields>`，
 * 同时 `console.log` 与落盘；生产 no-op。
 *
 * 每条都注入 `activeEl=`（document.activeElement 摘要，焦点被偷假设核心证据）。
 * 组合事件（compositionstart/update/end）无条件记录；其余 tag 仅在组合活跃期记录（减噪）。
 */
export function imeTrace(tag: string, fields: ImeTraceFields = {}): void {
  if (!DEV) return;
  const alwaysLog =
    tag === 'compositionstart' || tag === 'compositionupdate' || tag === 'compositionend';
  if (!alwaysLog && !composing) return;
  const ts = performance.now().toFixed(1);
  const line = `[IME-TRACE] ${ts} ${tag} activeEl=${activeElSummary()}${formatFields(fields)}`;
  console.log(line);
  appendToFile(line);
}

/**
 * 冒烟枪追踪：组合期发生的 setState / reload / watcher 重载等撕 DOM 高危调用。
 *
 * DEV 下以 `console.warn` 穿透（即便记录器自身的 composing 标志未置位也打——调用点已据
 * `view.composing` 判定）并落盘带 `SMOKING-GUN` 标记；生产 no-op。这是 autosave/setState
 * 组合期门若仍泄漏时的直接证据。
 */
export function imeTraceSmokingGun(what: string, fields: ImeTraceFields = {}): void {
  if (!DEV) return;
  const ts = performance.now().toFixed(1);
  const line = `[IME-TRACE] ${ts} SMOKING-GUN ${what} during composition! activeEl=${activeElSummary()}${formatFields(
    fields,
  )}`;
  console.warn(line);
  appendToFile(line);
}
