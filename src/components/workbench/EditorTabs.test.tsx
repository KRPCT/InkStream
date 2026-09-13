import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../stores/useEditorStore';
import type { SaveOutcome } from '../../types/documentSession';
import EditorTabs from './EditorTabs';

/** 关 tab 时序记录：flush 必须在 dispose/closeTab 之前完成（CR-02）。 */
const closeOrder: string[] = [];
let releaseFlush: (() => void) | null = null;

const flushAutosave = vi.fn<(path: string) => Promise<SaveOutcome>>().mockResolvedValue({ kind: 'saved' });
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
  releaseDocumentState: (path: string) => {
    disposeStateSpy(path);
    useEditorStore.getState().closeTab(path);
    return true;
  },
}));

const confirmDestructive = vi.fn<(opts: unknown) => Promise<boolean>>();
vi.mock('../../stores/useConfirmStore', () => ({
  confirmDestructive: (opts: unknown) => confirmDestructive(opts),
}));

function reset(): void {
  useEditorStore.setState({ tabs: [], activePath: null, dirty: {}, cursor: 0, frozen: {}, externalChanged: {} });
}

describe('EditorTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeOrder.length = 0;
    releaseFlush = null;
    flushAutosave.mockResolvedValue({ kind: 'saved' });
    confirmDestructive.mockResolvedValue(false);
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
    flushAutosave.mockImplementation((path: string) => {
      closeOrder.push(`flush-start:${path}`);
      return new Promise<{ kind: 'saved' }>((resolve) => {
        releaseFlush = () => {
          closeOrder.push('flush-end');
          resolve({ kind: 'saved' });
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

  // docs/specs/workbench-ux.feature：WB-05，文档入口、键盘切换与既有关闭裁决。

  it('WB-05：文档栏只承载文档入口及其关闭操作，不重复项目轨的面板开关', () => {
    render(<EditorTabs />);
    const tablist = within(screen.getByRole('tablist', { name: '已打开的文档' }));
    expect(tablist.getAllByRole('tab')).toHaveLength(2);
    const buttons = tablist.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName('关闭 a.md');
    expect(buttons[1]).toHaveAccessibleName('关闭 b.md');
    expect(tablist.queryByRole('button', { name: /侧边栏|右侧面板/ })).not.toBeInTheDocument();
  });

  it('WB-05：Tab 只进入活动文档及其可见关闭按钮，然后离开文档栏', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().setActive('b.md');
    useEditorStore.getState().markDirty('b.md');
    render(<><EditorTabs /><button type="button">后续内容</button></>);

    const activeTab = screen.getByRole('tab', { name: /b\.md/ });
    expect(activeTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /a\.md/ })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: '关闭 a.md' })).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(activeTab).toHaveFocus();

    const closeButton = screen.getByRole('button', { name: '关闭 b.md' });
    expect(closeButton).toBeVisible();
    await user.tab();
    expect(closeButton).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '后续内容' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(closeButton).toHaveFocus();
    expect(closeButton).toBeVisible();
    await user.tab({ shift: true });
    expect(activeTab).toHaveFocus();
  });

  it.each([
    ['{ArrowRight}', 'b.md'],
    ['{ArrowLeft}', 'c.md'],
    ['{End}', 'c.md'],
    ['{ArrowRight}{Home}', 'a.md'],
    ['{End}{ArrowRight}', 'a.md'],
    ['{End}{ArrowLeft}', 'b.md'],
  ])('WB-05：按 %s 后焦点和活动文档切换到 %s，首尾循环', async (keys, name) => {
    const user = userEvent.setup();
    useEditorStore.getState().openTab({ path: 'c.md', name: 'c.md' });
    render(<EditorTabs />);
    await user.tab();
    await user.keyboard(keys);

    const selected = screen.getByRole('tab', { selected: true });
    expect(selected).toHaveTextContent(name);
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute('tabindex', '0');
    for (const tab of screen.getAllByRole('tab', { selected: false })) {
      expect(tab).toHaveAttribute('tabindex', '-1');
    }
    expect(useEditorStore.getState().activePath).toBe(name);
    expect(switchTab).toHaveBeenLastCalledWith(name);
    expect(flushAutosave).not.toHaveBeenCalled();
  });

  it.each(['{Enter}', ' '])('WB-05：按 %s 激活已聚焦的文档入口', async (key) => {
    const user = userEvent.setup();
    render(<EditorTabs />);
    const tab = screen.getByRole('tab', { name: /b\.md/ });
    act(() => tab.focus());
    await user.keyboard(key);
    expect(tab).toHaveFocus();
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('tabindex', '0');
    expect(switchTab).toHaveBeenCalledTimes(1);
    expect(switchTab).toHaveBeenCalledWith('b.md');
  });

  it('WB-05：关闭按钮上的方向键不切文档，回车只执行关闭请求', async () => {
    const user = userEvent.setup();
    flushAutosave.mockResolvedValue({ kind: 'failed' });
    render(<EditorTabs />);
    await user.tab();
    await user.tab();
    const closeButton = screen.getByRole('button', { name: '关闭 a.md' });
    expect(closeButton).toHaveFocus();
    await user.keyboard('{ArrowRight}{Home}{End}');
    expect(closeButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(flushAutosave).toHaveBeenCalledTimes(1);
    expect(flushAutosave).toHaveBeenCalledWith('a.md');
    expect(switchTab).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /a\.md/ })).toHaveAttribute('aria-selected', 'true');
  });

  it.each<{ label: string; outcome: SaveOutcome }>([
    { label: '保存失败', outcome: { kind: 'failed' } },
    { label: '外部冲突', outcome: { kind: 'blocked', reason: 'conflict' } },
    { label: '保存期间修订改变', outcome: { kind: 'changed' } },
    { label: '保存返回后仍有新修改', outcome: { kind: 'saved' } },
  ])('WB-05：键盘关闭遇到$label时保留文档、脏标记及关闭焦点', async ({ outcome }) => {
    const user = userEvent.setup();
    useEditorStore.getState().markDirty('a.md');
    if (outcome.kind === 'blocked') {
      useEditorStore.getState().freezeAutosave('a.md');
      useEditorStore.getState().markExternalChange('a.md');
    }
    flushAutosave.mockResolvedValue(outcome);
    render(<EditorTabs />);
    await user.tab();
    await user.tab();
    const closeButton = screen.getByRole('button', { name: '关闭 a.md' });
    expect(closeButton).toHaveFocus();
    expect(closeButton).toBeVisible();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('tab', { name: /a\.md/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('dirty-dot-a.md')).toBeInTheDocument();
    expect(closeButton).toHaveFocus();
    expect(disposeStateSpy).not.toHaveBeenCalled();
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    if (outcome.kind === 'blocked') {
      expect(useEditorStore.getState().frozen['a.md']).toBe(true);
      expect(useEditorStore.getState().externalChanged['a.md']).toBe(true);
    }
  });

  it('WB-05：键盘关闭脏文档在保存成功清除脏标记后才移除标签', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().markDirty('a.md');
    flushAutosave.mockImplementationOnce(async (path) => {
      useEditorStore.getState().clearDirty(path);
      return { kind: 'saved' };
    });
    render(<EditorTabs />);
    await user.tab();
    await user.tab();
    await user.keyboard(' ');

    await waitFor(() => expect(screen.queryByRole('tab', { name: /a\.md/ })).not.toBeInTheDocument());
    expect(flushAutosave).toHaveBeenCalledWith('a.md');
    expect(screen.getByRole('tab', { name: /b\.md/ })).toHaveAttribute('aria-selected', 'true');
    expect(switchTab).not.toHaveBeenCalled();
  });

  it('WB-05：键盘关闭脏草稿仍可取消丢弃，且不调用落盘', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().openTab({ path: 'draft://1', name: '未命名-1' });
    useEditorStore.getState().markDirty('draft://1');
    render(<EditorTabs />);
    await user.tab();
    await user.keyboard('{End}');
    await user.tab();
    await user.keyboard('{Enter}');

    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    expect(flushAutosave).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /未命名-1/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '关闭 未命名-1' })).toHaveFocus();
    expect(useEditorStore.getState().dirty['draft://1']).toBe(true);
    expect(disposeStateSpy).not.toHaveBeenCalled();
  });

  it('WB-05：键盘可到达外部文档，保留非工作区标记并按原绝对路径关闭', async () => {
    const user = userEvent.setup();
    const path = 'D:/outside/reference.md';
    useEditorStore.getState().openTab({ path, name: 'reference.md', external: true });
    render(<EditorTabs />);
    await user.tab();
    await user.keyboard('{End}');
    const tab = screen.getByRole('tab', { name: /reference\.md/ });
    expect(tab).toHaveFocus();
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(within(tab).getByLabelText('非工作区文件')).toBeInTheDocument();
    expect(within(tab).getByText('reference.md')).toHaveAttribute('title', `非工作区文件：${path}`);
    await user.tab();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('tab', { name: /reference\.md/ })).not.toBeInTheDocument());
    expect(flushAutosave).toHaveBeenCalledWith(path);
    expect(disposeStateSpy).toHaveBeenCalledWith(path);
  });
});
