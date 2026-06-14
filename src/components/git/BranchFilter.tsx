import { useEffect, useRef, useState } from 'react';
import { ListFilter } from 'lucide-react';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useGitStore } from '../../stores/useGitStore';
import type { BranchInfo } from '../../types/git';

/**
 * Filter Branches（W5）：工具条漏斗按钮 → 下拉分支勾选清单。勾选子集 → 图谱只显示这些分支可达提交
 * （store.filterRefs → git_log refs 过滤，空=全部）。全选/全不选归为「全部」避免空图；含「仅当前」快捷。
 */

function Section({
  label,
  list,
  active,
  onToggle,
}: {
  label: string;
  list: BranchInfo[];
  active: string[];
  onToggle: (name: string) => void;
}) {
  if (list.length === 0) return null;
  return (
    <div>
      <div className="px-2 pt-1.5 text-[10px] font-semibold text-[var(--text-faint)]">{label}</div>
      {list.map((b) => (
        <label
          key={b.name}
          className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
        >
          <input
            type="checkbox"
            checked={active.includes(b.name)}
            onChange={() => onToggle(b.name)}
            className="accent-[var(--accent)]"
          />
          <span className="min-w-0 flex-1 truncate" title={b.name}>
            {b.name}
          </span>
        </label>
      ))}
    </div>
  );
}

export default function BranchFilter() {
  const branches = useGitStore((s) => s.branches);
  const currentBranch = useGitStore((s) => s.status?.branch ?? null);
  const filterRefs = useGitGraphStore((s) => s.filterRefs);
  const setFilterRefs = useGitGraphStore((s) => s.setFilterRefs);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const names = branches.map((b) => b.name);
  const active = filterRefs.length > 0 ? filterRefs : names; // 空 = 全部勾选
  const filtering = filterRefs.length > 0;

  const toggle = (name: string): void => {
    const next = active.includes(name) ? active.filter((n) => n !== name) : [...active, name];
    // 全选或全不选 → 归「全部」（[]），避免空图。
    setFilterRefs(next.length === 0 || next.length === names.length ? [] : next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="筛选分支（Filter Branches）"
        onClick={() => setOpen((v) => !v)}
        className={`rounded p-1 ${
          filtering || open
            ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]'
        }`}
      >
        <ListFilter size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-80 w-56 overflow-y-auto rounded-[6px] border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] py-1 shadow-[0_4px_16px_rgb(0_0_0/0.3)]">
          <div className="flex items-center justify-between px-2 py-1 text-[11px] text-[var(--text-faint)]">
            <span>筛选分支</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setFilterRefs([])} className="hover:text-[var(--text-normal)]">
                全部
              </button>
              {currentBranch ? (
                <button
                  type="button"
                  onClick={() => setFilterRefs([currentBranch])}
                  className="hover:text-[var(--text-normal)]"
                >
                  仅当前
                </button>
              ) : null}
            </div>
          </div>
          <Section label="本地" list={branches.filter((b) => !b.isRemote)} active={active} onToggle={toggle} />
          <Section label="远程" list={branches.filter((b) => b.isRemote)} active={active} onToggle={toggle} />
        </div>
      ) : null}
    </div>
  );
}
