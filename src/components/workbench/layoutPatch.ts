import type { PanelImperativeHandle } from 'react-resizable-panels';
import type { ModeLayout } from '../../types/workbench';

/**
 * 从 onLayoutChanged 时点的两面板快照派生持久化 patch（UAT #6 互斥缺陷的核心修复点）。
 *
 * `suppressed=true`（命令式 collapse/expand/resize 或模式切换触发的那一拍）只采样展开侧宽度，
 * 绝不回写任一面板的 collapsed —— 否则被瞬时挤到 collapsedSize 的对侧会被误读为折叠并写回 store，
 * 造成「开一侧塌另一侧」的两侧互斥。折叠态的真相源是 store 各自的 toggle（仅翻自己的 flag）。
 *
 * `suppressed=false`（真正的用户拖拽）才从各自快照派生 collapsed，两侧各写各的、互不串扰。
 *
 * 纯函数、无 React 状态依赖：便于在 jsdom 无法驱动库异步测量的环境下直接单测决策逻辑。
 */
export function buildLayoutPatch(
  sidebar: PanelImperativeHandle | null,
  right: PanelImperativeHandle | null,
  suppressed: boolean,
): Partial<ModeLayout> {
  const patch: Partial<ModeLayout> = {};
  if (sidebar) {
    const collapsed = sidebar.isCollapsed();
    if (!suppressed) patch.sidebarCollapsed = collapsed;
    if (!collapsed) patch.sidebarWidth = Math.round(sidebar.getSize().inPixels);
  }
  if (right) {
    const collapsed = right.isCollapsed();
    if (!suppressed) patch.rightPanelCollapsed = collapsed;
    if (!collapsed) patch.rightPanelWidth = Math.round(right.getSize().inPixels);
  }
  return patch;
}
