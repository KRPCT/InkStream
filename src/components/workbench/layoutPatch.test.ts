import { describe, expect, it } from 'vitest';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { buildLayoutPatch } from './layoutPatch';

/** 仅暴露 onLayoutChanged 时点会读到的快照方法的假面板句柄。 */
function fakePanel(collapsed: boolean, pixels = 280): PanelImperativeHandle {
  return {
    isCollapsed: () => collapsed,
    getSize: () => ({ asPercentage: 0, inPixels: pixels }),
    collapse: () => {},
    expand: () => {},
    resize: () => {},
  };
}

// UAT #6：侧边栏与右侧面板必须互相独立——派生 patch 的决策逻辑是修复点本体。
// jsdom 无法驱动库的异步测量（对侧被瞬时挤压不复现），故对纯决策函数直接取测。
describe('buildLayoutPatch (UAT #6 面板独立性)', () => {
  it('命令式触发（suppressed）只采样展开侧宽度，绝不回写任一面板的 collapsed', () => {
    // 展开侧边栏把右侧瞬时挤到 collapsedSize：right.isCollapsed() 误返回 true。
    const sidebar = fakePanel(false, 300);
    const right = fakePanel(true);

    const patch = buildLayoutPatch(sidebar, right, true);

    // 互斥缺陷的根因：suppressed 拍绝不能写 collapsed（这正是被回写后塌掉对侧的那一步）。
    expect(patch).not.toHaveProperty('sidebarCollapsed');
    expect(patch).not.toHaveProperty('rightPanelCollapsed');
    expect(patch.sidebarWidth).toBe(300);
    // 被挤到 collapsedSize 的对侧不采样宽度，避免把瞬时 0 宽写回。
    expect(patch).not.toHaveProperty('rightPanelWidth');
  });

  it('真正的用户拖拽（非 suppressed）才从各自快照派生 collapsed，两侧各写各的', () => {
    const sidebar = fakePanel(false, 260);
    const right = fakePanel(false, 340);

    const patch = buildLayoutPatch(sidebar, right, false);

    expect(patch.sidebarCollapsed).toBe(false);
    expect(patch.rightPanelCollapsed).toBe(false);
    expect(patch.sidebarWidth).toBe(260);
    expect(patch.rightPanelWidth).toBe(340);
  });

  it('用户拖拽折叠侧边栏：只写 sidebarCollapsed，右侧 flag 来自右侧自己的快照', () => {
    const sidebar = fakePanel(true);
    const right = fakePanel(false, 320);

    const patch = buildLayoutPatch(sidebar, right, false);

    expect(patch.sidebarCollapsed).toBe(true);
    expect(patch.rightPanelCollapsed).toBe(false);
    expect(patch.rightPanelWidth).toBe(320);
    expect(patch).not.toHaveProperty('sidebarWidth');
  });

  it('面板 ref 尚未挂载（null）时安全返回空 patch', () => {
    expect(buildLayoutPatch(null, null, false)).toEqual({});
    expect(buildLayoutPatch(null, null, true)).toEqual({});
  });
});
