import ModeIndicator from './ModeIndicator';

/**
 * StatusBar 插槽：高 24px、顶部 1px 边框（UI-SPEC Layout Contract）。
 * 左侧 Phase 2 放文件信息；右侧常驻模式指示器（D-08）。
 */
export default function StatusBar() {
  return (
    <footer
      data-testid="status-bar"
      className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--background-modifier-border)] bg-[var(--background-secondary)] pl-2 text-[12px] text-[var(--text-muted)]"
    >
      <div data-testid="status-bar-left" />
      <div data-testid="status-bar-right" className="h-full">
        <ModeIndicator />
      </div>
    </footer>
  );
}
