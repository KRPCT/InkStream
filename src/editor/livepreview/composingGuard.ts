import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { imeTrace, imeTraceComposingEnd, imeTraceComposingStart } from './imeTrace';

/**
 * IME 冻结闸门（EDIT-06，全项目最高风险件 / RESEARCH Pitfall 1）。
 *
 * 背景（CONTEXT：无完整公开实现可抄，中文 IME × Live Preview 须本阶段自建）：
 * 中文 IME 组合期（compositionstart→compositionend），每次候选变化都触发 docChanged。
 * 装饰层此刻**不得重算语法树重建 DOM**（会破坏浏览器 composition 锚点 → 吞字 / 候选窗跳位 /
 * 上屏错乱），但**必须把已有 RangeSet 经 changes 映射跟随文档位移**——否则返回的旧装饰集相对
 * 已变文档错位，CM6 docView.update 的 findChangedDeco 会把插入点后所有 chunk 判为「未共享」，
 * 派生伪 changedRanges → 在正在合成的文本节点上重建 DOM → Chromium 中止 IME（吞字 root cause B）。
 *
 * 与 Option 2「活动行纯源码」契约的关系：活动行整行不发任何装饰（buildInlineDecorations /
 * buildBlockState 内 isActiveLine / tableTouchesActiveLine 硬跳过）保住正在合成行的文本相等闸门，
 * 是**重建路径**的不变量；本闸门则保证组合期**根本不重建**（map 跟随位移），二者叠加：组合期
 * 既不撕 DOM（本闸门），重建发生时活动行也恒为纯源码（Option 2）。
 *
 * 闸门时序（社区共识「composing + 原生 compositionend 双判」，CM6 惯用法对齐）：
 *   1. compositionstart → 仅置同步 WeakMap 冻结标志（**绝不派发事务**，避免组合期注入同步事务）。
 *      此后装饰层 update() 检测组合态：保旧 RangeSet 不重算，但 docChanged 时 map 跟随位移。
 *   2. 组合期文档变更由 CM6 原生打 userEvent `input.type.compose` 标记——块级 StateField（无 view、
 *      查不到 WeakMap）即据此 CM6-原生标记识别组合事务并 map 旧装饰，无需自注入冻结态。
 *   3. compositionend → 清同步标志，并把**恰好一次** refreshLivePreview 强刷推迟到一个微任务：
 *      它必须在 CM6 自身 compositionend 上屏 flush 之后、且组合彻底结束后才派发，否则会撞上
 *      EditorView.update 内的 observer.clear() 丢弃尚未 flush 的上屏 mutation（root cause A，已上屏的
 *      字反被吞）。微任务派发前以三重守卫确保只在组合彻底结束后强刷一次：(a) 代际未变（未被后续
 *      compositionstart 取代）、(b) !view.composing（composing>0 时仍在合成）、(c) !isFrozen(view)
 *      （composing===0 启动窗 view.composing 误为 false 的盲区）。跨组合竞态（重复同音节 咕咕咕）正是
 *      (a)+(c) 才能堵住的：N 的微任务被压进 N+1 的 composing===0 启动窗时，仅 `!view.composing` 会误放行。
 *   4. 装饰层判定叠加 `view.composing || isFrozen(view)`——view.composing 在 compositionend 后
 *      可能残留 true（codemirror/dev#1069），单判任一都会漏；双判才精确。
 *
 * frozen 标志用 WeakMap<EditorView, boolean>（模块级单例，仿 languages.ts switchGeneration），
 * 随 view 释放，不进 Zustand（不可序列化态死线）。
 */

/**
 * 强制刷新 effect：compositionend 后**推迟一个微任务**派发一次，驱动装饰层在组合结束后重建一次。
 *
 * 装饰层（inlinePlugin / blockField）在 update() 内识别此 effect 即重算（即便此刻 docChanged 为
 * false，且即便 view.composing 误残留 true 也照常重建——它先于组合短路判定）。
 */
export const refreshLivePreview = StateEffect.define<null>();

/** 每 view 的 IME 冻结标志（WeakMap 随 view 释放，不进 store）。 */
const frozenFlags = new WeakMap<EditorView, boolean>();

