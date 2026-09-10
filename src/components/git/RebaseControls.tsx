import { useEffect } from 'react';
import { abortRebase, cancelRebaseExecution, commitPendingRebase, continueRebase, skipRebaseCommit } from '../../editor/gitRebaseActions';
import { captureGitWorktreeScope } from '../../editor/gitWorktreeMutation';
import { useGitRebaseStore } from '../../stores/useGitRebaseStore';
import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

const button = 'rounded border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:opacity-50';

export default function RebaseControls({ compact = false, showResolve = true }: { compact?: boolean; showResolve?: boolean }) {
  const repoRoot = useGitStore((state) => state.repoRoot);
  const vault = useVaultStore((state) => state.vault);
  const state = useGitRebaseStore();
  const load = state.load;
  useEffect(() => { void load(captureGitWorktreeScope()); }, [repoRoot, vault, load]);
  if (!repoRoot || !vault || vault.repoRoot !== repoRoot) return null;
  const belongs = state.scope?.vault === vault && state.scope.repoRoot === repoRoot;
  if (!belongs || state.loading) return <p role="status" className="px-2 py-1 text-[12px] text-[var(--text-muted)]">正在读取变基状态…</p>;
  const status = state.status;
  if (!status?.inProgress && !state.busy && !state.error && !state.outcome) return null;
  return (
    <section aria-label="本地变基" className={`border-b border-[var(--background-modifier-border)] ${compact ? 'p-2' : 'px-3 py-2'}`}>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-normal)]">
        <strong>{state.busy ? (state.cancelling ? '正在停止执行…' : '正在执行本地变基…') : status?.inProgress ? '变基进行中' : state.outcome === 'aborted' ? '已恢复变基前的分支' : state.outcome === 'completed' ? '变基已完成' : '本地变基'}</strong>
        {status?.inProgress && status.step !== null && status.total !== null ? <span>{status.step} / {status.total}</span> : null}
        {status?.branch ? <span className="text-[var(--text-muted)]">{status.branch}</span> : null}
      </div>
      {status?.inProgress ? (
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          {status.source === 'application' ? '本次会话发起，新提交使用签名。' : '外部或先前会话发起，沿用原签名设置。'}
          {status.onto ? ` 目标 ${status.onto.slice(0, 8)}` : ''}
        </p>
      ) : null}
      {state.error ? <p role={state.outcome === 'failed' ? 'alert' : 'status'} className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[12px] text-[var(--text-muted)]">{state.error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1">
        {state.busy ? (
          <button type="button" className={button} disabled={state.cancelling} onClick={() => void cancelRebaseExecution()}>停止执行</button>
        ) : status?.inProgress ? (
          <>
            {showResolve && status.conflicts.length > 0 ? <button type="button" className={button} onClick={() => useWorkbenchStore.getState().setCentralView('mergeResolve')}>解决冲突（{status.conflicts.length}）</button> : null}
            {status.needsCommit && status.currentCommit ? <button type="button" className={button} onClick={() => void commitPendingRebase()}>提交暂存结果并继续</button> : null}
            <button type="button" className={button} disabled={status.conflicts.length > 0 || status.needsCommit} onClick={() => void continueRebase()}>继续变基</button>
            <button type="button" className={button} onClick={() => void skipRebaseCommit()}>跳过当前提交</button>
            <button type="button" className={button} onClick={() => void abortRebase()}>中止变基</button>
          </>
        ) : null}
        <button type="button" className={button} disabled={state.busy} onClick={() => void load(captureGitWorktreeScope())}>刷新变基状态</button>
      </div>
    </section>
  );
}
