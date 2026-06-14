import { GitBranch } from 'lucide-react';
import { useGitStore } from '../../stores/useGitStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

/**
 * StatusBar 左下角分支指示（Phase 6 GIT-01 / 簇①）：当前分支 + 未提交改动点。
 * **点击切换 Git Graph 视图**（再点退出，快捷入口）；在 graph 视图时高亮。
 *
 * 非 git 工作区 / detached / unborn（status.branch 为 null）→ return null（隐藏）。
 * 文本走中性层（--text-muted），accent 仅用于脏标记点（UI-SPEC 强调色禁区，无硬编色）。
 */
export default function GitBranchIndicator() {
  const status = useGitStore((s) => s.status);
  const inGraph = useWorkbenchStore((s) => s.centralView === 'gitGraph');
  if (!status?.branch) return null;
  const dirty = status.files.length > 0;

  return (
    <button
      type="button"
      data-testid="git-branch-indicator"
      onClick={() => useWorkbenchStore.getState().toggleCentralView('gitGraph')}
      title={inGraph ? '关闭 Git Graph' : '打开 Git Graph'}
      className={`flex h-full items-center gap-1.5 px-2 text-[12px] font-normal transition-colors duration-[var(--duration-fast)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] ${
        inGraph
          ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]'
          : 'text-[var(--text-muted)]'
      }`}
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
    </button>
  );
}
