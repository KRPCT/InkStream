import type { MouseEvent } from 'react';
import { isMacOS } from '../../ipc/platform';
import { windowControls } from '../../ipc/window';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import MenuBar from './MenuBar';
import WindowControls from './WindowControls';

const APP_TITLE = 'InkStream / 墨流';

interface TitleBarProps {
  /** D-03：可显式覆盖居中标题（测试 / 特殊态）；省略时自 store 三态派生。 */
  title?: string;
}

/**
 * 三态标题（D-03/UI-SPEC）：有活动文件「{文件名} - {vault 名}」/ 无活动文件「{vault 名}」/
 * 无 vault「InkStream / 墨流」。脏态不进标题避免抖动（D-03）。
 */
function useDerivedTitle(): string {
  const vaultName = useVaultStore((s) => s.vault?.name ?? null);
  const activePath = useEditorStore((s) => s.activePath);
  const activeName = useEditorStore((s) =>
    s.activePath ? (s.tabs.find((t) => t.path === s.activePath)?.name ?? null) : null,
  );
  if (!vaultName) return APP_TITLE;
  if (activePath && activeName) return `${activeName} - ${vaultName}`;
  return vaultName;
}

/**
 * 双击拖拽区最大化/还原（A1 防御：不赌 Tauri 内建行为，toggleMaximize 幂等无害）。
 * 仅当事件目标自身挂有拖拽属性时触发——菜单插槽与控制按钮不受双击影响。
 */
function handleDoubleClick(event: MouseEvent<HTMLElement>): void {
  if ((event.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
    void windowControls.toggleMaximize();
  }
}

/**
 * 自绘 TitleBar（D-01 平台分叉）：高 36px，左菜单插槽 + 绝对居中标题 + 右窗口控制。
 * data-tauri-drag-region 不冒泡，只对直接挂载元素生效——容器与居中标题都挂，
 * 菜单插槽与控制按钮不挂（保持可点）。macOS 让出 80px inset 给 overlay 红绿灯。
 */
export default function TitleBar({ title }: TitleBarProps) {
  const mac = isMacOS();
  const derived = useDerivedTitle();
  const shown = title ?? derived;

  return (
    <header
      data-testid="titlebar"
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      className="relative flex h-9 shrink-0 items-center border-b border-[var(--background-modifier-border)] bg-[var(--titlebar-background)]"
    >
      {mac ? <div data-testid="titlebar-mac-inset" className="w-20 shrink-0" /> : null}
      <div data-testid="titlebar-menu-slot" className="flex h-full items-center">
        {/* 菜单元素不挂 drag-region：保持可点，不影响拖拽区命中 */}
        <MenuBar />
      </div>
      <span
        data-tauri-drag-region
        className="absolute left-1/2 -translate-x-1/2 truncate text-[13px] font-normal text-[var(--text-muted)]"
      >
        {shown}
      </span>
      {mac ? null : (
        <div className="ml-auto h-full">
          <WindowControls />
        </div>
      )}
    </header>
  );
}
