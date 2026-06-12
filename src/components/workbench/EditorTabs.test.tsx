import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as registry from '../../commands/registry';
import { useEditorStore } from '../../stores/useEditorStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import EditorTabs from './EditorTabs';

/** 关 tab 时序记录：flush 必须在 dispose/closeTab 之前完成（CR-02）。 */
const closeOrder: string[] = [];
let releaseFlush: (() => void) | null = null;

const flushAutosave = vi.fn().mockResolvedValue(undefined);
const switchTab = vi.fn();
const disposeStateSpy = vi.fn((path: string) => {
  closeOrder.push(`dispose:${path}`);
});

vi.mock('../../stores/autosave', () => ({
  flushAutosave: (path: string) => flushAutosave(path),
}));

vi.mock('../../editor/editorState', () => ({
  // 真实 switchToTab 内部会 setActive；mock 记录调用并复刻 setActive 以校验组件接线。
  switchToTab: (path: string) => {
    switchTab(path);
    useEditorStore.getState().setActive(path);
  },
  disposeState: (path: string) => disposeStateSpy(path),
}));

const confirmDestructive = vi.fn<(opts: unknown) => Promise<boolean>>();
vi.mock('../../stores/useConfirmStore', () => ({
  confirmDestructive: (opts: unknown) => confirmDestructive(opts),
}));

function reset(): void {
  useEditorStore.setState({ tabs: [], activePath: null, dirty: {}, cursor: 0, frozen: {} });
}

