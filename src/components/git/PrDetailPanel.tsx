import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ghPrReviewCreate, ghPrReviews } from '../../ipc/git';
import { openExternal } from '../../ipc/opener';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useGitStore } from '../../stores/useGitStore';
import { showToast } from '../../stores/useToastStore';
import type { Review, ReviewEvent } from '../../types/git';
import CommentThread from './CommentThread';

const REVIEW_ACTIONS: Array<{ event: ReviewEvent; label: string }> = [
  { event: 'APPROVE', label: '批准' },
  { event: 'REQUEST_CHANGES', label: '请求修改' },
  { event: 'COMMENT', label: '评论' },
];

/**
 * PR 详情（GH-03，git-graph 中栏）：标题/正文 + review 列表 + 提交 review（批准/请求修改/评论）+ 评论线程。
 * 选中 PR 时由 useGitGraphStore.selectPr 同步把该 PR 的文件 diff 灌入 commitFiles，右栏 FileDiffPanel 复用渲染。
 */
export default function PrDetailPanel() {
  const repoRoot = useGitStore((s) => s.repoRoot);
  const pr = useGitGraphStore((s) => s.selectedPr);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewBody, setReviewBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  // 竞态守卫：切换 PR（pr 变）时旧 review 请求回填判废。
  useEffect(() => {
    if (!repoRoot || !pr) return;
    let cancelled = false;
    void ghPrReviews(repoRoot, pr.number)
      .then((rs) => {
        if (!cancelled) setReviews(rs);
      })
      .catch(() => {
        /* review 加载失败静默 */
      });
    return () => {
      cancelled = true;
    };
  }, [repoRoot, pr, tick]);

  if (!repoRoot || !pr) {
    return <div className="p-4 text-[13px] text-[var(--text-muted)]">选择一个 PR 查看详情。</div>;
  }

  const submitReview = async (event: ReviewEvent): Promise<void> => {
    if (event !== 'APPROVE' && !reviewBody.trim()) {
      showToast('warning', '「请求修改」与「评论」需要填写内容。');
      return;
    }
    setBusy(true);
    try {
      await ghPrReviewCreate(repoRoot, pr.number, event, reviewBody.trim());
      setReviewBody('');
      setTick((t) => t + 1);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-medium text-[var(--text-normal)]">
          {pr.title} <span className="text-[var(--text-muted)]">#{pr.number}</span>
        </h3>
        <button
          type="button"
          title="在浏览器打开"
          onClick={() => void openExternal(pr.url)}
          className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-normal)]"
        >
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="mb-3 text-[12px] text-[var(--text-muted)]">
        {pr.author} · {pr.headRef} → {pr.baseRef}
      </div>
      {pr.body ? (
        <div className="mb-3 whitespace-pre-wrap break-words rounded-[4px] bg-[var(--background-primary)] p-2 text-[13px] text-[var(--text-normal)]">
          {pr.body}
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1 text-[12px] font-semibold text-[var(--text-muted)]">Review</div>
          {reviews.map((r) => (
            <div key={r.id} className="py-0.5 text-[12px] text-[var(--text-muted)]">
              <span className="text-[var(--text-normal)]">{r.author}</span> · {r.state}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-3 flex flex-col gap-1">
        <textarea
          value={reviewBody}
          onChange={(e) => setReviewBody(e.target.value)}
          placeholder="Review 评语（批准可留空）…"
          rows={2}
          className="w-full resize-y rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-[13px] text-[var(--text-normal)]"
        />
        <div className="flex gap-1 self-end">
          {REVIEW_ACTIONS.map((a) => (
            <button
              key={a.event}
              type="button"
              disabled={busy}
              onClick={() => void submitReview(a.event)}
              className="rounded-[4px] border border-[var(--background-modifier-border)] px-2 py-0.5 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-1 text-[12px] font-semibold text-[var(--text-muted)]">评论</div>
      <CommentThread repoRoot={repoRoot} number={pr.number} />
    </div>
  );
}
