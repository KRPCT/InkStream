import { describe, expect, it, vi } from 'vitest';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { DEFAULT_LAYOUT } from '../../types/workbench';
import { buildLayoutPatch, createLayoutWriteback } from './layoutPatch';

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
  it('命令式触发（suppressed）不回写中间宽度或任一面板的 collapsed', () => {
    // 展开侧边栏把右侧瞬时挤到 collapsedSize：right.isCollapsed() 误返回 true。
    const sidebar = fakePanel(false, 300);
    const right = fakePanel(true);

    const patch = buildLayoutPatch(sidebar, right, true);

    // 展開/恢复会临时改变两侧宽度；即使当前数值在范围内，也不能持久化。
    expect(patch).toEqual({});
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

  it.each([0, -1, 199, 481, Number.NaN, Number.POSITIVE_INFINITY])('ignores an expanded sidebar measured at %s without losing its remembered width', (width) => {
    const patch = buildLayoutPatch(fakePanel(false, width), fakePanel(false, 320), false);
    expect(patch).toEqual({ rightPanelCollapsed: false, rightPanelWidth: 320 });
    // An existing user's chosen width is independent of the new-session default.
    expect({ ...DEFAULT_LAYOUT, sidebarWidth: 292, ...patch }.sidebarWidth).toBe(292);
  });

  it.each([0, -1, 239, 561, Number.NaN, Number.POSITIVE_INFINITY])('ignores an expanded tool panel measured at %s', (width) => {
    expect(buildLayoutPatch(fakePanel(false, 280), fakePanel(false, width), false)).toEqual({ sidebarCollapsed: false, sidebarWidth: 280 });
  });

  it('keeps legitimate boundary widths despite subpixel rounding', () => {
    expect(buildLayoutPatch(fakePanel(false, 200.0000001), fakePanel(false, 560.0000001), false)).toEqual({
      sidebarCollapsed: false, sidebarWidth: 200, rightPanelCollapsed: false, rightPanelWidth: 560,
    });
  });
});

describe('layout persistence requires a current user resize', () => {
  function setup() {
    const context = { compact: false, blocked: false, projectId: 'first', mode: 'academic', layout: { ...DEFAULT_LAYOUT, sidebarWidth: 280 }, viewportWidth: 1440 };
    const save = vi.fn();
    const writeback = createLayoutWriteback(() => context, save);
    return { context, save, writeback };
  }

  it('does not save startup, window resize, or programmatic recovery measurements', () => {
    const { save, writeback } = setup();
    writeback.commit(fakePanel(false, 0), fakePanel(false, 560));
    writeback.commit(fakePanel(false, 280), fakePanel(false, 560));
    expect(save).not.toHaveBeenCalled();
  });

  it.each(['compact', 'blocked'] as const)('checks live %s at commit even before the next React render', (field) => {
    const { context, save, writeback } = setup();
    writeback.begin();
    context[field] = true;
    writeback.commit(fakePanel(false, 280), fakePanel(false, 560));
    context[field] = false;
    writeback.commit(fakePanel(false, 280), fakePanel(false, 560));
    expect(save).not.toHaveBeenCalled();
    writeback.begin();
    writeback.commit(fakePanel(false, 300), fakePanel(false, 340));
    expect(save).toHaveBeenCalledExactlyOnceWith({ sidebarCollapsed: false, sidebarWidth: 300, rightPanelCollapsed: false, rightPanelWidth: 340 });
  });

  it.each(['projectId', 'mode', 'layout', 'viewportWidth'] as const)('rejects the old gesture after %s changes', (field) => {
    const { context, save, writeback } = setup();
    writeback.begin();
    if (field === 'layout') context.layout = { ...DEFAULT_LAYOUT };
    else if (field === 'viewportWidth') context.viewportWidth = 1200;
    else context[field] = 'changed';
    writeback.commit(fakePanel(false, 300), fakePanel(false, 340));
    expect(save).not.toHaveBeenCalled();
  });

  it('cancels both intermediate restore callbacks without consuming the next real drag', () => {
    const { context, save, writeback } = setup();
    writeback.begin();
    writeback.cancel();
    context.layout = { ...DEFAULT_LAYOUT, sidebarWidth: 280 };
    writeback.commit(fakePanel(false, 280), fakePanel(false, 560));
    writeback.commit(fakePanel(false, 280), fakePanel(false, 320));
    expect(save).not.toHaveBeenCalled();
    writeback.begin();
    writeback.commit(fakePanel(true, 0), fakePanel(false, 340));
    expect(save).toHaveBeenCalledExactlyOnceWith({ sidebarCollapsed: true, rightPanelCollapsed: false, rightPanelWidth: 340 });
    expect(context.layout.sidebarWidth).toBe(280);
  });
});
