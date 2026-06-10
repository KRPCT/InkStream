/**
 * TitleBar 插槽（最小骨架）：高 36px、绝对居中标题（D-03 显示应用名）。
 * 拖拽区 / 窗口控制 / 平台分叉在 Task 2 落地。
 */
export default function TitleBar() {
  return (
    <header
      data-testid="titlebar"
      className="relative flex h-9 shrink-0 items-center border-b border-[var(--background-modifier-border)] bg-[var(--titlebar-background)]"
    >
      <span className="absolute left-1/2 -translate-x-1/2 text-[13px] font-normal text-[var(--text-muted)]">
        InkStream / 墨流
      </span>
    </header>
  );
}