/**
 * 每 view 的 compositionend 强刷代际计数（WeakMap 随 view 释放，仿 languages.ts switchGeneration）。
 *
 * 跨组合竞态根因（commit 4d801b0 的教训）：compositionend(N) 调度的微任务强刷仅守 `!view.composing`，
 * 但 inputState.composing 有三态——compositionstart(N+1) 已触发、其首个 compositionupdate 尚未到达时
 * composing===0，`view.composing`（getter 为 composing>0）此刻为 false，组合却真实在进行（docView 在
 * composing>=0 即保护合成节点）。重复同音节（咕咕咕）快速上屏把 N 的微任务压进 N+1 的 composing===0
 * 启动窗 → `!view.composing` 误放行 → 陈旧强刷 view.dispatch → EditorView.update → observer.clear()
 * 丢弃 N+1 尚未 flush 的上屏 mutation → findCompositionRange 文本相等门失败 → 中止 IME（吞字）。
 *
 * 每次 compositionstart 递增本计数，作废任何在飞的上一组合强刷；微任务派发前再校验代际未变。
 */
const refreshGen = new WeakMap<EditorView, number>();

/**
 * 查询某 view 是否处于 IME 冻结期（compositionstart 后、compositionend 前）。
 *
 * 行内层 ViewPlugin update() 短路用：`if (u.view.composing || isFrozen(u.view)) { map; return; }`。
 * 块级 StateField 无 view，改据 CM6 原生 `tr.isUserEvent('input.type.compose')` 识别组合事务。
 */
export function isFrozen(view: EditorView): boolean {
  return frozenFlags.get(view) ?? false;
}

/**
 * IME 冻结闸门扩展：仅维护同步 WeakMap 冻结标志 + compositionend 推迟一次强刷。
 *
 * 关键纪律：compositionstart/compositionend 处理器内**绝不同步 view.dispatch**——组合期注入同步
 * 事务会破坏 CM6 的 IME 上屏 flush（root cause A）。compositionend 的强刷推迟到微任务并守 !composing。
 */
const compositionDomHandlers = EditorView.domEventHandlers({
  compositionstart(event, view) {
    frozenFlags.set(view, true);
    // 代际递增：作废任何上一组合在飞的 compositionend 强刷（跨组合竞态根因，咕咕咕重复同音节）。
    refreshGen.set(view, (refreshGen.get(view) ?? 0) + 1);
    imeTraceComposingStart();
    imeTrace('compositionstart', { data: event.data, docLen: view.state.doc.length });
    return false;
  },
  compositionupdate(event) {
    imeTrace('compositionupdate', { data: event.data });
    return false;
  },
  compositionend(event, view) {
    frozenFlags.set(view, false);
    imeTrace('compositionend', { committed: event.data, docLen: view.state.doc.length });
    imeTraceComposingEnd();
    // 调度时捕获当前代际，微任务派发前再校验——若期间又起了 compositionstart（代际已变）则放弃。
    const gen = refreshGen.get(view) ?? 0;
    // 推迟一个微任务再强刷：必须在 CM6 自身 compositionend 上屏 flush 之后、view.composing 归 false
    // 之后才派发，否则会撞 observer.clear() 丢弃尚未 flush 的上屏 mutation（root cause A）。
    Promise.resolve().then(() => {
      // 被后续 compositionstart 取代：N+1 在 N 的微任务排空前已完整 start→end（此时 isFrozen 已复位为
      // false，但代际已前进），陈旧强刷必须撤销。
      if ((refreshGen.get(view) ?? 0) !== gen) {
        imeTrace('refresh-superseded', { gen });
        return;
      }
      // view.composing（composing>0）OR composing===0 启动窗（isFrozen 为 true）——任一为真都说明组合
      // 仍在进行，绝不可强刷（撞 observer.clear 丢上屏 mutation）。双判才覆盖 composing===0 盲区。
      if (view.composing || isFrozen(view)) {
        imeTrace('refresh-skipped-still-composing', { composing: view.composing });
        return;
      }
      imeTrace('refresh-rebuild-once', { gen });
      view.dispatch({ effects: refreshLivePreview.of(null) });
    });
    return false;
  },
});

/**
 * IME 冻结闸门扩展（仅 dom 事件处理器）：compositionstart→置标志、compositionend→清标志 + 推迟强刷。
 *
 * 供行内层（WeakMap isFrozen）与块级层（CM6 原生 `input.type.compose` userEvent）共用全局护栏。
 */
export const composingGuard: Extension = compositionDomHandlers;
