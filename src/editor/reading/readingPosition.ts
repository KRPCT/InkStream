/**
 * 阅读续读定位纯算法（FEAT-READ 续读）：从各块/行的内容顶端偏移与当前滚动位，推断「读到第几块」，
 * 以及由此换算阅读分数。供 HtmlReader（同源 iframe 测量）与 PdfReader 调用；纯函数，便于单测。
 */

/**
 * 视口顶端所在的块索引：偏移 ≤ 当前滚动位（含小容差 fudge）的最后一个块。
 * tops 须按 DOM 顺序升序（各块相对内容顶端的偏移 px）。空列表返回 0。
 */
export function topVisibleIndex(tops: number[], scrollTop: number, fudge = 4): number {
  let idx = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] > scrollTop + fudge) break;
    // 同顶相邻块（零位移块）取首个：避免续读恢复后回存时锚点反复前移。
    if (i === 0 || tops[i] > tops[idx]) idx = i;
  }
  return idx;
}

/** 阅读分数（0..1）：读到第 anchor 块（0 基）/ 共 total 块 → (anchor+1)/total，末块=1。 */
export function readFraction(anchor: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (anchor + 1) / total));
}
