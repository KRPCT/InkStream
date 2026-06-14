import { type KeyboardEvent, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useHelpStore, type HelpTopic } from '../../stores/useHelpStore';
import {
  BranchingSection,
  ShortcutsSection,
  StartSection,
  SyncSection,
  VersioningSection,
} from './helpContent';

/**
 * 帮助/教程模态（簇③）：左主题侧栏 + 右图文教学。自绘覆盖层（同 SettingsModal 范式）。
 * 教 git 提交/回滚/分支/合并/多设备同步——文案非拟人化、贴合实际 UI。
 */
const TOPICS: { id: HelpTopic; label: string }[] = [
  { id: 'start', label: '快速上手' },
  { id: 'versioning', label: '版本管理' },
  { id: 'branching', label: '分支与合并' },
  { id: 'sync', label: '多设备同步' },
  { id: 'shortcuts', label: '快捷键' },
];

export default function HelpModal() {
  const open = useHelpStore((s) => s.open);
  if (!open) return null;
  return <HelpPanel />;
}

function HelpPanel() {
  const topic = useHelpStore((s) => s.topic);
  const setTopic = useHelpStore((s) => s.setTopic);
  const close = useHelpStore((s) => s.closeHelp);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      role="presentation"
      onMouseDown={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="帮助与教程"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex h-[560px] w-[760px] overflow-hidden rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] [box-shadow:var(--shadow-popup)]"
      >
        <nav className="w-40 shrink-0 border-r border-[var(--background-modifier-border)] bg-[var(--background-secondary)] p-2">
          <div className="px-2 py-1 text-[12px] font-semibold text-[var(--text-muted)]">帮助与教程</div>
          {TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTopic(t.id)}
              className={`mt-0.5 w-full rounded px-2 py-1.5 text-left text-[13px] ${
                topic === t.id
                  ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-4">
            <span className="text-[14px] font-medium text-[var(--text-normal)]">
              {TOPICS.find((t) => t.id === topic)?.label}
            </span>
            <button
              type="button"
              onClick={close}
              title="关闭"
              aria-label="关闭帮助"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-2">
            {topic === 'start' ? <StartSection /> : null}
            {topic === 'versioning' ? <VersioningSection /> : null}
            {topic === 'branching' ? <BranchingSection /> : null}
            {topic === 'sync' ? <SyncSection /> : null}
            {topic === 'shortcuts' ? <ShortcutsSection /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
