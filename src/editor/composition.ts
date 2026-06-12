import {
  Annotation,
  EditorState,
  StateEffect,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * 统一组合冻结门（重构设计 §2，吸收 composingGuard 全部职责）。
 *
 * IME 组合期（compositionstart→compositionend）任何会触发 EditorView.update 的同步操作（装饰强刷、
 * 换装 setState、语言/渲染 reconfigure、磁盘写）都会撞 observer.clear() 丢弃尚未 flush 的上屏 mutation
 * （root cause A），或撕掉正在合成的 DocView 文本节点（root cause B）→ 吞字。本门是全项目唯一收口点：
 * 把这些操作从「组合期同步执行」推迟到「组合彻底结束后的微任务」，并提供唯一组合判据。
 *
 * 状态源（模块级 WeakMap，随 view 释放，绝不进 Zustand）：
 *   frozenFlags  compositionstart→true / compositionend→false（同步置位，绝不 dispatch）。
 *   refreshGen   每次 compositionstart 自增，作废在飞的上一组合强刷与排队任务（跨组合竞态守卫）。
 *   pendingTasks 组合期按 key 去重挂起的副作用，compositionend drain 时按入队序执行一次。
 */

/** compositionend drain 派发一次的强刷 effect：装饰层识别即恰好重建一次（解冻还原渲染态）。 */
export const refreshLivePreview = StateEffect.define<null>();

/** 冻结 annotation：transactionExtender 给组合事务附此标记，块级 StateField 经 isComposingTr 读同源冻结态。 */
export const composingAnnotation = Annotation.define<boolean>();

/** 每 view 的 IME 冻结标志（铁律 4 双判的权威支）。 */
const frozenFlags = new WeakMap<EditorView, boolean>();

/** 每 view 的 compositionend 强刷代际（仿 languages.ts switchGeneration，跨组合竞态守卫）。 */
const refreshGen = new WeakMap<EditorView, number>();

/** 每 view 的组合期挂起副作用表（按 key 去重，保入队序）。 */
const pendingTasks = new WeakMap<EditorView, Map<string, () => void | Promise<void>>>();

/**
 * 冻结起始 state 集（annotation 桥的 view-less 关联口）。compositionstart 同步记入当前 view.state，
 * transactionExtender 无 view 句柄，据 tr.startState 是否在册判定该事务是否发自冻结中的 view。
 * compositionend 必须同步清除当前 view.state：空组合（start→end 零事务）时 state 未推进，
 * 不清则后续首个普通编辑事务被误判为组合中（块级层误走 map-not-rebuild 留陈旧装饰）。
 */
const frozenStartStates = new WeakSet<EditorState>();

/** 查询某 view 是否处于 IME 冻结期（行内 ViewPlugin / autosave / externalChange 用，铁律 4 双判）。 */
export function isComposing(view: EditorView): boolean {
  return view.composing || (frozenFlags.get(view) ?? false);
}

/** 该事务发起 view 是否冻结（annotation 桥的兜底支，view-less）。 */
function frozenForTr(tr: Transaction): boolean {
  return frozenStartStates.has(tr.startState);
}

/**
 * 块级 StateField（无 view，只有 tr）的唯一组合判据：annotation ∪ CM6 原生标记 ∪ frozen 双判。
 * 与 isComposing(view) 同覆盖——compositionstart 后首个 docChanged 事务由 isUserEvent 兜底。
 */
export function isComposingTr(tr: Transaction): boolean {
  return (
    tr.annotation(composingAnnotation) === true ||
    tr.isUserEvent('input.type.compose') ||
    frozenForTr(tr)
  );
}

/**
 * 组合期排队原语（换装 / reload / autosave / reconfigure 唯一入口）：
 * 非组合期立即执行；组合期按 key 去重挂起，compositionend drain 时按入队序执行一次。
 */
export function queueAfterComposition(
  view: EditorView,
  key: string,
  task: () => void | Promise<void>,
): void {
  if (!isComposing(view)) {
    void task();
    return;
  }
  let tasks = pendingTasks.get(view);
  if (!tasks) {
    tasks = new Map();
    pendingTasks.set(view, tasks);
  }
  // 同 key 覆盖去重：取最后一次（先切 A 再切 A 只跑一次；不同 key 各排一个保入队序）。
  tasks.set(key, task);
}

/**
 * compositionstart→end 内的一次性 compositionend 回调（deferReplay 一般化，按 key 去重）。
 * 非组合期立即执行；组合期挂起到 drain。语义为 queueAfterComposition 的别名（同一调度层）。
 */
export function onCompositionEnd(view: EditorView, key: string, cb: () => void): void {
  queueAfterComposition(view, key, cb);
}

/**
 * 门扩展：domEventHandlers（同步冻结标志 + compositionend 推迟 drain）+ transactionExtender（annotation 桥）。
 * 挂 baseExtensions 顶层（绝非 renderModeCompartment 内）——保证 Source 模式 / 代码文件 / 所有语言下门都在册。
 */
const compositionDomHandlers = EditorView.domEventHandlers({
  compositionstart(_event, view) {
    frozenFlags.set(view, true);
    frozenStartStates.add(view.state);
    // 代际自增：作废上一组合在飞的强刷与排队任务（咕咕咕重复同音节根因）。
    refreshGen.set(view, (refreshGen.get(view) ?? 0) + 1);
    return false;
  },
  compositionend(_event, view) {
    frozenFlags.set(view, false);
    // 空组合（零事务）时 view.state 仍是 start 记入的那个 state，同步移除防误判后续普通编辑；
    // 有事务的组合 view.state 已推进，此删除为 no-op（旧 state 不再作为未来事务的 startState）。
    frozenStartStates.delete(view.state);
    const gen = refreshGen.get(view) ?? 0;
    // 推迟一个微任务再 drain：必须在 CM6 自身 compositionend 上屏 flush、view.composing 归 false 之后
    // 才派发，否则撞 observer.clear() 丢弃尚未 flush 的上屏 mutation（root cause A）。
    Promise.resolve().then(() => drain(view, gen));
    return false;
  },
});

/** annotation 桥：给冻结中 view 派发的事务附 composingAnnotation，块级层据此读同源冻结态。 */
const compositionTrExtender = EditorState.transactionExtender.of((tr) => {
  if (!frozenStartStates.has(tr.startState) && !tr.isUserEvent('input.type.compose')) return null;
  return { annotations: composingAnnotation.of(true) };
});

/** 统一组合冻结门（挂 baseExtensions 顶层）。 */
export const compositionGate: Extension = [compositionDomHandlers, compositionTrExtender];

/**
 * compositionend 微任务体：三守卫 + 固定顺序 drain。
 *   (a) 代际已变：被后续 compositionstart 取代，陈旧强刷作废。
 *   (b) view.composing：composing>0 仍在合成。
 *   (c) isComposing(view)：composing===0 启动窗 frozen 误为 true 的盲区（双判第二判）。
 * 全过 → 固定顺序：refreshLivePreview 强刷 → 排空 pendingTasks（按入队序，每个跑一次后清表）。
 */
function drain(view: EditorView, gen: number): void {
  if ((refreshGen.get(view) ?? 0) !== gen) return;
  if (view.composing) return;
  if (isComposing(view)) return;
  view.dispatch({ effects: refreshLivePreview.of(null) });
  const tasks = pendingTasks.get(view);
  if (!tasks || tasks.size === 0) return;
  // 复制后清表：task 内可能再次 queueAfterComposition（此刻已非组合期，立即执行不复入表）。
  const ordered = [...tasks.values()];
  tasks.clear();
  for (const task of ordered) void task();
}

/** 仅供测试：清 pendingTasks 隔离用例（frozenFlags/refreshGen 随 view 释放）。 */
export function __resetCompositionForTest(view?: EditorView): void {
  if (view) pendingTasks.get(view)?.clear();
}
