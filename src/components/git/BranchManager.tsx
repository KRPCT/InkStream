import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  GitBranch,
  GitMerge,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  checkoutTarget,
  createBranchAt,
  deleteBranchNamed,
  mergeBranchInto,
  pullCurrent,
  pushCurrent,
} from '../../editor/gitActions';
import { useGitStore } from '../../stores/useGitStore';
import type { BranchInfo } from '../../types/git';

/**
 * 分支管理（参考 GitButler 的清晰可操作 UX，非虚拟分支引擎）：当前/本地/远程分组的卡片列表，
 * 每分支一键 切换/合并到当前/删除；当前分支显 ahead/behind + 拉取/推送。远胜右键菜单的可发现性。
 * 数据源 useGitStore.branches（git_branch_list，含 ahead/behind/isHead/upstream）；操作复用 gitActions（含确认/刷新）。
 */

function IconBtn({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
    >
      <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

function AheadBehind({ ahead, behind }: { ahead: number; behind: number }) {
  if (ahead === 0 && behind === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-faint)]">
      {ahead > 0 ? <span title={`领先远程 ${ahead} 个提交`}>↑{ahead}</span> : null}
      {behind > 0 ? <span title={`落后远程 ${behind} 个提交`}>↓{behind}</span> : null}
    </span>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-[var(--text-faint)]">{children}</div>
  );
}

function BranchRow({ b }: { b: BranchInfo }) {
  return (
    <div className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--background-modifier-hover)]">
      <GitBranch size={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-normal)]" title={b.name}>
        {b.name}
      </span>
      <AheadBehind ahead={b.ahead} behind={b.behind} />
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconBtn icon={Check} title="切换到此分支" onClick={() => void checkoutTarget(b.name)} />
        <IconBtn icon={GitMerge} title="合并到当前分支" onClick={() => void mergeBranchInto(b.name)} />
        {b.isRemote ? null : (
          <IconBtn icon={Trash2} title="删除分支" onClick={() => void deleteBranchNamed(b.name)} />
        )}
      </div>
    </div>
  );
}

function CurrentBranchCard({ b }: { b: BranchInfo }) {
  return (
    <div className="mx-1 rounded-[6px] border border-[var(--accent)] bg-[var(--background-modifier-active)] px-2 py-2">
      <div className="flex items-center gap-2">
        <GitBranch size={14} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-normal)]" title={b.name}>
          {b.name}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--accent)] px-1.5 text-[10px] text-[var(--background-primary)]">
          当前
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-muted)]">
          {b.upstream ? `跟踪 ${b.upstream}` : '未关联远程分支'}
        </span>
        <div className="flex items-center gap-1">
          <AheadBehind ahead={b.ahead} behind={b.behind} />
          <IconBtn icon={ArrowDownToLine} title="拉取（pull）" onClick={() => void pullCurrent()} />
          <IconBtn icon={ArrowUpFromLine} title="推送（push）" onClick={() => void pushCurrent()} />
        </div>
      </div>
    </div>
  );
}

export default function BranchManager() {
  const branches = useGitStore((s) => s.branches);
  const current = branches.find((b) => b.isHead) ?? null;
  const locals = branches.filter((b) => !b.isRemote && !b.isHead);
  const remotes = branches.filter((b) => b.isRemote);

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-2">
        <span className="text-[12px] font-medium text-[var(--text-normal)]">分支管理</span>
        <button
          type="button"
          onClick={() => void createBranchAt(null)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          <Plus size={13} aria-hidden="true" />
          新建
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {current ? (
          <>
            <SectionLabel>当前分支</SectionLabel>
            <CurrentBranchCard b={current} />
          </>
        ) : (
          <div className="px-2 py-2 text-[12px] text-[var(--text-muted)]">未在分支上（detached HEAD）。</div>
        )}
        {locals.length > 0 ? (
          <>
            <SectionLabel>本地分支</SectionLabel>
            {locals.map((b) => (
              <BranchRow key={b.name} b={b} />
            ))}
          </>
        ) : null}
        {remotes.length > 0 ? (
          <>
            <SectionLabel>远程分支</SectionLabel>
            {remotes.map((b) => (
              <BranchRow key={b.name} b={b} />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
