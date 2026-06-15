import { useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  GitCommitVertical,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  commitChanges,
  fetchRemote,
  pullCurrent,
  pushCurrent,
  refreshGitAll,
  stashChanges,
} from '../../editor/gitActions';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useGitStore } from '../../stores/useGitStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import BranchFilter from './BranchFilter';
import BranchManager from './BranchManager';
import PullRequestPanel from './PullRequestPanel';
import RepoSettings from './RepoSettings';
import CommitGraphList from './graph/CommitGraphList';
import CommitDetailPanel from './CommitDetailPanel';
import FileDiffPanel from './FileDiffPanel';
import '../../styles/git-graph.css';

/**
 * Git Graph 整页视图（Phase 6 GIT-02）：顶部细工具条 + 三栏（图谱 / 详情 / diff）。
 * 挂载时按当前仓库根加载 log + refs；退出由 CentralArea display 切换（本组件挂/卸由其条件渲染管）。
 * 三栏用 react-resizable-panels（与 WorkbenchLayout 同库），会话内尺寸不持久（git-graph 非按模式记忆）。
 */
export default function GitGraphView() {
  const repoRoot = useGitStore((s) => s.repoRoot);
  const loading = useGitGraphStore((s) => s.loading);
  const commitCount = useGitGraphStore((s) => s.commits.length);
  const remoteBusy = useGitGraphStore((s) => s.remoteBusy);
  const setCentralView = useWorkbenchStore((s) => s.setCentralView);
  const busy = remoteBusy !== null;
  // 左栏：提交图谱 ⇄ 分支管理（参考 GitButler 的清晰分支 UX；置于 store 便于侧栏「分支」入口直达）。
  const leftMode = useGitGraphStore((s) => s.leftMode);
  const setLeftMode = useGitGraphStore((s) => s.setLeftMode);
  // Find Widget（W5）：搜索栏在图谱栏内，工具条按钮切换并保证停在图谱视图。
  const findOpen = useGitGraphStore((s) => s.findOpen);
  const setFindOpen = useGitGraphStore((s) => s.setFindOpen);

  // 进入 Git Graph 视图即全量刷新（状态栏 + 图谱），同时捕获 app 外（终端等）改动。
  useEffect(() => {
    if (repoRoot) void refreshGitAll(repoRoot);
  }, [repoRoot]);

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-2">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-[var(--text-normal)]">
            Git Graph · {remoteBusy ?? (loading ? '加载中…' : `${commitCount} 提交`)}
          </span>
          <div className="flex overflow-hidden rounded-[4px] border border-[var(--background-modifier-border)]">
            {(['graph', 'branches', 'pr'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setLeftMode(m)}
                className={`px-2 py-0.5 text-[12px] ${
                  leftMode === m
                    ? 'bg-[var(--accent)] text-[var(--background-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
                }`}
              >
                {m === 'graph' ? '图谱' : m === 'branches' ? '分支' : 'PR'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="搜索提交（Find）"
            onClick={() => {
              setLeftMode('graph');
              setFindOpen(!findOpen);
            }}
            className={`rounded p-1 ${
              findOpen
                ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]'
            }`}
          >
            <Search size={14} aria-hidden="true" />
          </button>
          <BranchFilter />
          <RepoSettings />
          <span className="mx-0.5 h-4 w-px bg-[var(--background-modifier-border)]" aria-hidden="true" />
          <button
            type="button"
            title="获取（fetch）"
            disabled={busy}
            onClick={() => void fetchRemote()}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:opacity-40"
          >
            <Download size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="拉取（pull）"
            disabled={busy}
            onClick={() => void pullCurrent()}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:opacity-40"
          >
            <ArrowDownToLine size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="推送（push）"
            disabled={busy}
            onClick={() => void pushCurrent()}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:opacity-40"
          >
            <ArrowUpFromLine size={14} aria-hidden="true" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-[var(--background-modifier-border)]" aria-hidden="true" />
          <button
            type="button"
            title="提交更改"
            onClick={() => void commitChanges()}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <GitCommitVertical size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="暂存改动（stash）"
            onClick={() => void stashChanges()}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <Archive size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="刷新"
            onClick={() => repoRoot && void refreshGitAll(repoRoot)}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="关闭（回编辑器）"
            onClick={() => setCentralView('editor')}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel id="graph-list" minSize={300} defaultSize={560} className="h-full">
          {leftMode === 'branches' ? (
            <BranchManager />
          ) : leftMode === 'pr' ? (
            <PullRequestPanel />
          ) : (
            <CommitGraphList />
          )}
        </Panel>
        <Separator className="workbench-separator" />
        <Panel id="graph-detail" minSize={240} defaultSize={340} className="h-full">
          <CommitDetailPanel />
        </Panel>
        <Separator className="workbench-separator" />
        <Panel id="graph-diff" minSize={300} className="h-full">
          <FileDiffPanel />
        </Panel>
      </Group>
    </div>
  );
}
