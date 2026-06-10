/**
 * StatusBar 插槽：高 24px、顶部 1px 边框（UI-SPEC Layout Contract）。
 * 左侧 Phase 2 放文件信息；右侧模式指示器属 Plan 05。
 */
export default function StatusBar() {
  return (
    <footer
      data-testid="status-bar"
      className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--background-modifier-border)] bg-[var(--background-secondary)] px-2 text-[12px] text-[var(--text-muted)]"
    >
      <div data-testid="status-bar-left" />
      <div data-testid="status-bar-right" />
    </footer>
  );
}
