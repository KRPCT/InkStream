import { memo } from 'react';
import {
  DOT_R,
  LANE_W,
  ROW_H,
  laneColor,
  laneX,
  type GraphNode,
  type GraphSegment,
} from './layoutGraph';
import type { GitRef } from '../../../types/git';

/**
 * git-graph 单行（Phase 6 GIT-02）：左 lane SVG（圆点 + 跨行连线段）+ refs 徽章 + summary/author/date。
 * memo：仅本行数据变才重渲染（虚拟化下大量行复用）。色全走 CSS 变量（laneColor / --graph-*，无硬编色）。
 */

/** 一截线段 → SVG path：y 从 0(上行中点) 到 ROW_H(本行中点) 跨整行；分叉/收束走三次贝塞尔平滑 S 拐。 */
function segPath(s: GraphSegment): string {
  const x1 = laneX(s.fromLane);
  const x2 = laneX(s.toLane);
  if (s.kind === 'straight') return `M${x1} 0 L${x1} ${ROW_H}`;
  const my = ROW_H / 2;
  return `M${x1} 0 C${x1} ${my} ${x2} ${my} ${x2} ${ROW_H}`;
}

interface Props {
  node: GraphNode;
  segments: GraphSegment[];
  laneCount: number;
  refs: GitRef[];
  currentBranch: string | null;
  summary: string;
  author: string;
  date: string;
  selected: boolean;
  onClick: () => void;
}

function CommitRow({
  node,
  segments,
  laneCount,
  refs,
  currentBranch,
  summary,
  author,
  date,
  selected,
  onClick,
}: Props) {
  const width = Math.max(laneCount * LANE_W, LANE_W);
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 px-2 ${
        selected
          ? 'bg-[var(--background-modifier-active)]'
          : 'hover:bg-[var(--background-modifier-hover)]'
      }`}
      style={{ height: ROW_H }}
    >
      {/* 左：lane SVG（overflow visible 让相邻行线段在边界重叠 1px 接续不断） */}
      <svg width={width} height={ROW_H} className="shrink-0" style={{ overflow: 'visible' }}>
        {segments.map((s, i) => (
          <path
            key={i}
            d={segPath(s)}
            fill="none"
            stroke={laneColor(s.colorIndex)}
            strokeWidth={1.5}
          />
        ))}
        <circle
          cx={laneX(node.lane)}
          cy={ROW_H / 2}
          r={DOT_R}
          fill={laneColor(node.colorIndex)}
          stroke="var(--background-primary)"
          strokeWidth={1}
        />
      </svg>
      {refs.map((r) => {
        const isCurrent = r.kind === 'localBranch' && r.name === currentBranch;
        return (
          <span
            key={r.kind + r.name}
            className="shrink-0 rounded-[3px] px-1 text-[11px] leading-tight"
            style={{
              background: r.kind === 'tag' ? 'var(--graph-ref-tag-bg)' : 'var(--graph-ref-branch-bg)',
              color: 'var(--graph-ref-fg)',
              outline: isCurrent ? '1px solid var(--accent)' : undefined,
            }}
            title={r.kind === 'tag' ? `标签 ${r.name}` : r.name}
          >
            {r.name}
          </span>
        );
      })}
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-normal)]">{summary}</span>
      <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{author}</span>
      <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{date}</span>
    </div>
  );
}

export default memo(CommitRow);
