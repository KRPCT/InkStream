import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockField, type TableRange } from './blockField';

/**
 * 表格点击穿透手势（UAT #1 / D-06 整块还原 / RESEARCH Pattern 4 programmatic-selection 例外）。
 *
 * 根因（经对抗式 verifier 修正的真因）：TableWidget 旧 `ignoreEvent()` 无条件吞事件——CM 的
 * `eventBelongsToEditor` 据此把落在表格上的 mousedown 判为「不属于编辑器」，于是 CM 的
 * MouseSelection/select() 永不运行，点击单元格不置光标、无法进编辑（键盘可进是因 cursorInRange
 * 闭区间 + atomicRanges 跳过，与点击无关）。
 *
 * 修复分两半：(1) TableWidget.ignoreEvent 对 mousedown 放行（返回 false）使点击「属于编辑器」；
 * (2) 本 domEventHandler 截获落在表格块内的点击，`preventDefault()` 后程序化派发光标进块——
 * block-replace widget 的 posAtCoords 只会解析到 block.from/block.to（永不落进单元格内部），故
 * 不能靠 CM 默认置光标，须显式 dispatch 一个块内位置；programmatic selection 不受 atomicRanges
 * 约束（Pattern 4），光标得以落进 [from+1, to]，触发 blockField 的边界跨越重建 → 整块还原源码
 * （UAT #8 的 selectionCrossesBoundary 路径），表格立即变可编辑源码。
 *
 * 手势顺序（与 linkGesture 协调）：linkGesture 先注册——Ctrl/Cmd+点击外链时它返回 true 短路，
 * 本手势不触发（不劫持外链导航）；普通点击命中表格时 linkGesture 无链接返回 false，轮到本手势。
 * 非表格点击 / 坐标未命中：返回 false，交回 CM 默认行为。
 */

/** 主光标候选 pos 落入哪个表格块（闭区间，含端点）；不在任何块内返回 null。 */
function tableContaining(tables: readonly TableRange[], pos: number): TableRange | null {
  for (const t of tables) {
    if (pos >= t.from && pos <= t.to) return t;
  }
  return null;
}

/**
 * 把点击命中的源行偏移夹到表格块内的合法光标位（保证 ∈ [from+1, to]，必落进块内触发整块还原）。
 *
 * posAtCoords 对 block-replace widget 只会给 block.from（或 block.to），二者均为边界——from 处
 * cursorInRange 虽闭区间也算「在块内」，但为稳健（避免边界处装饰判定歧义、确保跨越边界重建必触发），
 * 统一夹到 from+1 起。映射不到更精细的单元格行时，块首即「立即可编辑源码」的达标基线。
 */
function clampInsideBlock(block: TableRange, pos: number): number {
  const min = Math.min(block.from + 1, block.to);
  if (pos < min) return min;
  if (pos > block.to) return block.to;
  return pos;
}

/**
 * mousedown 手势核心（纯逻辑，配对单测穷举：命中表格、非表格、坐标未命中）。
 *
 * @returns true = 已处理（程序化置光标进块，CM 不再默认 select）；false = 交回 CM 默认行为。
 */
export function handleTableMousedown(event: MouseEvent, view: EditorView): boolean {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return false;

  const block = tableContaining(view.state.field(blockField).tables, pos);
  if (!block) return false;

  // 程序化派发块内光标（不受 atomicRanges 约束）：触发 blockField 边界跨越重建 → 整块还原源码。
  const target = clampInsideBlock(block, pos);
  event.preventDefault(); // 接管置光标：避免 CM 默认 select 落到块边界外。
  view.dispatch({ selection: EditorSelection.cursor(target), scrollIntoView: true });
  return true;
}

/**
 * 表格点击手势扩展（挂入 livePreviewExtensions，注册于 linkGesture 之后）：mousedown 委派
 * handleTableMousedown。返回 true 时 CM6 跳过默认 mousedown（已自行置光标）；false 时按默认走。
 */
export const tableGesture = EditorView.domEventHandlers({
  mousedown: (event, view) => handleTableMousedown(event, view),
});
