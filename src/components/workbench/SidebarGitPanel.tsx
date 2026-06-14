import { useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Download,
  GitGraph,
  type LucideIcon,
} from 'lucide-react';
import {
  commitWithMessage,
  fetchRemote,
  pullCurrent,
  pushCurrent,
} from '../../editor/gitActions';
import { useGitStore } from '../../stores/useGitStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import '../../styles/git-graph.css';

/**
 * 侧栏简易源代码管理面板（簇① / 用户需求「左侧栏 git 简易视图，不要反复切视图」）。
 *
 * 折叠区：当前分支 + 变更文件 + 内联提交 + 获取/拉取/推送 + 打开 Git Graph。日常 git 操作不必切到整页 graph。
 * 非 git 工作区（repoRoot null）不显示。复用 useGitStore（状态真相）+ gitActions（写操作编排）。色走 --graph-status-*。
 */

/** W1 文件状态 → 单字母 + git-graph 状态色键。 */
const STATUS: Record<string, { letter: string; color: string }> = {
  untracked: { letter: 'U', color: 'added' },
  new: { letter: 'A', color: 'added' },
  modified: { letter: 'M', color: 'modified' },
  deleted: { letter: 'D', color: 'deleted' },
  renamed: { letter: 'R', color: 'renamed' },
  typechange: { letter: 'T', color: 'typechange' },
  conflicted: { letter: '!', color: 'deleted' },
};

function IconBtn({
  icon: Icon,
  title,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

export default function SidebarGitPanel() {
  const repoRoot = useGitStore((s) => s.repoRoot);
  const status = useGitStore((s) => s.status);
  const [expanded, setExpanded] = useState(true);
  const [message, setMessage] = useState('');

  if (!repoRoot || !status?.branch) return null;
  const files = status.files;

  return (
    <div data-onboarding="git-panel" className="shrink-0 border-t border-[var(--background-modifier-border)]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex h-7 w-full items-center gap-1 px-2 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-normal)]"
      >
        {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <span className="font-medium">源代码管理</span>
        <span className="ml-auto min-w-0 truncate text-[var(--text-faint)]" title={status.branch}>
          {status.branch}
        </span>
        {files.length > 0 ? (
          <span className="shrink-0 rounded-full bg-[var(--background-modifier-active)] px-1.5 text-[11px] text-[var(--text-muted)]">
            {files.length}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="px-2 pb-2">
          <div className="flex items-center gap-0.5 pb-1">
            <IconBtn icon={Download} title="获取（fetch）" onClick={() => void fetchRemote()} />
            <IconBtn icon={ArrowDownToLine} title="拉取（pull）" onClick={() => void pullCurrent()} />
            <IconBtn icon={ArrowUpFromLine} title="推送（push）" onClick={() => void pushCurrent()} />
            <span className="mx-0.5 h-4 w-px bg-[var(--background-modifier-border)]" aria-hidden="true" />
            <IconBtn
              icon={GitGraph}
              title="打开 Git Graph"
              onClick={() => useWorkbenchStore.getState().toggleCentralView('gitGraph')}
            />
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="提交信息（Conventional Commits）"
            className="w-full resize-none rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            disabled={!message.trim() || files.length === 0}
            onClick={async () => {
              if (await commitWithMessage(message)) setMessage('');
            }}
            className="mt-1 w-full rounded-[4px] border border-[var(--background-modifier-border)] py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:cursor-default disabled:text-[var(--text-faint)] disabled:hover:bg-transparent"
          >
            提交{files.length > 0 ? ` (${files.length})` : ''}
          </button>

          <ul className="mt-1 max-h-48 overflow-auto">
            {files.length === 0 ? (
              <li className="py-1 text-[12px] text-[var(--text-faint)]">没有更改</li>
            ) : (
              files.map((f) => {
                const s = STATUS[f.status] ?? STATUS.modified;
                return (
                  <li key={f.path} className="flex items-center gap-2 py-0.5 text-[12px]">
                    <span
                      className="w-3 shrink-0 text-center font-mono"
                      style={{ color: `var(--graph-status-${s.color})` }}
                      title={f.status}
                    >
                      {s.letter}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--text-normal)]" title={f.path}>
                      {f.path}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
