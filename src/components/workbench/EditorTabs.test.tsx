import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../stores/useEditorStore';
import EditorTabs from './EditorTabs';

const flushAutosave = vi.fn().mockResolvedValue(undefined);
const switchTab = vi.fn();

vi.mock('../../stores/autosave', () => ({
  flushAutosave: (path: string) => flushAutosave(path),
}));

vi.mock('../../editor/editorState', () => ({
  // 真实 switchToTab 内部会 setActive；mock 记录调用并复刻 setActive 以校验组件接线。
  switchToTab: (path: string) => {
    switchTab(path);
    useEditorStore.getState().setActive(path);
  },
  disposeState: vi.fn(),
}));

function reset(): void {
  useEditorStore.setState({ tabs: [], activePath: null, dirty: {}, cursor: 0, frozen: {} });
}

describe('EditorTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const { disposeState } = await import('../../editor/editorState');
    render(<EditorTabs />);
    fireEvent.click(screen.getByTestId('close-tab-a.md'));
    expect(flushAutosave).toHaveBeenCalledWith('a.md');
    expect(disposeState).toHaveBeenCalledWith('a.md');
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['b.md']);
  });
});
