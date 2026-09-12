import type { PanelImperativeHandle } from 'react-resizable-panels';
import type { ModeLayout } from '../../types/workbench';

/**
 * 从 onLayoutChanged 时点的两面板快照派生持久化 patch（UAT #6 互斥缺陷的核心修复点）。
 *
 * `suppressed=true`（命令式恢复、窗口或项目切换）不写任何几何。
 * 这些中间快照可能把展开面板测成 0 或把另一侧挤到最大宽度；均不是用户记忆布局。
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
  if (suppressed) return patch;
  if (sidebar) {
    const collapsed = sidebar.isCollapsed();
    const width = Math.round(sidebar.getSize().inPixels);
    if (collapsed) patch.sidebarCollapsed = true;
    else if (Number.isFinite(width) && width >= 200 && width <= 480) {
      patch.sidebarCollapsed = false;
      patch.sidebarWidth = width;
    }
  }
  if (right) {
    const collapsed = right.isCollapsed();
    const width = Math.round(right.getSize().inPixels);
    if (collapsed) patch.rightPanelCollapsed = true;
    else if (Number.isFinite(width) && width >= 240 && width <= 560) {
      patch.rightPanelCollapsed = false;
      patch.rightPanelWidth = width;
    }
  }
  return patch;
}

interface LayoutContext {
  compact: boolean;
  blocked: boolean;
  projectId: string | null;
  mode: string;
  layout: ModeLayout;
  viewportWidth: number;
}

/** Only a separator interaction can author a saved layout; measurements alone cannot. */
export function createLayoutWriteback(read: () => LayoutContext, save: (patch: Partial<ModeLayout>) => void) {
  let intent: LayoutContext | null = null;
  return {
    begin() {
      const current = read();
      intent = current.compact || current.blocked ? null : { ...current };
    },
    cancel() { intent = null; },
    commit(sidebar: PanelImperativeHandle | null, right: PanelImperativeHandle | null) {
      const pending = intent;
      intent = null;
      const current = read();
      if (!pending || current.compact || current.blocked || pending.projectId !== current.projectId ||
        pending.mode !== current.mode || pending.layout !== current.layout || pending.viewportWidth !== current.viewportWidth) return;
      const patch = buildLayoutPatch(sidebar, right, false);
      if (Object.keys(patch).length) save(patch);
    },
  };
}
