import { type KeyboardEvent, useEffect, useRef } from 'react';
import { useUpdaterStore } from '../../stores/useUpdaterStore';

/**
 * 自动更新对话框（FEAT-UPDATER）——自绘（同 ConfirmDialog 范式：store 门控、焦点陷阱、Esc/遮罩关、自绘壳）。
 * 显隐源 useUpdaterStore.dialogOpen。按状态切正文 / 按钮：可用→现在更新；下载中→进度条（禁关）；就绪→重启并安装。
 * 配色全用 theme.css token（进度填充 --interactive-accent，无硬编码）；不程序化聚焦编辑器（IME 纪律）。
 */
const SECONDARY =
  'rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]';
const PRIMARY =
  'rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] font-semibold text-[var(--interactive-accent)] hover:bg-[var(--background-modifier-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--interactive-accent)]';

export default function UpdateDialog() {
  const open = useUpdaterStore((s) => s.dialogOpen);
  if (!open) return null;
  return <UpdatePanel />;
}

function UpdatePanel() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const progress = useUpdaterStore((s) => s.progress);
  const install = useUpdaterStore((s) => s.install);
  const relaunch = useUpdaterStore((s) => s.relaunch);
  const closeDialog = useUpdaterStore((s) => s.closeDialog);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    firstBtnRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const trapTab = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const fs = panelRef.current?.querySelectorAll<HTMLElement>('button');
    if (!fs || fs.length === 0) {
      // 下载态无按钮：把焦点收回面板，绝不逃出模态。
      e.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = fs[0];
    const last = fs[fs.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const downloading = status === 'downloading';
  const ready = status === 'ready';
  const errored = status === 'error';
  const pct = ready ? 100 : Math.round(progress * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      role="presentation"
      onMouseDown={downloading ? undefined : closeDialog}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="检查更新"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !downloading) {
            e.preventDefault();
            closeDialog();
            return;
          }
          trapTab(e);
        }}
        className="w-[400px] rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-5 [box-shadow:var(--shadow-popup)]"
      >
        <p className="text-[15px] font-semibold text-[var(--text-normal)]">
          {errored ? '更新失败' : ready ? '更新已就绪' : downloading ? '正在下载更新' : '有可用更新'}
        </p>
        <p className="mt-2 text-[13px] leading-normal text-[var(--text-muted)]">
          {errored
            ? '下载更新时出错，请检查网络后重试。'
            : ready
              ? '新版本已下载完成，重启以应用更新。'
              : downloading
                ? `正在下载 InkStream ${version ?? ''}… ${pct}%`
                : `InkStream ${version ?? ''} 现已可用，是否现在更新？`}
        </p>
        {downloading || ready ? (
          <span
            aria-hidden="true"
            className="mt-3 block h-1.5 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: 'var(--background-modifier-border)' }}
          >
            <span
              className="block h-full rounded-full transition-[width] duration-[var(--duration-fast)]"
              style={{ width: `${pct}%`, backgroundColor: 'var(--interactive-accent)' }}
            />
          </span>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          {!downloading ? (
            <button ref={firstBtnRef} type="button" onClick={closeDialog} className={SECONDARY}>
              {errored ? '关闭' : '稍后'}
            </button>
          ) : null}
          {ready ? (
            <button type="button" onClick={relaunch} className={PRIMARY}>
              重启并安装
            </button>
          ) : errored ? (
            <button type="button" onClick={() => void install()} className={PRIMARY}>
              重试
            </button>
          ) : !downloading ? (
            <button type="button" onClick={() => void install()} className={PRIMARY}>
              现在更新
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
