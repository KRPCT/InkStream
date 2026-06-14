import { useGitGraphStore } from '../../stores/useGitGraphStore';
import type { FileDiff } from '../../types/git';

/**
 * 提交详情面板（Phase 6 GIT-02/05，三栏中栏）：选中 commit 的 meta + 变更文件列表。
 * meta 取自已加载的 commits（无需再拉）；文件列表取自 commitFiles（selectCommit 拉的 vs 首父 diff）。
 * 点文件 → selectFile 驱动右栏 diff。状态色走 var(--graph-status-*)（无硬编色）。
 */

const STATUS_LABEL: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
};

function pathOf(f: FileDiff): string {
  return f.newPath ?? f.oldPath ?? '';
}

export default function CommitDetailPanel() {
  const selectedOid = useGitGraphStore((s) => s.selectedOid);
  const commits = useGitGraphStore((s) => s.commits);
  const files = useGitGraphStore((s) => s.commitFiles);
  const filesLoading = useGitGraphStore((s) => s.filesLoading);
  const selectedFile = useGitGraphStore((s) => s.selectedFile);
  const selectFile = useGitGraphStore((s) => s.selectFile);

  const commit = selectedOid ? commits.find((c) => c.oid === selectedOid) : null;
  if (!commit) {
    return <div className="p-3 text-[13px] text-[var(--text-muted)]">选择一个提交查看详情</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-x-hidden overflow-y-auto break-words p-3 text-[13px]">
      <div className="font-semibold text-[var(--text-normal)]">{commit.summary}</div>
      {commit.body ? (
        <pre className="mt-1 whitespace-pre-wrap font-mono text-[12px] text-[var(--text-muted)]">
          {commit.body}
        </pre>
      ) : null}
      <dl className="mt-2 space-y-0.5 text-[12px] text-[var(--text-muted)]">
        <div>
          <span className="text-[var(--text-faint)]">提交 </span>
          <span className="font-mono">{commit.oid.slice(0, 10)}</span>
        </div>
        <div>
          <span className="text-[var(--text-faint)]">作者 </span>
          {commit.authorName} &lt;{commit.authorEmail}&gt;
        </div>
        <div>
          <span className="text-[var(--text-faint)]">时间 </span>
          {new Date(commit.authorTime * 1000).toLocaleString()}
        </div>
        {commit.parents.length > 0 ? (
          <div>
            <span className="text-[var(--text-faint)]">父 </span>
            <span className="font-mono">{commit.parents.map((p) => p.slice(0, 8)).join(' ')}</span>
          </div>
        ) : null}
      </dl>

      <div className="mb-1 mt-3 text-[12px] text-[var(--text-faint)]">
        变更文件 {files.length > 0 ? `(${files.length})` : ''}
      </div>
      {filesLoading ? <div className="text-[12px] text-[var(--text-muted)]">加载中…</div> : null}
      <ul className="min-h-0 flex-1">
        {files.map((f) => {
          const path = pathOf(f);
          const active = path === selectedFile;
          return (
            <li key={path}>
              <button
                type="button"
                onClick={() => selectFile(path)}
                className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12px] ${
                  active
                    ? 'bg-[var(--background-modifier-active)]'
                    : 'hover:bg-[var(--background-modifier-hover)]'
                }`}
              >
                <span
                  className="w-3 shrink-0 text-center font-mono"
                  style={{ color: `var(--graph-status-${f.status})` }}
                  title={f.status}
                >
                  {STATUS_LABEL[f.status] ?? 'M'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--text-normal)]" title={path}>
                  {path}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
