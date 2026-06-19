import { useEffect, useState } from 'react';
import { ghCommentCreate, ghCommentList } from '../../ipc/git';
import { showToast } from '../../stores/useToastStore';
import type { Comment } from '../../types/git';

/**
 * issue / PR 共用评论线程（GH-02）：列出评论 + 发表评论。number = issue/PR 编号
 * （GitHub 中 PR 即 issue，评论同走 /issues/{n}/comments）。
 */
export default function CommentThread({ repoRoot, number }: { repoRoot: string; number: number }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  // 竞态守卫：number/repoRoot 变化或重载时，旧请求回填判废（与 store selectPr 同纪律）。
  useEffect(() => {
    let cancelled = false;
    void ghCommentList(repoRoot, number)
      .then((cs) => {
        if (!cancelled) setComments(cs);
      })
      .catch(() => {
        /* 评论加载失败静默，不阻断详情主体 */
      });
    return () => {
      cancelled = true;
    };
  }, [repoRoot, number, tick]);

  const submit = async (): Promise<void> => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await ghCommentCreate(repoRoot, number, body.trim());
      setBody('');
      setTick((t) => t + 1);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {comments.map((c) => (
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
      <textarea
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
