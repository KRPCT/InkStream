import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { useGitGraphStore } from '../../stores/useGitGraphStore';

/**
 * Repository Settings（W5）：工具条齿轮按钮 → 下拉。加载提交数（影响 git_log limit，改即重载）+
 * 日期格式（绝对/相对，影响提交行日期列）。会话级（存 useGitGraphStore）。
 */

const LIMITS = [100, 500, 1000];

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded border border-[var(--background-modifier-border)] py-0.5 text-[12px] ${
        active
          ? 'bg-[var(--accent)] text-[var(--background-primary)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
      }`}
    >
      {children}
    </button>
  );
}

export default function RepoSettings() {
  const graphLimit = useGitGraphStore((s) => s.graphLimit);
  const setGraphLimit = useGitGraphStore((s) => s.setGraphLimit);
  const dateRelative = useGitGraphStore((s) => s.dateRelative);
  const setDateRelative = useGitGraphStore((s) => s.setDateRelative);
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="仓库设置（Repository Settings）"
        onClick={() => setOpen((v) => !v)}
        className={`rounded p-1 ${
          open
            ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]'
        }`}
      >
        <Settings size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-[6px] border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] p-2 shadow-[0_4px_16px_rgb(0_0_0/0.3)]">
          <div className="text-[11px] font-semibold text-[var(--text-faint)]">仓库设置</div>
          <div className="mt-2 text-[12px] text-[var(--text-normal)]">加载提交数</div>
          <div className="mt-1 flex gap-1">
            {LIMITS.map((n) => (
              <Seg key={n} active={graphLimit === n} onClick={() => setGraphLimit(n)}>
                {String(n)}
              </Seg>
            ))}
          </div>
          <div className="mt-3 text-[12px] text-[var(--text-normal)]">日期格式</div>
          <div className="mt-1 flex gap-1">
            <Seg active={!dateRelative} onClick={() => setDateRelative(false)}>
              绝对
            </Seg>
            <Seg active={dateRelative} onClick={() => setDateRelative(true)}>
              相对
            </Seg>
          </div>
        </div>
      ) : null}
    </div>
  );
}
