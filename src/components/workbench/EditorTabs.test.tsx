import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../stores/useEditorStore';
import EditorTabs from './EditorTabs';

/** 关 tab 时序记录：flush 必须在 dispose/closeTab 之前完成（CR-02）。 */
const closeOrder: string[] = [];
let releaseFlush: (() => void) | null = null;

const flushAutosave = vi.fn().mockResolvedValue(undefined);
const switchTab = vi.fn();
const disposeStateSpy = vi.fn(() => {
  closeOrder.push('dispose');
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
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().openTab({ path: 'b.md', name: 'b.md' });
    useEditorStore.getState().setActive('a.md');
  });

  afterEach(() => {
    reset();
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
    flushAutosave.mockImplementation((_path: string) => {
      closeOrder.push('flush-start');
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
    expect(closeOrder).toEqual(['flush-start']);
    expect(disposeStateSpy).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['a.md', 'b.md']);

    // 放行 flush → 之后才 dispose + closeTab。
    releaseFlush?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(closeOrder).toEqual(['flush-start', 'flush-end', 'dispose']);
    expect(disposeStateSpy).toHaveBeenCalledWith('a.md');
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['b.md']);
  });
});
