import { execute } from '../../commands/registry';
import { useEditorStore } from '../../stores/useEditorStore';

/**
 * StatusBar 渲染模式指示器（EDIT-02 / D-05 第三入口）：点击即在 Source ↔ Live Preview 间切换。
 *
 * 仿 ModeIndicator 视觉骨架（8px accent 点 + 12/400 标签 + 四态 class），但无弹层——
 * 二态开关：Live Preview 态文本左侧渲染 accent 状态点，Source 态无点（状态即开关）。
 * 文本色走中性层（--text-muted / hover --text-normal），accent 仅用于状态点（UI-SPEC 强调色禁区）。
 *
 * D-01：非 markdown/richtext 文档 store.activeRenderMode 为 null → return null（指示器隐藏）。
 * 点击经 registry.execute 走命令通道（与命令面板 / Ctrl+E 同源，MRU 一致）。
 */
export default function RenderModeIndicator() {
  const mode = useEditorStore((s) => s.activeRenderMode);
  if (mode === null) return null;

  const isLive = mode === 'live';
  const label = isLive ? 'Live Preview' : 'Source';

  return (
    <button
      type="button"
      data-testid="render-mode-indicator"
      title="切换渲染模式（Ctrl+E）"
      onClick={() => void execute('view.toggle-render-mode')}
      className="flex h-full items-center gap-1.5 px-2 text-[12px] font-normal text-[var(--text-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:bg-[var(--background-modifier-active)]"
    >
      {isLive ? (
        <span
          aria-hidden="true"
          data-testid="render-mode-dot"
          className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]"
        />
      ) : null}
      <span>{label}</span>
    </button>
  );
}
