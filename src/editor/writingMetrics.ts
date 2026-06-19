import type { ViewUpdate } from '@codemirror/view';
import { useWritingMetricsStore } from '../stores/useWritingMetricsStore';

/**
 * 码字速度指标（写作 HUD）：最近 60s 净插入字符数滑窗（即「字/分」）。
 *
 * 数据源：mirrorListener 的 docChanged && !isComposing 块（IME 铁律——组合期候选键击不计入，否则中文
 * 输入会虚高速度）。只数「插入」字符（u.changes.inserted.length），删除不减、不数净字数——「码字」=已写下
 * 的字符。停笔后速度应随窗口滑出而衰减：WritingHud 每秒调 refreshSpeed() 重算窗口（无新插入也剪旧样本）。
 *
 * 纯内存、不持久化；模块级环形样本 + 可注入时钟（测试桩）。与 wordCount.ts 同「单向写 store」纪律。
 */

const WINDOW_MS = 60_000;

interface Sample {
  t: number;
  n: number;
}

let ring: Sample[] = [];
let clock: () => number = () => performance.now();

/** 测试桩：注入单调时钟。 */
export function configureWritingMetrics(next: { now?: () => number }): void {
  if (next.now) clock = next.now;
}

/** 复位（测试用；生产中 60s 滑窗每次读取自动剪旧样本过期，无需在切 vault 时显式复位）。 */
export function resetWritingMetrics(): void {
  ring = [];
  clock = () => performance.now();
}

/** 本次事务净插入字符数（不含删除）。 */
function insertedChars(u: ViewUpdate): number {
  let n = 0;
  u.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    n += inserted.length;
  });
  return n;
}

/** 当前 60s 滑窗速度（字/分）：剪掉窗口外旧样本后求和。 */
export function currentSpeed(): number {
  const cutoff = clock() - WINDOW_MS;
  ring = ring.filter((s) => s.t >= cutoff);
  return ring.reduce((sum, s) => sum + s.n, 0);
}

/** 重算窗口并写入 store（HUD 每秒 tick 调用，反映停笔衰减）。 */
export function refreshSpeed(): void {
  useWritingMetricsStore.getState().reportSpeed(currentSpeed());
}

/**
 * docChanged（非组合期）触发：仅把「用户输入」事务（input.type 打字 / input.paste 粘贴）的插入字符计入滑窗，
 * 跳过程序化编辑（插入引用 / 参考文献展开 / 表格同步等）——否则一次插参考文献会把码字速度刷到上千。每次刷新窗口。
 */
export function syncTypingMetrics(u: ViewUpdate): void {
  const fromInput = u.transactions.some((tr) => tr.isUserEvent('input'));
  if (fromInput) {
    const n = insertedChars(u);
    if (n > 0) ring.push({ t: clock(), n });
  }
  refreshSpeed();
}