describe('EditorTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeOrder.length = 0;
    releaseFlush = null;
    flushAutosave.mockResolvedValue(undefined);
    reset();
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().openTab({ path: 'b.md', name: 'b.md' });
    useEditorStore.getState().setActive('a.md');
  });

  afterEach(() => {
    reset();
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  });

  it('渲染所有打开的 tab', () => {
    render(<EditorTabs />);
    expect(screen.getByText('a.md')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
  });

  it('active tab 标 aria-selected 且有 accent 指示条', () => {
    render(<EditorTabs />);
    const activeTab = screen.getByRole('tab', { name: /a\.md/ });
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
    // active 指示条：accent 语义 class
    expect(activeTab.className).toMatch(/--accent|indicator/);
  });

  it('脏 tab 显示脏圆点（dirty dot）', () => {
    useEditorStore.getState().markDirty('b.md');
    render(<EditorTabs />);
    expect(screen.getByTestId('dirty-dot-b.md')).toBeInTheDocument();
  });

  it('点 inactive tab 触发 switchToTab（snapshot+setActive+setState）', () => {
    render(<EditorTabs />);
    fireEvent.click(screen.getByRole('tab', { name: /b\.md/ }));
    expect(switchTab).toHaveBeenCalledWith('b.md');
    expect(useEditorStore.getState().activePath).toBe('b.md');
  });

  it('关 tab 触发 flushAutosave + disposeState 并从 store 移除', async () => {
    render(<EditorTabs />);
    fireEvent.click(screen.getByTestId('close-tab-a.md'));
    await Promise.resolve();
    await Promise.resolve();
    expect(flushAutosave).toHaveBeenCalledWith('a.md');
    expect(disposeStateSpy).toHaveBeenCalledWith('a.md');
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['b.md']);
  });

  it('CR-02：closeTabFlow 在 disposeState/closeTab 之前 await flushAutosave', async () => {
    // 让 flush 解析受控：record 「flush-start」立即、「flush-end」在 release 时。
    flushAutosave.mockImplementation((path: string) => {
      closeOrder.push(`flush-start:${path}`);
      return new Promise<void>((resolve) => {
        releaseFlush = () => {
          closeOrder.push('flush-end');
          resolve();
        };
      });
    });
    render(<EditorTabs />);
    fireEvent.click(screen.getByTestId('close-tab-a.md'));
    // flush 已开始但未解析：dispose / 移除 tab 绝不能先发生（否则 flush 落错内容）。
    await Promise.resolve();
    expect(closeOrder).toEqual(['flush-start:a.md']);
    expect(disposeStateSpy).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['a.md', 'b.md']);

    // 放行 flush → 之后才 dispose + closeTab。
    releaseFlush?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(closeOrder).toEqual(['flush-start:a.md', 'flush-end', 'dispose:a.md']);
    expect(disposeStateSpy).toHaveBeenCalledWith('a.md');
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['b.md']);
  });

  // ---- 草稿 tab（draft://）关闭流程 ----

  it('关干净草稿 tab：不弹确认、不 flush，直接 dispose + 移除', async () => {
    useEditorStore.getState().openTab({ path: 'draft://1', name: '未命名-1' });
    render(<EditorTabs />);
    fireEvent.click(screen.getByTestId('close-tab-draft://1'));
    await Promise.resolve();
    await Promise.resolve();
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(flushAutosave).not.toHaveBeenCalled();
    expect(disposeStateSpy).toHaveBeenCalledWith('draft://1');
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['a.md', 'b.md']);
  });

  it('关脏草稿 tab：弹丢弃确认，确认后丢弃（不落盘）', async () => {
    useEditorStore.getState().openTab({ path: 'draft://1', name: '未命名-1' });
    useEditorStore.getState().markDirty('draft://1');
    confirmDestructive.mockResolvedValue(true);
    render(<EditorTabs />);
    fireEvent.click(screen.getByTestId('close-tab-draft://1'));
    await Promise.resolve();
    await Promise.resolve();
    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    expect(flushAutosave).not.toHaveBeenCalled();
    expect(disposeStateSpy).toHaveBeenCalledWith('draft://1');
    expect(useEditorStore.getState().tabs.some((t) => t.path === 'draft://1')).toBe(false);
  });

  it('关脏草稿 tab：取消确认则草稿保留', async () => {
    useEditorStore.getState().openTab({ path: 'draft://1', name: '未命名-1' });
    useEditorStore.getState().markDirty('draft://1');
    confirmDestructive.mockResolvedValue(false);
    render(<EditorTabs />);
    fireEvent.click(screen.getByTestId('close-tab-draft://1'));
    await Promise.resolve();
    await Promise.resolve();
    expect(disposeStateSpy).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs.some((t) => t.path === 'draft://1')).toBe(true);
  });

  // ---- R4 §3.2 侧栏 / 右栏一键开关按钮 ----

  it('渲染两端贴边面板开关，默认展开态 aria-pressed=true', () => {
    render(<EditorTabs />);
    const left = screen.getByRole('button', { name: /侧边栏/ });
    const right = screen.getByRole('button', { name: /右侧面板/ });
    // DEFAULT_LAYOUT 两侧均展开（collapsed=false）→ pressed=true
    expect(left).toHaveAttribute('aria-pressed', 'true');
    expect(right).toHaveAttribute('aria-pressed', 'true');
  });

  it('点左开关走 view.toggle-sidebar 命令、右开关走 view.toggle-right-panel', () => {
    const exec = vi.spyOn(registry, 'execute').mockResolvedValue(undefined);
    render(<EditorTabs />);
    fireEvent.click(screen.getByRole('button', { name: /侧边栏/ }));
    fireEvent.click(screen.getByRole('button', { name: /右侧面板/ }));
    expect(exec).toHaveBeenCalledWith('view.toggle-sidebar');
    expect(exec).toHaveBeenCalledWith('view.toggle-right-panel');
    exec.mockRestore();
  });

  it('折叠态 → aria-pressed=false 且 aria-label/标题切到“展开”', () => {
    useWorkbenchStore.getState().toggleSidebar();
    render(<EditorTabs />);
    const left = screen.getByRole('button', { name: /展开侧边栏/ });
    expect(left).toHaveAttribute('aria-pressed', 'false');
  });
});
