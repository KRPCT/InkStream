import { TerminalSquare, X } from 'lucide-react';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import TerminalPanel from './TerminalPanel';

/**
 * 内置终端底部 dock（v1.2 #3）：编辑区下方常驻面板，顶部可拖拽改高、标题栏可关闭。
 *
 * 放在 EditorArea 垂直流的 CM 容器**之下**（flex-none，CM 容器 flex-1）——开关只增减本 dock，
 * 绝不动 CM 容器的挂载，单内核与 IME 不受影响。仅 terminalEnabled && terminalOpen 时渲染（见 EditorArea）。
 */
export default function TerminalDock() {
  const height = useWorkbenchStore((s) => s.terminalHeight);
  const setHeight = useWorkbenchStore((s) => s.setTerminalHeight);
  const close = (): void => useWorkbenchStore.getState().setTerminalOpen(false);

  // 拖拽中的 window 监听移除器；dock 在拖拽中途卸载（如拖拽时被禁用）即由卸载副作用清理，绝不泄漏。
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  // 顶边拖拽改高：向上拖增高。监听挂 window 跨出元素也跟手；钳到 [120, 视口 75%]。
  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const max = Math.max(160, Math.floor(window.innerHeight * 0.75));
    const onMove = (ev: PointerEvent): void => {
      setHeight(Math.min(max, Math.max(120, startH + (startY - ev.clientY))));
    };
    const detach = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragCleanup.current = null;
    };
    const onUp = (): void => detach();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dragCleanup.current = detach;
  };

  return (
    <div
      className="flex flex-none flex-col border-t border-[var(--background-modifier-border)] bg-[var(--background-primary)]"
      style={{ height }}
    >
      <div
        onPointerDown={onResizeStart}
        className="h-1 shrink-0 cursor-row-resize bg-transparent hover:bg-[var(--accent)]"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整终端高度"
      />
      <div className="flex h-7 shrink-0 items-center gap-1.5 px-2 text-[12px] text-[var(--text-muted)]">
        <TerminalSquare size={13} className="flex-none text-[var(--text-faint)]" aria-hidden />
        <span className="flex-1">终端</span>
        <button
          type="button"
          onClick={close}
          aria-label="关闭终端"
          className="flex-none rounded-[4px] p-0.5 hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-1">
        <TerminalPanel />
      </div>
    </div>
  );
}
