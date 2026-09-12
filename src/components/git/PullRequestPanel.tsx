import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { ghPrCreate, ghPrMerge } from '../../ipc/git';
import { githubPrPage } from '../../ipc/githubPage';
import { openExternal } from '../../ipc/opener';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useGitStore } from '../../stores/useGitStore';
import { showToast } from '../../stores/useToastStore';
import type { MergeMethod, PullRequest } from '../../types/git';
import { useGithubPage } from './useGithubPage';
import GithubPageControls from './GithubPageControls';
import { useGithubScopeKey } from './githubScope';

/**
 * GitHub PR 面板（GIT-07，git-graph 第三视图）：列开放 PR + 内联新建（当前分支→base）+ 合并（merge/squash/rebase）。
 * 数据走 Rust reqwest（token 留 keyring）；未登录 / 无 GitHub 远程 → 后端友好报错，此处呈现指引。
 * 成功无 toast（列表刷新即反馈）；失败 error toast（同 gitActions 纪律）。
 */

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

const METHODS: { key: MergeMethod; label: string }[] = [
  { key: 'merge', label: '合并' },
  { key: 'squash', label: '压缩' },
  { key: 'rebase', label: '变基' },
];

export default function PullRequestPanel() {
  const repoRoot = useGitStore((s) => s.repoRoot);
  const scope = useGithubScopeKey(repoRoot);
  return repoRoot ? <RepositoryPullRequests key={scope} repoRoot={repoRoot} /> : <p className="p-3">当前不是 GitHub 仓库。</p>;
}

function RepositoryPullRequests({ repoRoot }: { repoRoot: string }) {
  const currentBranch = useGitStore((s) => s.status?.branch ?? null);
  const branches = useGitStore((s) => s.branches);
  const selectPr = useGitGraphStore((s) => s.selectPr);
  const loadPage = useCallback((page: number) => githubPrPage(repoRoot, page), [repoRoot]);
  const { data, loading, error, pageNumber, setPageNumber, refresh: load } = useGithubPage(loadPage);
  const prs = data?.items ?? [];
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [base, setBase] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && useGitStore.getState().repoRoot === repoRoot;

  /** 默认 base：main > master > 首个非当前本地分支。 */
  const defaultBase = useMemo(() => {
    const locals = branches.filter((b) => !b.isRemote).map((b) => b.name);
    return (
      locals.find((n) => n === 'main') ??
      locals.find((n) => n === 'master') ??
      locals.find((n) => n !== currentBranch) ??
      'main'
    );
  }, [branches, currentBranch]);

  const submitCreate = async () => {
    if (!current() || !currentBranch || !title.trim() || busy) return;
    setBusy(true);
    try {
      await ghPrCreate(repoRoot, title.trim(), '', base.trim() || defaultBase, currentBranch);
      if (!current()) return;
      setCreating(false);
      setTitle('');
      load();
    } catch (e) {
      if (current()) showToast('error', `新建 PR 失败：${errText(e)}`);
    } finally {
      if (current()) setBusy(false);
    }
  };

  const merge = async (pr: PullRequest, method: MergeMethod) => {
    if (!current() || busy || !prs.includes(pr)) return;
    setBusy(true);
    try {
      const r = await ghPrMerge(repoRoot, pr.number, method, pr.headOid ?? null);
      if (!current()) return;
      if (!r.merged) showToast('warning', `PR #${pr.number} 未合并：${r.message}`);
      load();
    } catch (e) {
      if (current()) showToast('error', `合并 PR #${pr.number} 失败：${errText(e)}`);
    } finally {
      if (current()) setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-2">
        <span className="text-[12px] font-medium text-[var(--text-normal)]">
          Pull Requests{prs.length > 0 ? ` (${prs.length})` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="刷新"
            onClick={() => void load()}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setBase(defaultBase);
              setTitle('');
              setCreating((v) => !v);
            }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <Plus size={13} aria-hidden="true" />
            新建
          </button>
        </div>
      </div>

      {creating ? (
        <div className="space-y-1.5 border-b border-[var(--background-modifier-border)] p-2">
          <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <span className="shrink-0 rounded bg-[var(--background-modifier-active)] px-1 font-medium">
              {currentBranch ?? '?'}
            </span>
            <span className="shrink-0">→</span>
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="目标分支"
              className="min-w-0 flex-1 rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-1.5 py-0.5 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="PR 标题"
            className="w-full rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-1.5 py-1 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-1">
            <button
              type="button"
              disabled={!title.trim() || busy}
              onClick={() => void submitCreate()}
              className="flex-1 rounded border border-[var(--background-modifier-border)] py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:cursor-default disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
            >
              创建
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {loading ? (
          <div className="p-3 text-[12px] text-[var(--text-muted)]">加载中…</div>
        ) : error ? (
          <div className="break-words p-3 text-[12px] text-[var(--text-muted)]">{error}</div>
        ) : prs.length === 0 ? (
          <div className="p-3 text-[12px] text-[var(--text-faint)]">没有开放的 Pull Request</div>
        ) : (
          prs.map((pr) => (
            <div
              key={pr.number}
              className="group border-b border-[var(--background-modifier-border)] px-2 py-2"
            >
              <div className="flex items-center gap-1">
                <span className="shrink-0 text-[11px] text-[var(--text-faint)]">#{pr.number}</span>
                <button
                  type="button"
                  onClick={() => { if (current()) selectPr(pr, repoRoot); }}
                  title={pr.title}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-[var(--text-normal)] hover:text-[var(--accent)]"
                >
                  {pr.title}
                </button>
                <button
                  type="button"
                  title="在浏览器打开"
                  onClick={() => void openExternal(pr.url)}
                  className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
                >
                  <ExternalLink size={12} aria-hidden="true" />
                </button>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[var(--text-faint)]">
                {pr.headRef} → {pr.baseRef} · {pr.author}
                {pr.draft ? ' · 草稿' : ''}
              </div>
              <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {METHODS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    disabled={busy}
                    onClick={() => void merge(pr, m.key)}
                    className="rounded border border-[var(--background-modifier-border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:opacity-40"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <GithubPageControls page={pageNumber} next={data?.nextPage ?? null} loading={loading} onPage={setPageNumber} />
    </div>
  );
}
