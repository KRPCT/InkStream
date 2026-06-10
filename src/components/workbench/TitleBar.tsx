import type { MouseEvent } from 'react';
import { isMacOS } from '../../ipc/platform';
import { windowControls } from '../../ipc/window';
import MenuBar from './MenuBar';
import WindowControls from './WindowControls';

interface TitleBarProps {
  /** D-03：Phase 1 显示应用名；Phase 2 接入工作区后换「文件名 - vault 名」。 */
  title?: string;
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
export default function TitleBar({ title = 'InkStream / 墨流' }: TitleBarProps) {
  const mac = isMacOS();

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
        className="absolute left-1/2 -translate-x-1/2 text-[13px] font-normal text-[var(--text-muted)]"
      >
        {title}
      </span>
      {mac ? null : (
        <div className="ml-auto h-full">
          <WindowControls />
        </div>
      )}
    </header>
  );
}
