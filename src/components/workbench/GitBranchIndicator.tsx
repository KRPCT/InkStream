import { GitBranch } from 'lucide-react';
import { useGitStore } from '../../stores/useGitStore';

/**
 * StatusBar 左侧分支指示（Phase 6 GIT-01）：当前分支名 + 未提交改动状态点。
 *
 * 非 git 工作区 / detached / unborn（status.branch 为 null）→ return null（隐藏）。
 * 本期仅显示；W2 接 git-graph 后改为可点击入口（View ▸ Git Graph）。
 * 文本走中性层（--text-muted），accent 仅用于脏标记点（UI-SPEC 强调色禁区，无硬编色）。
 */
export default function GitBranchIndicator() {
  const status = useGitStore((s) => s.status);
  if (!status?.branch) return null;
  const dirty = status.files.length > 0;

  return (
    <span
      data-testid="git-branch-indicator"
      className="flex h-full items-center gap-1.5 px-2 text-[12px] font-normal text-[var(--text-muted)]"
      title={dirty ? '当前分支（有未提交改动）' : '当前分支'}
    >
      <GitBranch size={12} aria-hidden="true" className="shrink-0" />
      <span>{status.branch}</span>
      {dirty ? (
        <span
          aria-hidden="true"
          data-testid="git-dirty-dot"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
        />
      ) : null}
    </span>
  );
}
