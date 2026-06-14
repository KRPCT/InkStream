import { useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  GitCommitVertical,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  commitChanges,
  fetchRemote,
  pullCurrent,
  pushCurrent,
  stashChanges,
} from '../../editor/gitActions';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useGitStore } from '../../stores/useGitStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
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
  const loadLog = useGitGraphStore((s) => s.loadLog);
  const loading = useGitGraphStore((s) => s.loading);
  const commitCount = useGitGraphStore((s) => s.commits.length);
  const remoteBusy = useGitGraphStore((s) => s.remoteBusy);
  const setCentralView = useWorkbenchStore((s) => s.setCentralView);
  const busy = remoteBusy !== null;

  useEffect(() => {
    if (repoRoot) void loadLog(repoRoot);
  }, [repoRoot, loadLog]);

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-2">
        <span className="text-[13px] font-medium text-[var(--text-normal)]">
          Git Graph · {remoteBusy ?? (loading ? '加载中…' : `${commitCount} 提交`)}
        </span>
        <div className="flex items-center gap-1">
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
            onClick={() => repoRoot && void loadLog(repoRoot)}
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
          <CommitGraphList />
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
