import { type KeyboardEvent, useEffect, useRef } from 'react';
import { useConfirmStore } from '../../stores/useConfirmStore';

/**
 * 破坏性确认模态——自绘（照 AboutDialog 范式，拒引未审计 tauri-plugin-dialog，
 * T-01-SC / 01-05 决策延续）。
 *
 * 显隐源 useConfirmStore.request：confirmDestructive() 弹出并 await。
 * 遮罩点击 / Esc / 取消按钮 → resolve(false)；确认按钮 → resolve(true)。
 * 确认按钮文本用 --color-error（破坏性），默认聚焦但非 accent 填充（防误确认）。
 */
export default function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  if (!request) return null;
  return <ConfirmPanel />;
}

function ConfirmPanel() {
  const request = useConfirmStore((s) => s.request);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // IN-01：聚焦确认按钮，并记住打开前焦点——关闭时还原（弹层契约 trap+Esc+return）。
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  if (!request) return null;
  const { title, body, confirmLabel, resolve } = request;

  // IN-01 焦点陷阱：Tab/Shift+Tab 在弹层内首尾按钮间循环，焦点绝不逃出模态。
  const trapTab = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button');
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      role="presentation"
      onMouseDown={() => resolve(false)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            resolve(false);
            return;
          }
          trapTab(e);
        }}
        className="w-[400px] rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-5 [box-shadow:var(--shadow-popup)]"
      >
        <p className="text-[15px] font-semibold text-[var(--text-normal)]">{title}</p>
        <p className="mt-2 text-[13px] leading-normal text-[var(--text-muted)]">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => resolve(false)}
            className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          >
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => resolve(true)}
            className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-error)] hover:bg-[var(--background-modifier-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-error)]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
