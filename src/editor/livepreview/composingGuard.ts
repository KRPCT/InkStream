import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * IME 冻结闸门（EDIT-06，全项目最高风险件 / RESEARCH Pitfall 1）。
 *
 * 背景（CONTEXT：无完整公开实现可抄，中文 IME × Live Preview 须本阶段自建）：
 * 中文 IME 组合期（compositionstart→compositionend），每次候选变化都触发 docChanged，
 * 若装饰层照常重算并改 DOM，会破坏浏览器的 composition 锚点 → 吞字 / 候选窗跳位 / 上屏错乱。
 *
 * 闸门时序（RESEARCH Pitfall 1，社区共识「composing + 原生 compositionend 双判」）：
 *   1. compositionstart → frozen = true；此后所有装饰层 update() 短路（保旧 RangeSet，绝不重算）。
 *   2. compositionend → frozen = false，并派发**恰好一次** refreshLivePreview 强制刷新事务，
 *      使装饰在组合彻底结束后重建一次（补回组合期跳过的更新）。
 *   3. 装饰层判定须叠加 `view.composing || isFrozen(view)`——view.composing 在 compositionend 后
 *      可能残留 true（codemirror/dev#1069），单判任一都会漏；双判才精确。
 *
 * frozen 标志用 WeakMap<EditorView, boolean>（模块级单例，仿 languages.ts:136 switchGeneration），
 * 随 view 释放，不进 Zustand（不可序列化态死线）。
 */

/**
 * 强制刷新 effect：compositionend 后派发一次，驱动装饰层在组合结束后重建一次。
 *
 * 装饰层（inlinePlugin / 后续块级层）在 update() 内识别此 effect 即重算（即便此刻 docChanged 为 false）。
 */
export const refreshLivePreview = StateEffect.define<null>();

/**
 * 设置冻结态的 StateEffect：compositionstart→true / compositionend→false。
 *
 * 行内层（ViewPlugin）经 isFrozen(view) 查 WeakMap 即可短路；但**块级层是 StateField，
 * update() 内只有 transaction/state、拿不到 view**——无法查 WeakMap。故冻结态须经此 effect
 * 入 state（frozenField），块级层经 `tr.state.field(frozenField)` 同步读取并短路（RESEARCH Pitfall 1）。
 */
export const setFrozen = StateEffect.define<boolean>();

/**
 * 冻结态 StateField（state 级镜像 WeakMap 标志）：供块级层 StateField 同步读取。
 *
 * 与 WeakMap frozenFlags 由同一组 dom 事件驱动、值一致（双轨：ViewPlugin 查 WeakMap、
 * StateField 查此 field）。挂入 composingGuard 一并生效。
 */
export const frozenField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFrozen)) return e.value;
    }
    return value;
  },
});

/** 某 state 是否处于 IME 冻结期（块级 StateField 短路用，与 isFrozen(view) 同值）。 */
export function isFrozenState(state: { field: (f: typeof frozenField) => boolean }): boolean {
  return state.field(frozenField);
}

/** 每 view 的 IME 冻结标志（WeakMap 随 view 释放，不进 store）。 */
const frozenFlags = new WeakMap<EditorView, boolean>();

/**
 * 查询某 view 是否处于 IME 冻结期（compositionstart 后、compositionend 前）。
 *
 * 装饰层 update() 首行短路用：`if (update.view.composing || isFrozen(update.view)) return;`。
 */
export function isFrozen(view: EditorView): boolean {
  return frozenFlags.get(view) ?? false;
}

/**
 * IME 冻结闸门扩展：维护 frozen 标志 + compositionend 强制刷新一次。
 *
 * 挂入 livePreviewExtensions()，作为全局护栏供所有装饰层共用（前向兼容扩展点 3：
 * 后续装饰只要走同一 isFrozen / view.composing 短路即自动受保护）。
 */
const compositionDomHandlers = EditorView.domEventHandlers({
  compositionstart(_event, view) {
    frozenFlags.set(view, true);
    // 镜像入 state：块级 StateField 经 frozenField 同步读取并短路（行内层走 WeakMap）。
    view.dispatch({ effects: setFrozen.of(true) });
    return false;
  },
  compositionend(_event, view) {
    frozenFlags.set(view, false);
    // 解冻 + 强制刷新一次：组合彻底结束后让装饰层重建（补回组合期跳过的更新）。
    view.dispatch({ effects: [setFrozen.of(false), refreshLivePreview.of(null)] });
    return false;
  },
});

/**
 * IME 冻结闸门扩展（dom 事件 + state 级 frozenField）：
 * compositionstart→冻结、compositionend→解冻 + 强刷一次。供行内层（WeakMap）与块级层（frozenField）共用。
 */
export const composingGuard: Extension = [compositionDomHandlers, frozenField];
