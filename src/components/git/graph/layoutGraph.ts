/**
 * git-graph DAG → lane(列) + row(行) 布局（Phase 6 GIT-02 核心，纯函数无 React/DOM，可单测）。
 *
 * 输入按新→旧排序（git_log 拓扑+时间序）。算法对照 vscode-git-graph 行为复刻、**代码全自写**（其无许可证）：
 * 维护一组「活跃链路 strand（lane + 等待的 parentOid + 颜色）」自上而下逐行扫描——
 *  - commit 认领指向它的最左 strand 的 lane（主干靠左稳定）；其余指向它的 strand 收束、回收 lane；
 *  - 第一父续本 lane（竖线）；合并父分叉到空闲 lane（曲线）；root 终结回收 lane。
 * 连接段按「row→row+1」逐段切片（虚拟化友好：渲染第 r 行只取 segmentsByRow[r]）。
 */

/** 布局只需 oid + parents；与完整 CommitInfo 解耦（便于纯函数单测）。 */
export interface DagCommit {
  oid: string;
  parents: string[];
}

/** 一行内某 commit 的几何定位。 */
export interface GraphNode {
  oid: string;
  row: number; // = commits 下标（新→旧，0 在最上）
  lane: number; // 列号，0 最左
  colorIndex: number; // 调色板取模索引（→ var(--graph-lane-N)）
}

/** 一截连接线（只跨相邻两行 row→row+1），供 SVG 逐行渲染。 */
export interface GraphSegment {
  fromLane: number;
  toLane: number;
  colorIndex: number;
  /** 'straight' 竖直续接 | 'merge' 分叉(向右下) | 'collapse' 收束(向左下汇入) */
  kind: 'straight' | 'merge' | 'collapse';
}

export interface GraphLayout {
  nodes: GraphNode[];
  /** 按 row 分桶的线段（渲染第 r 行取 segmentsByRow.get(r)，画 r→r+1 那截）。 */
  segmentsByRow: Map<number, GraphSegment[]>;
  laneCount: number; // 最大同时 lane 数 → SVG 宽度 = laneCount * LANE_W
}

interface Strand {
  expectedParent: string; // 这条竖线在等哪个 parent oid 出现
  colorIndex: number;
}

/** 几何常量（行高/列宽/圆点半径；虚拟化 estimateSize 与 SVG 坐标共用）。 */
export const ROW_H = 26;
export const LANE_W = 14;
export const DOT_R = 4;
/** 调色板循环长度（与 git-graph.css 的 --graph-lane-0..7 对应）。 */
export const PALETTE_N = 8;

/** lane → SVG x 坐标（圆点/线在 lane 中点）。 */
export const laneX = (lane: number): number => lane * LANE_W + LANE_W / 2;
/** colorIndex → CSS 变量色。 */
export const laneColor = (i: number): string => `var(--graph-lane-${i % PALETTE_N})`;

export function layoutGraph(commits: readonly DagCommit[]): GraphLayout {
  const nodes: GraphNode[] = [];
  const segmentsByRow = new Map<number, GraphSegment[]>();
  const active: (Strand | null)[] = []; // active[i] = 占 lane i 的 strand，null = 空闲
  let maxLane = 0;
  let colorSeq = 0; // 单调递增，渲染端 % PALETTE_N 取色

  const firstFree = (): number => {
    const i = active.indexOf(null);
    if (i !== -1) return i;
    active.push(null);
    return active.length - 1;
  };
  const push = (row: number, s: GraphSegment): void => {
    const b = segmentsByRow.get(row);
    if (b) b.push(s);
    else segmentsByRow.set(row, [s]);
  };

  for (let row = 0; row < commits.length; row++) {
    const c = commits[row];

    // 1. 认领 lane：找所有等待本 commit 的 strand（= 已见子节点留下的线）
    const incoming: number[] = [];
    for (let l = 0; l < active.length; l++) {
      if (active[l]?.expectedParent === c.oid) incoming.push(l);
    }

    let lane: number;
    let colorIndex: number;
    if (incoming.length > 0) {
      lane = Math.min(...incoming); // 最左者胜：主干稳定靠左
      colorIndex = active[lane]!.colorIndex; // 颜色延续
      for (const l of incoming) {
        if (l === lane) continue;
        // 多子汇入：l 在 row-1→row 之间收束到 lane，回收 l
        push(row - 1, { fromLane: l, toLane: lane, colorIndex: active[l]!.colorIndex, kind: 'collapse' });
        active[l] = null;
      }
    } else {
      lane = firstFree(); // 无子指向 → 新分支顶端，新 lane + 新色
      colorIndex = colorSeq++;
    }
    maxLane = Math.max(maxLane, lane);
    nodes.push({ oid: c.oid, row, lane, colorIndex });

    // 2. 铺设到父的 strand
    if (c.parents.length === 0) {
      active[lane] = null; // root：链路终结
    } else {
      active[lane] = { expectedParent: c.parents[0], colorIndex }; // 第一父续本 lane（竖直）
      for (let k = 1; k < c.parents.length; k++) {
        const nl = firstFree();
        const cc = colorSeq++;
        active[nl] = { expectedParent: c.parents[k], colorIndex: cc };
        maxLane = Math.max(maxLane, nl);
        push(row, { fromLane: lane, toLane: nl, colorIndex: cc, kind: 'merge' }); // 合并父分叉曲线
      }
    }

    // 3. 仍 active 的 strand：row→row+1 之间画竖直续接（lane 不变主体）
    for (let l = 0; l < active.length; l++) {
      const s = active[l];
      if (s) push(row, { fromLane: l, toLane: l, colorIndex: s.colorIndex, kind: 'straight' });
    }
  }

  dedupeStraights(segmentsByRow);
  return { nodes, segmentsByRow, laneCount: maxLane + 1 };
}

/**
 * 去重：同一 band 里若某 lane 已有 merge(toLane=L) 或 collapse(fromLane=L) 斜线，则丢弃该 lane 的 straight——
 * 该 strand 经斜线进/出该列，全程竖线会与曲线叠画出错（研究 §2.3 去重提示）。
 */
function dedupeStraights(segmentsByRow: Map<number, GraphSegment[]>): void {
  for (const [row, segs] of segmentsByRow) {
    const curved = new Set<number>();
    for (const s of segs) {
      if (s.kind === 'merge') curved.add(s.toLane);
      else if (s.kind === 'collapse') curved.add(s.fromLane);
    }
    if (curved.size === 0) continue;
    segmentsByRow.set(
      row,
      segs.filter((s) => !(s.kind === 'straight' && curved.has(s.fromLane))),
    );
  }
}
