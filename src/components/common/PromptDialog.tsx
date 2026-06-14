import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { usePromptStore } from '../../stores/usePromptStore';

/**
 * 文本输入模态——自绘（同 ConfirmDialog 范式，拒引未审计 tauri-plugin-dialog）。
 *
 * 显隐源 usePromptStore.request：promptInput() 弹出并 await。遮罩点击/Esc/取消 → resolve(null)；
 * 确认 → resolve(trim 值)。空值禁用确认。**标准 input/textarea，原生 IME**（非 CM 编辑器，无 WebView2 抢焦坑）。
 * 单行 Enter=确认；多行 Ctrl/⌘+Enter=确认、Enter=换行。
 */
export default function PromptDialog() {
  const request = usePromptStore((s) => s.request);
  if (!request) return null;
  // key：每次新请求重挂，value state 从 initialValue 重置。
  return <PromptPanel key={`${request.title}:${request.initialValue}`} />;
}

function PromptPanel() {
  const request = usePromptStore((s) => s.request);
  const [value, setValue] = useState(request?.initialValue ?? '');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select?.();
    return () => prev?.focus?.();
  }, []);

  if (!request) return null;
  const { title, label, placeholder, confirmLabel, multiline, resolve } = request;
  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;
  const submit = (): void => {
    if (canConfirm) resolve(trimmed);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      resolve(null);
      return;
    }
    if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      role="presentation"
      onMouseDown={() => resolve(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-[420px] rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-5 [box-shadow:var(--shadow-popup)]"
      >
        <p className="text-[15px] font-semibold text-[var(--text-normal)]">{title}</p>
        {label ? <p className="mt-1 text-[12px] text-[var(--text-muted)]">{label}</p> : null}
        {multiline ? (
          <textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            className="mt-3 w-full resize-y rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1.5 text-[13px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
          />
        ) : (
          <input
            ref={inputRef as RefObject<HTMLInputElement>}
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            className="mt-3 w-full rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1.5 text-[13px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => resolve(null)}
            className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={submit}
            className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] font-semibold text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-default disabled:text-[var(--text-faint)]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
