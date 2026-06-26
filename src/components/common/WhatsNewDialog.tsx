import { type KeyboardEvent, useEffect, useRef } from 'react';
import { useWhatsNewStore } from '../../stores/useWhatsNewStore';
import Celebration from './Celebration';

/**
 * 更新公告对话框（What's New）——自绘（同 UpdateDialog/ConfirmDialog 范式：store 门控、焦点陷阱、
 * Esc/遮罩关、自绘壳）。显隐源 useWhatsNewStore.open；celebrate 时叠加零依赖恭喜动效。
 * 要点为纯文本逐条渲染（textContent 语义，不进 innerHTML，守 XSS）；配色全用 theme.css token。
 */
export default function WhatsNewDialog() {
  const open = useWhatsNewStore((s) => s.open);
  if (!open) return null;
  return <WhatsNewPanel />;
}

function WhatsNewPanel() {
  const entry = useWhatsNewStore((s) => s.entry);
  const celebrate = useWhatsNewStore((s) => s.celebrate);
  const close = useWhatsNewStore((s) => s.close);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    btnRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  if (!entry) return null;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      // 单按钮模态：焦点不逃出面板。
      e.preventDefault();
      btnRef.current?.focus();
    }
  };

  return (
    <>
      {celebrate ? <Celebration /> : null}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
        role="presentation"
        onMouseDown={close}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="更新公告"
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
          className="w-[440px] max-w-[90vw] rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-5 [box-shadow:var(--shadow-popup)]"
        >
          <p className="text-[15px] font-semibold text-[var(--text-normal)]">{entry.title}</p>
          <p className="mt-1 text-[12px] text-[var(--text-faint)]">
            {entry.version} · {entry.date}
          </p>
          <ul className="mt-3 flex list-none flex-col gap-2">
            {entry.highlights.map((h, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-normal text-[var(--text-muted)]">
                <span aria-hidden="true" className="text-[var(--interactive-accent)]">
                  ·
                </span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex justify-end">
            <button
              ref={btnRef}
              type="button"
              onClick={close}
              className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] font-semibold text-[var(--interactive-accent)] hover:bg-[var(--background-modifier-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--interactive-accent)]"
            >
              开始使用
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
