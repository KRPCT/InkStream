import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useToastStore } from '../../stores/useToastStore';
import './toast.css';

/**
 * Toast 堆叠宿主（UI-SPEC 组件状态契约）：右下角，宽 320，
 * --background-primary + 1px 边框 + 8px 圆角，左侧 16px 图标
 * （错误 --color-error / 警告 --text-muted），正文 13 --text-normal，
 * 6 秒自动消失（useToastStore 定时），整条可点击关闭。
 */
export default function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2"
      role="region"
      aria-label="通知"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          data-kind={t.kind}
          onClick={() => dismiss(t.id)}
          className="toast-pop flex w-[320px] cursor-pointer items-start gap-2 rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-3 text-left [box-shadow:var(--shadow-popup)]"
        >
          {t.kind === 'error' ? (
            <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-error)]" />
          ) : (
            <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
          )}
          <span className="text-[13px] leading-normal text-[var(--text-normal)]">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
