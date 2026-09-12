import { useCallback, useEffect, useRef, useState } from 'react';
import { ghCommentCreate } from '../../ipc/git';
import { githubCommentPage } from '../../ipc/githubPage';
import { showToast } from '../../stores/useToastStore';
import { useGithubPage } from './useGithubPage';
import GithubPageControls from './GithubPageControls';
import type { Comment } from '../../types/git';

/**
 * issue / PR 共用评论线程（GH-02）：列出评论 + 发表评论。number = issue/PR 编号
 * （GitHub 中 PR 即 issue，评论同走 /issues/{n}/comments）。
 */
export default function CommentThread({ repoRoot, number }: { repoRoot: string; number: number }) {
  return <SelectedComments key={`${repoRoot}:${number}`} repoRoot={repoRoot} number={number} />;
}

function SelectedComments({ repoRoot, number }: { repoRoot: string; number: number }) {
  const load = useCallback((page: number) => githubCommentPage(repoRoot, number, page), [repoRoot, number]);
  const { data, error, loading, pageNumber, setPageNumber, refresh } = useGithubPage(load);
  const comments = data?.items ?? [];
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<Comment | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const submit = async (): Promise<void> => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const created = await ghCommentCreate(repoRoot, number, body.trim());
      if (!alive.current) return;
      setPosted(created);
      setBody('');
      refresh();
    } catch (e) {
      if (alive.current) showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-[12px] text-[var(--color-error)]">评论读取失败：{error}<button type="button" className="ml-2 underline" onClick={refresh}>重试</button></p>}
      {loading ? <p role="status">评论加载中…</p> : comments.map((c) => (
        <div
          key={c.id}
          className="rounded-[4px] border border-[var(--background-modifier-border)] p-2"
        >
          <div className="mb-1 text-[12px] text-[var(--text-muted)]">{c.author}</div>
          <div className="whitespace-pre-wrap break-words text-[13px] text-[var(--text-normal)]">
            {c.body}
          </div>
        </div>
      ))}
      <GithubPageControls page={pageNumber} next={data?.nextPage ?? null} loading={loading} onPage={setPageNumber} />
      {posted && !comments.some((comment) => comment.id === posted.id) ? <div role="status" className="rounded border border-[var(--background-modifier-border)] p-2 text-[12px]">
        <p>刚发表的评论</p><p className="whitespace-pre-wrap">{posted.body}</p>
      </div> : null}
      <textarea
        disabled={busy}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="写下评论…"
        rows={3}
        className="w-full resize-y rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-[13px] text-[var(--text-normal)]"
      />
      <button
        type="button"
        disabled={busy || !body.trim()}
        onClick={() => void submit()}
        className="self-end rounded-[4px] bg-[var(--accent)] px-3 py-1 text-[12px] text-[var(--background-primary)] disabled:opacity-40"
      >
        评论
      </button>
    </div>
  );
}
