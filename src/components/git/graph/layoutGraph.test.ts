import { describe, expect, it } from 'vitest';
import { layoutGraph, type DagCommit, type GraphSegment } from './layoutGraph';

/** 简写：c('M','A','B') = oid M，父 A、B。 */
const c = (oid: string, ...parents: string[]): DagCommit => ({ oid, parents });

/** 取某 oid 的节点。 */
const node = (l: ReturnType<typeof layoutGraph>, oid: string) =>
  l.nodes.find((n) => n.oid === oid)!;

const hasSeg = (segs: GraphSegment[] | undefined, kind: GraphSegment['kind']) =>
  (segs ?? []).some((s) => s.kind === kind);

describe('layoutGraph', () => {
  it('空输入 → 空布局', () => {
    const l = layoutGraph([]);
    expect(l.nodes).toEqual([]);
    expect(l.laneCount).toBe(1); // maxLane(0)+1
  });

  it('线性历史全在 lane 0', () => {
    // A→B→C（新→旧），单链
    const l = layoutGraph([c('A', 'B'), c('B', 'C'), c('C')]);
    expect(l.nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    expect(l.laneCount).toBe(1);
    expect(l.nodes.map((n) => n.row)).toEqual([0, 1, 2]);
    // 颜色单一链路延续
    expect(new Set(l.nodes.map((n) => n.colorIndex)).size).toBe(1);
  });

  it('一次分支+合并：分叉到 lane 1，合并基处收束回 lane 0', () => {
    // M(merge A,B) → A(C) → B(C) → C(root)
    const l = layoutGraph([c('M', 'A', 'B'), c('A', 'C'), c('B', 'C'), c('C')]);
    expect(node(l, 'M').lane).toBe(0);
    expect(node(l, 'A').lane).toBe(0); // 第一父续 lane 0
    expect(node(l, 'B').lane).toBe(1); // 第二父分叉 lane 1
    expect(node(l, 'C').lane).toBe(0); // 合并基认领最左 lane
    expect(l.laneCount).toBe(2);
    // merge 段在 M 行（row 0）；collapse 段在 B 行上方（row 2，C 在 row 3）
    expect(hasSeg(l.segmentsByRow.get(0), 'merge')).toBe(true);
    expect(hasSeg(l.segmentsByRow.get(2), 'collapse')).toBe(true);
    // 分叉链路颜色不同
    expect(node(l, 'A').colorIndex).not.toBe(node(l, 'B').colorIndex);
  });

  it('octopus 合并（3 父）不崩，至少用 3 lane', () => {
    const l = layoutGraph([c('M', 'A', 'B', 'C'), c('A', 'R'), c('B', 'R'), c('C', 'R'), c('R')]);
    expect(node(l, 'M').lane).toBe(0);
    // 三父占据 3 个不同 lane
    const childLanes = new Set([node(l, 'A').lane, node(l, 'B').lane, node(l, 'C').lane]);
    expect(childLanes.size).toBe(3);
    expect(l.laneCount).toBeGreaterThanOrEqual(3);
    // R 是四方汇入的合并基，认领最左 lane
    expect(node(l, 'R').lane).toBe(0);
  });

  it('多个独立 root：前一 root 释放 lane，后一 root 复用（lane 不无限增长）', () => {
    // 两条无交集的链：X→Xp（root）、Y→Yp（root）
    const l = layoutGraph([c('X', 'Xp'), c('Xp'), c('Y', 'Yp'), c('Yp')]);
    // Xp 是 root（无父）→ 释放 lane 0；Y 无子指向，复用空闲 lane 0
    expect(node(l, 'X').lane).toBe(0);
    expect(node(l, 'Y').lane).toBe(0); // lane 回收复用
    expect(l.laneCount).toBe(1);
  });

  it('每行 segmentsByRow 只画本行→下一行（不跨多行）', () => {
    const l = layoutGraph([c('A', 'B'), c('B', 'C'), c('C')]);
    // 最后一行（root C）无后续行 → 无续接段
    expect(l.segmentsByRow.get(2) ?? []).toHaveLength(0);
    // 前两行各有一条竖直续接
    expect(hasSeg(l.segmentsByRow.get(0), 'straight')).toBe(true);
    expect(hasSeg(l.segmentsByRow.get(1), 'straight')).toBe(true);
  });
});
