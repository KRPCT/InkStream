import { useEffect, useRef, useState } from 'react';
import { getAppVersion } from '../../ipc/app';
import { useAboutStore } from '../../stores/useAboutStore';
import { useUpdaterStore } from '../../stores/useUpdaterStore';

/**
 * 关于对话框——自绘模态（UI-SPEC 弹出层契约：--background-primary、8px 圆角、
 * --shadow-popup、遮罩点击/Esc 关闭）。
 * 设计偏差备案：UI-SPEC 写「系统对话框」，但系统对话框需引入未审计的
 * tauri-plugin-dialog，按供应链零信任改自绘（T-01-SC accept，规划期已向用户报备）。
 */
export default function AboutDialog() {
  const open = useAboutStore((s) => s.open);
  if (!open) return null;
  return <AboutPanel />;
}

function AboutPanel() {
  const closeAbout = useAboutStore((s) => s.closeAbout);
  const [version, setVersion] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    void getAppVersion().then((v) => {
      if (alive) setVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="presentation" onMouseDown={closeAbout}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="关于 InkStream"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeAbout();
          }
        }}
        className="w-80 rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-6 text-center [box-shadow:var(--shadow-popup)]"
      >
        <p className="text-[20px] leading-[1.2] font-semibold text-[var(--text-normal)]">
          InkStream / 墨流
        </p>
        <p className="mt-2 text-[13px] leading-normal text-[var(--text-muted)]">
          版本 {version ?? '读取中'}
        </p>
        <button
          type="button"
          onClick={() => {
            closeAbout();
            void useUpdaterStore.getState().checkManual();
          }}
          className="mt-4 rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] text-[var(--interactive-accent)] hover:bg-[var(--background-modifier-hover)]"
        >
          检查更新
        </button>
      </div>
    </div>
  );
}
