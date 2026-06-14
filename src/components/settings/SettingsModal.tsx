import { type KeyboardEvent, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useSettingsUiStore, type SettingsCategory } from '../../stores/useSettingsUiStore';
import { AppearanceSection, EditorSection, GitSection } from './settingsSections';

/**
 * 设置模态（簇②，Obsidian 风：左分类侧栏 + 右内容）。自绘覆盖层（同 ConfirmDialog/AboutDialog 范式）。
 * 遮罩点击 / Esc / ✕ 关闭。设置值改动即写 useSettingsStore（自动防抖落盘），无显式「保存」。
 */
const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: 'appearance', label: '外观' },
  { id: 'editor', label: '编辑器' },
  { id: 'git', label: 'Git' },
];

export default function SettingsModal() {
  const open = useSettingsUiStore((s) => s.open);
  if (!open) return null;
  return <SettingsPanel />;
}

function SettingsPanel() {
  const category = useSettingsUiStore((s) => s.category);
  const setCategory = useSettingsUiStore((s) => s.setCategory);
  const close = useSettingsUiStore((s) => s.closeSettings);
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
        aria-label="设置"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex h-[520px] w-[720px] overflow-hidden rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] [box-shadow:var(--shadow-popup)]"
      >
        <nav className="w-40 shrink-0 border-r border-[var(--background-modifier-border)] bg-[var(--background-secondary)] p-2">
          <div className="px-2 py-1 text-[12px] font-semibold text-[var(--text-muted)]">设置</div>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`mt-0.5 w-full rounded px-2 py-1.5 text-left text-[13px] ${
                category === c.id
                  ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
              }`}
            >
              {c.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-4">
            <span className="text-[14px] font-medium text-[var(--text-normal)]">
              {CATEGORIES.find((c) => c.id === category)?.label}
            </span>
            <button
              type="button"
              onClick={close}
              title="关闭"
              aria-label="关闭设置"
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
            {category === 'appearance' ? <AppearanceSection /> : null}
            {category === 'editor' ? <EditorSection /> : null}
            {category === 'git' ? <GitSection /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
