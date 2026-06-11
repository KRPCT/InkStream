import { StateEffect, type Extension } from '@codemirror/state';
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
export const composingGuard: Extension = EditorView.domEventHandlers({
  compositionstart(_event, view) {
    frozenFlags.set(view, true);
    return false;
  },
  compositionend(_event, view) {
    frozenFlags.set(view, false);
    // 强制刷新一次：组合彻底结束后让装饰层重建（补回组合期跳过的更新）。
    view.dispatch({ effects: refreshLivePreview.of(null) });
    return false;
  },
});
