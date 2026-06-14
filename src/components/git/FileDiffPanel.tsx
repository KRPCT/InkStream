import { useState } from 'react';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import DiffHunkView from './DiffHunkView';
import ProseDiffView from './ProseDiffView';
import type { FileDiff } from '../../types/git';

/**
 * 右栏 diff 容器（Phase 6 GIT-05 + Phase 7 DIFF-02）：顶部「行 / 句」切换。
 * 行 diff = DiffHunkView（结构化 hunk）；句 diff = ProseDiffView（prose-aware 句级语义高亮）。
 * commitFiles 已含所选 commit 全部文件的 hunks（selectCommit 一次拉齐），按 selectedFile 取对应 FileDiff。
 */

function pathOf(f: FileDiff): string {
  return f.newPath ?? f.oldPath ?? '';
}

export default function FileDiffPanel() {
  const files = useGitGraphStore((s) => s.commitFiles);
  const selectedFile = useGitGraphStore((s) => s.selectedFile);
  const [mode, setMode] = useState<'line' | 'prose'>('line');
  const fd = selectedFile ? files.find((f) => pathOf(f) === selectedFile) : null;
  if (!fd) {
    return <div className="p-3 text-[13px] text-[var(--text-muted)]">选择一个文件查看 diff</div>;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-2">
        <span
          className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-muted)]"
          title={pathOf(fd)}
        >
          {pathOf(fd)}
        </span>
        <div className="flex shrink-0 overflow-hidden rounded-[4px] border border-[var(--background-modifier-border)]">
          {(['line', 'prose'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              title={m === 'line' ? '行 diff' : '句级 prose diff'}
              className={`px-2 py-0.5 text-[12px] ${
                mode === m
                  ? 'bg-[var(--accent)] text-[var(--background-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
              }`}
            >
              {m === 'line' ? '行' : '句'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'prose' ? <ProseDiffView fileDiff={fd} /> : <DiffHunkView fileDiff={fd} />}
      </div>
    </div>
  );
}
