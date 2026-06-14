import { memo } from 'react';
import { ROW_H } from './layoutGraph';
import type { GitRef } from '../../../types/git';

/**
 * git-graph 单行**文字层**（重构后）：refs 徽章 + summary/author/date。圆点与连线由 GraphCanvas 整图单 SVG 画，
 * 本行只负责左缩进让出图谱列（paddingLeft=graphWidth）+ 选区/hover 背景 + 点击。memo：虚拟化下大量行复用。
 */

interface Props {
  graphWidth: number;
  refs: GitRef[];
  currentBranch: string | null;
  summary: string;
  author: string;
  date: string;
  selected: boolean;
  /** Find 命中（W5）：非选中时浅黄底高亮。 */
  matched?: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function CommitRow({
  graphWidth,
  refs,
  currentBranch,
  summary,
  author,
  date,
  selected,
  matched = false,
  onClick,
  onContextMenu,
}: Props) {
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`flex cursor-pointer items-center gap-2 pr-2 ${
        selected
          ? 'bg-[var(--background-modifier-active)]'
          : 'hover:bg-[var(--background-modifier-hover)]'
      }`}
      style={{
        height: ROW_H,
        paddingLeft: graphWidth + 8,
        ...(matched && !selected ? { background: 'var(--graph-find-match-bg)' } : {}),
      }}
    >
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
