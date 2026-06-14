import type { FileDiff } from '../../types/git';

/**
 * 结构化 diff 渲染（Phase 6 GIT-05）：复用 W1 git_diff 的 FileDiff hunks（origin/+/- + 行号），
 * 逐 hunk 逐行画——增绿删红行背景走 var(--graph-diff-*)（无硬编色）。只读视图。
 *
 * 不用 @codemirror/merge：W1 已给结构化 hunks，自绘更轻、复用 W1、零新依赖；
 * @codemirror/merge 的 accept/reject 价值在 W3 暂存/冲突解决，届时再引。
 */

/** origin → 行背景 CSS 变量。 */
const LINE_BG: Record<string, string | undefined> = {
  '+': 'var(--graph-diff-add-bg)',
  '-': 'var(--graph-diff-del-bg)',
};

export default function DiffHunkView({ fileDiff }: { fileDiff: FileDiff }) {
  if (fileDiff.binary) {
    return <div className="p-3 text-[13px] text-[var(--text-muted)]">二进制文件，不显示 diff</div>;
  }
  if (fileDiff.hunks.length === 0) {
    return <div className="p-3 text-[13px] text-[var(--text-muted)]">无文本变更</div>;
  }
  return (
    <div className="h-full overflow-auto font-mono text-[12px] leading-[1.5]">
      {fileDiff.hunks.map((h, hi) => (
        <div key={hi}>
          <div className="select-none bg-[var(--background-secondary)] px-2 py-0.5 text-[var(--text-muted)]">
            {h.header.trim()}
          </div>
          {h.lines.map((ln, li) => (
            <div key={li} className="flex" style={{ background: LINE_BG[ln.origin] }}>
              <span className="w-10 shrink-0 select-none px-1 text-right text-[var(--text-faint)]">
                {ln.oldLineno ?? ''}
              </span>
              <span className="w-10 shrink-0 select-none px-1 text-right text-[var(--text-faint)]">
                {ln.newLineno ?? ''}
              </span>
              <span className="w-3 shrink-0 select-none text-center text-[var(--text-faint)]">
                {ln.origin === ' ' ? '' : ln.origin}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre text-[var(--text-normal)]">
                {ln.content.replace(/\n$/, '')}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
