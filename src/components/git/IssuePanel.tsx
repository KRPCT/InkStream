import { ArrowLeft, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ghIssueCreate, ghIssueList } from '../../ipc/git';
import { openExternal } from '../../ipc/opener';
import { useGitStore } from '../../stores/useGitStore';
import { showToast } from '../../stores/useToastStore';
import type { Issue } from '../../types/git';
import CommentThread from './CommentThread';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type StateFilter = 'open' | 'closed' | 'all';

/** Issue 详情：标题/正文/作者 + 评论线程（GH-02）。 */
function IssueDetail({
  repoRoot,
  issue,
  onBack,
}: {
  repoRoot: string;
  issue: Issue;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex items-center gap-1 self-start text-[12px] text-[var(--text-muted)] hover:text-[var(--text-normal)]"
      >
        <ArrowLeft size={12} aria-hidden="true" /> 返回列表
      </button>
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-medium text-[var(--text-normal)]">
          {issue.title} <span className="text-[var(--text-muted)]">#{issue.number}</span>
        </h3>
        <button
          type="button"
          title="在浏览器打开"
          onClick={() => void openExternal(issue.url)}
          className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-normal)]"
        >
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="mb-3 text-[12px] text-[var(--text-muted)]">
        {issue.author} · {issue.state}
      </div>
      {issue.body ? (
        <div className="mb-3 whitespace-pre-wrap break-words rounded-[4px] bg-[var(--background-primary)] p-2 text-[13px] text-[var(--text-normal)]">
          {issue.body}
        </div>
      ) : null}
      <CommentThread repoRoot={repoRoot} number={issue.number} />
    </div>
  );
}

/**
 * Issues 面板（GH-02）：列出 / 筛选（开放/已关闭/全部）/ 新建 / 点击进详情看评论。
 * 自包含左栏视图（git-graph 'issues' tab）。数据走 Rust reqwest（token 留 keyring）。
 */
export default function IssuePanel() {
  const repoRoot = useGitStore((s) => s.repoRoot);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState<StateFilter>('open');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');

  const [tick, setTick] = useState(0);
  const reload = (): void => setTick((t) => t + 1);

  // 竞态守卫：filter/repoRoot 变化或重载时旧请求回填判废。
  useEffect(() => {
    if (!repoRoot) {
      setIssues([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void ghIssueList(repoRoot, filter)
      .then((is) => {
        if (!cancelled) {
          setIssues(is);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errText(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repoRoot, filter, tick]);

  const submitCreate = async (): Promise<void> => {
    if (!repoRoot || !title.trim()) return;
    try {
      await ghIssueCreate(repoRoot, title.trim(), '');
      setTitle('');
      setCreating(false);
      reload();
    } catch (e) {
      showToast('error', errText(e));
    }
  };

  if (!repoRoot) {
    return <div className="p-4 text-[13px] text-[var(--text-muted)]">当前不是 GitHub 仓库。</div>;
  }
  if (selected) {
    return <IssueDetail repoRoot={repoRoot} issue={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-2">
        <div className="flex overflow-hidden rounded-[4px] border border-[var(--background-modifier-border)]">
          {(['open', 'closed', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-[12px] ${
                filter === f
                  ? 'bg-[var(--accent)] text-[var(--background-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
              }`}
            >
              {f === 'open' ? '开放' : f === 'closed' ? '已关闭' : '全部'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="刷新"
            onClick={reload}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="新建 Issue"
            onClick={() => setCreating((v) => !v)}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {creating ? (
        <div className="flex gap-1 border-b border-[var(--background-modifier-border)] p-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Issue 标题"
            className="flex-1 rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-[13px] text-[var(--text-normal)]"
          />
          <button
            type="button"
            disabled={!title.trim()}
            onClick={() => void submitCreate()}
            className="rounded-[4px] bg-[var(--accent)] px-3 py-1 text-[12px] text-[var(--background-primary)] disabled:opacity-40"
          >
            创建
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="p-3 text-[13px] text-[var(--text-muted)]">加载中…</div>
        ) : error ? (
          <div className="p-3 text-[13px] text-[var(--text-muted)]">加载失败：{error}</div>
        ) : issues.length === 0 ? (
          <div className="p-3 text-[13px] text-[var(--text-muted)]">没有 Issue。</div>
        ) : (
          issues.map((it) => (
            <button
              key={it.number}
              type="button"
              onClick={() => setSelected(it)}
              className="flex w-full flex-col items-start gap-0.5 border-b border-[var(--background-modifier-border)] px-3 py-2 text-left hover:bg-[var(--background-modifier-hover)]"
            >
              <span className="w-full truncate text-[13px] text-[var(--text-normal)]">
                {it.title} <span className="text-[var(--text-muted)]">#{it.number}</span>
              </span>
              <span className="text-[12px] text-[var(--text-muted)]">
                {it.author} · {it.comments} 评论
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
