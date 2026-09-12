import { useEffect } from 'react';
import { deleteStash, restoreStash, stashChanges } from '../../editor/gitStashActions';
import { captureGitWorktreeScope } from '../../editor/gitWorktreeMutation';
import { useGitRebaseStore } from '../../stores/useGitRebaseStore';
import { useGitStashStore } from '../../stores/useGitStashStore';
import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';

const button = 'rounded border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:opacity-40';

export default function StashPanel() {
  const root = useGitStore((state) => state.repoRoot);
  const vault = useVaultStore((state) => state.vault);
  const state = useGitStashStore();
  const rebase = useGitRebaseStore();
  const load = state.load;
  useEffect(() => { void load(captureGitWorktreeScope()); }, [root, vault, load]);
  const belongs = state.scope?.vault === vault && state.scope?.repoRoot === root;
  const entries = belongs ? state.entries : [];
  const loading = !belongs || state.loading;
  const rebasing = rebase.scope?.vault === vault && rebase.scope?.repoRoot === root && (rebase.busy || rebase.status?.inProgress);
  const disabled = loading || state.busy || rebasing;

  if (!root || !vault || vault.repoRoot !== root) {
    return <p className="p-3 text-[13px] text-[var(--text-muted)]">请先打开 Git 工作区。</p>;
  }

  return (
    <section aria-label="暂存记录列表" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--background-modifier-border)] p-2">
        <span className="text-[13px] text-[var(--text-normal)]">暂存记录（stash）</span>
        <div className="flex gap-1">
          <button type="button" className={button} disabled={disabled} onClick={() => void stashChanges()}>暂存当前改动</button>
          <button type="button" className={button} disabled={state.busy} onClick={() => void load(captureGitWorktreeScope())}>刷新列表</button>
        </div>
      </div>
      {belongs && state.error ? <p role="alert" className="p-2 text-[12px] text-[var(--text-muted)]">{state.error}</p> : null}
      {loading ? <p role="status" className="p-2 text-[12px] text-[var(--text-muted)]">正在读取暂存记录…</p> : !state.error && entries.length === 0 ? <p className="p-3 text-[13px] text-[var(--text-muted)]">没有暂存记录</p> : null}
      <ul className="min-h-0 flex-1 overflow-auto p-2">
        {entries.map((entry) => (
          <li key={`${entry.index}:${entry.oid}`} className="mb-2 rounded border border-[var(--background-modifier-border)] p-2">
            <div className="flex gap-2 text-[11px] text-[var(--text-muted)]"><span>stash@{'{' + entry.index + '}'}</span><span className="font-mono">{entry.oid.slice(0, 8)}</span></div>
            <p className="my-1 break-words text-[13px] text-[var(--text-normal)]">{entry.message}</p>
            <div className="flex gap-1">
              <button type="button" className={button} disabled={disabled} onClick={() => state.scope && void restoreStash(state.scope, entry)}>恢复并移除</button>
              <button type="button" className={button} disabled={disabled} onClick={() => state.scope && void deleteStash(state.scope, entry)}>删除记录</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
