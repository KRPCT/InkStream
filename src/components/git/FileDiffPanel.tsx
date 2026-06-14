import { useGitGraphStore } from '../../stores/useGitGraphStore';
import DiffHunkView from './DiffHunkView';
import type { FileDiff } from '../../types/git';

/**
 * 右栏 diff 容器（Phase 6 GIT-05）：显示当前选中文件的结构化 diff。
 * commitFiles 已含所选 commit 全部文件的 hunks（selectCommit 一次拉齐），按 selectedFile 取对应 FileDiff。
 */

function pathOf(f: FileDiff): string {
  return f.newPath ?? f.oldPath ?? '';
}

export default function FileDiffPanel() {
  const files = useGitGraphStore((s) => s.commitFiles);
  const selectedFile = useGitGraphStore((s) => s.selectedFile);
  const fd = selectedFile ? files.find((f) => pathOf(f) === selectedFile) : null;
  if (!fd) {
    return <div className="p-3 text-[13px] text-[var(--text-muted)]">选择一个文件查看 diff</div>;
  }
  return <DiffHunkView fileDiff={fd} />;
}
