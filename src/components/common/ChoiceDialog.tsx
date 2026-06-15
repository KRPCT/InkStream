import { type KeyboardEvent, useEffect, useRef } from 'react';
import { useChoiceStore } from '../../stores/useChoiceStore';

/**
 * 多选确认模态——自绘（照 ConfirmDialog 范式，拒引未审计 tauri-plugin-dialog）。
 *
 * 显隐源 useChoiceStore.request：chooseAction() 弹出并 await。
 * 遮罩点击 / Esc / 取消按钮 → resolve(null)；点选项按钮 → resolve(option.id)。
 * 默认聚焦「取消」（安全默认，回车不误触发切换/提交一类动作）。
 */
export default function ChoiceDialog() {
  const request = useChoiceStore((s) => s.request);
  if (!request) return null;
  return <ChoicePanel />;
}

function ChoicePanel() {
  const request = useChoiceStore((s) => s.request);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  if (!request) return null;
  const { title, body, options, resolve } = request;

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
      onMouseDown={() => resolve(null)}
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
            resolve(null);
            return;
          }
          trapTab(e);
        }}
        className="w-[440px] rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-5 [box-shadow:var(--shadow-popup)]"
      >
        <p className="text-[15px] font-semibold text-[var(--text-normal)]">{title}</p>
        <p className="mt-2 text-[13px] leading-normal text-[var(--text-muted)]">{body}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => resolve(null)}
            className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          >
            取消
          </button>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => resolve(o.id)}
              className={
                'rounded-[4px] px-3 py-1.5 text-[13px] font-semibold ' +
                (o.kind === 'primary'
                  ? 'border border-transparent bg-[var(--accent)] text-[var(--background-primary)] hover:opacity-90'
                  : o.kind === 'danger'
                    ? 'border border-[var(--background-modifier-border)] text-[var(--color-error)] hover:bg-[var(--background-modifier-hover)]'
                    : 'border border-[var(--background-modifier-border)] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]')
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
