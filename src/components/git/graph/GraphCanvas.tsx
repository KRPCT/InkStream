import { memo } from 'react';
import {
  DOT_R,
  ROW_H,
  graphWidth,
  laneColor,
  laneX,
  type GraphLayout,
  type GraphSegment,
} from './layoutGraph';

/**
 * 整图单 SVG 层（git-graph 重构，对照 mhutchie/vscode-git-graph）：一次性画全部泳道连线 + 圆点，
 * **全局坐标**——连线严格从「本行圆点中心」到「下一行圆点中心」（根治旧版每行 0→ROW_H 导致的半行错位）。
 *
 * 绝对定位铺在文字行**之上**的左侧图谱列（pointer-events:none，点击穿透到下面的文字行）。
 * memo 只依赖 layout（commits 变才重画）——选区高亮在文字行处理，不触发整图重绘（500 提交不卡）。
 */

const CURVE_D = ROW_H * 0.45; // 贝塞尔控制点纵深：近圆点保持竖直、中段平滑 S 拐（vscode-git-graph 同思路）

/** 一截连接线 → 全局 SVG path：本行圆点(y1) → 下一行圆点(y2)。直线竖直；分叉/收束走三次贝塞尔。 */
function segPath(seg: GraphSegment, row: number): string {
  const x1 = laneX(seg.fromLane);
  const x2 = laneX(seg.toLane);
  const y1 = row * ROW_H + ROW_H / 2;
  const y2 = (row + 1) * ROW_H + ROW_H / 2;
  if (seg.kind === 'straight') return `M${x1} ${y1}V${y2}`;
  return `M${x1} ${y1}C${x1} ${y1 + CURVE_D} ${x2} ${y2 - CURVE_D} ${x2} ${y2}`;
}

function GraphCanvas({ layout }: { layout: GraphLayout }) {
  const width = graphWidth(layout.laneCount);
  // 多留一行高，让被截断历史的连线自然延伸出底边而非硬切。
  const height = layout.nodes.length * ROW_H + ROW_H;

  return (
    <svg
      width={width}
      height={height}
      className="pointer-events-none absolute left-0 top-0"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      {/* 先画连线，圆点叠其上（圆点压住线头更干净） */}
      {Array.from(layout.segmentsByRow.entries()).flatMap(([row, segs]) =>
        segs.map((s, i) => (
          <path
            key={`${row}-${i}`}
            d={segPath(s, row)}
            fill="none"
            stroke={laneColor(s.colorIndex)}
            strokeWidth={2}
            strokeLinecap="round"
          />
        )),
      )}
      {layout.nodes.map((n) => (
        <circle
          key={n.oid}
          cx={laneX(n.lane)}
          cy={n.row * ROW_H + ROW_H / 2}
          r={DOT_R}
          fill={laneColor(n.colorIndex)}
          stroke="var(--background-primary)"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

export default memo(GraphCanvas);
