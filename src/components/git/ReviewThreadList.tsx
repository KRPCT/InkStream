import { useEffect, useRef, useState } from 'react';
import { ghPrReply, ghPrReviewComments } from '../../ipc/git';
import type { ReviewComment } from '../../types/git';

function Thread({ repoRoot, number, root, replies }: { repoRoot: string; number: number; root: ReviewComment; replies: ReviewComment[] }) {
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<ReviewComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const submit = async () => {
    if (busy || !body.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await ghPrReply(repoRoot, number, root.id, body.trim());
      if (!alive.current) return;
      setSent((previous) => [...previous, response]); setBody('');
    } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (alive.current) setBusy(false); }
  };
  const line = root.line ?? root.originalLine;
  const label = `${root.path}${line === null ? '' : ` 第 ${line} 行`}讨论`;
  const existing = new Set([root.id, ...replies.map((reply) => reply.id)]);
  return <div role="group" aria-label={label} className="mb-3 rounded border border-[var(--background-modifier-border)] p-2 text-[12px]">
    <div className="mb-2 font-medium">{root.path}{line !== null ? `:${line}` : ''}{root.line === null ? ' · 旧版本位置' : ''}</div>
    {root.diffHunk && <details><summary>查看上下文</summary><pre className="max-h-36 overflow-auto whitespace-pre text-[11px]">{root.diffHunk}</pre></details>}
    {[root, ...replies, ...sent.filter((comment) => !existing.has(comment.id))].map((comment) => <div key={comment.id} className="my-2">
      <div className="text-[var(--text-muted)]">{comment.author}</div><div className="whitespace-pre-wrap break-words text-[var(--text-normal)]">{comment.body}</div>
    </div>)}
    <textarea aria-label="回复此讨论" value={body} onChange={(event) => setBody(event.target.value)} disabled={busy} rows={2} maxLength={65_536} className="w-full rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-2" />
    {error && <p role="alert" className="text-[var(--color-error)]">{error}</p>}
    <button type="button" disabled={busy || !body.trim()} onClick={() => void submit()} className="mt-1 rounded border px-2 py-1 disabled:opacity-50">{busy ? '正在回复…' : '回复'}</button>
  </div>;
}

export default function ReviewThreadList({ repoRoot, number }: { repoRoot: string; number: number }) {
  return <Threads key={`${repoRoot}:${number}`} repoRoot={repoRoot} number={number} />;
}

function Threads({ repoRoot, number }: { repoRoot: string; number: number }) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void ghPrReviewComments(repoRoot, number).then((comments) => { if (active) setComments(comments); }, (error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [repoRoot, number, revision]);
  const roots = comments.filter((comment) => comment.inReplyToId === null);
  const rootIds = new Set(roots.map((root) => root.id));
  const orphans = comments.filter((comment) => comment.inReplyToId !== null && !rootIds.has(comment.inReplyToId));
  return <section aria-label="代码审阅讨论" className="mb-3">
    <div className="mb-1 text-[12px] font-semibold text-[var(--text-muted)]">代码审阅讨论</div>
    {loading && <p role="status" className="text-[12px]">正在读取讨论…</p>}
    {error && <div role="alert" className="text-[12px] text-[var(--color-error)]">{error}<button type="button" onClick={() => { setLoading(true); setError(''); setRevision((value) => value + 1); }} className="ml-2 underline">重试</button></div>}
    {!loading && !error && !comments.length && <p className="text-[12px] text-[var(--text-muted)]">暂无代码审阅讨论。</p>}
    {roots.map((root) => <Thread key={root.id} repoRoot={repoRoot} number={number} root={root} replies={comments.filter((comment) => comment.inReplyToId === root.id)} />)}
    {orphans.length > 0 && <p role="alert" className="text-[12px]">有 {orphans.length} 条回复的原讨论不可用，请在 GitHub 查看。</p>}
  </section>;
}
