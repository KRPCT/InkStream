import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import type { TabId } from '../../types/workbench';
import PanelTabs from './PanelTabs';
import RightPanel from './RightPanel';

const tabs: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'outline', label: '大纲' },
  { id: 'backlinks', label: '反链' },
  { id: 'localGraph', label: '局部图谱' },
];

function ControlledTabs({ initialTab = 'outline' }: { initialTab?: TabId }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  return (
    <>
      <PanelTabs tabs={tabs} activeTab={activeTab} onSelect={setActiveTab} />
      <button type="button">后续内容</button>
    </>
  );
}

// docs/specs/workbench-ux.feature：WB-05，通过键盘操作观察焦点、选择与实际内容面板。
describe('PanelTabs WB-05 工具标签键盘切换', () => {
  it('WB-05：Tab 只进入活动工具，方向键切换后 Tab 离开标签栏', async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initialTab="backlinks" />);
    const backlinks = screen.getByRole('tab', { name: '反链' });
    expect(backlinks).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '大纲' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: '局部图谱' })).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(backlinks).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    const graph = screen.getByRole('tab', { name: '局部图谱' });
    expect(graph).toHaveFocus();
    expect(graph).toHaveAttribute('aria-selected', 'true');
    expect(graph).toHaveAttribute('tabindex', '0');
    expect(backlinks).toHaveAttribute('aria-selected', 'false');
    expect(backlinks).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(screen.getByRole('button', { name: '后续内容' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(graph).toHaveFocus();
  });

  it.each([
    ['{ArrowRight}', '反链'],
    ['{ArrowLeft}', '局部图谱'],
    ['{End}', '局部图谱'],
    ['{ArrowRight}{Home}', '大纲'],
    ['{End}{ArrowRight}', '大纲'],
    ['{End}{ArrowLeft}', '反链'],
  ])('WB-05：按 %s 后焦点和活动工具切到 %s，首尾循环', async (keys, label) => {
    const user = userEvent.setup();
    render(<ControlledTabs />);
    await user.tab();
    await user.keyboard(keys);

    const selected = screen.getByRole('tab', { selected: true });
    expect(selected).toHaveAccessibleName(label);
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute('tabindex', '0');
    for (const tab of screen.getAllByRole('tab', { selected: false })) {
      expect(tab).toHaveAttribute('tabindex', '-1');
    }
  });

  it.each(['{Enter}', ' '])('WB-05：工具按钮仍支持原生 %s 激活', async (key) => {
    const user = userEvent.setup();
    render(<ControlledTabs />);
    const backlinks = screen.getByRole('tab', { name: '反链' });
    act(() => backlinks.focus());
    await user.keyboard(key);
    expect(backlinks).toHaveFocus();
    expect(backlinks).toHaveAttribute('aria-selected', 'true');
    expect(backlinks).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '大纲' })).toHaveAttribute('tabindex', '-1');
  });

  it('WB-05：点击工具后键盘导航从所选工具继续', async () => {
    const user = userEvent.setup();
    render(<ControlledTabs />);
    await user.click(screen.getByRole('tab', { name: '反链' }));
    expect(screen.getByRole('tab', { name: '反链' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const graph = screen.getByRole('tab', { name: '局部图谱' });
    expect(graph).toHaveFocus();
    expect(graph).toHaveAttribute('aria-selected', 'true');
  });
});

describe('PanelTabs 与 RightPanel 的 WB-05 内容关联', () => {
  beforeEach(() => {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useSettingsStore.setState({ simpleMode: false });
  });

  afterEach(() => {
    cleanup();
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useSettingsStore.setState({ simpleMode: false });
  });

  it('WB-05：各工具通过 aria-controls 与 aria-labelledby 双向关联对应的真实内容面板', () => {
    render(<RightPanel />);
    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels).toHaveLength(3);
    expect(new Set(panels.map((panel) => panel.id)).size).toBe(3);
    for (const panel of panels) {
      expect(panel.id).not.toBe('');
      const tab = document.getElementById(panel.getAttribute('aria-labelledby') ?? '');
      expect(tab).toHaveAttribute('role', 'tab');
      expect(tab).toHaveAttribute('aria-controls', panel.id);
    }
    expect(screen.getByRole('tabpanel', { name: '大纲' })).toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('WB-05：键盘切换同时显示对应工具内容，隐藏原内容并保留已挂载面板', async () => {
    const user = userEvent.setup();
    render(<RightPanel />);
    const outlinePanel = screen.getByRole('tabpanel', { name: '大纲' });
    await user.tab();
    expect(screen.getByRole('tab', { name: '大纲' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');

    const backlinks = screen.getByRole('tab', { name: '反链' });
    const backlinksPanel = screen.getByRole('tabpanel', { name: '反链' });
    expect(backlinks).toHaveFocus();
    expect(backlinks).toHaveAttribute('aria-selected', 'true');
    expect(backlinks).toHaveAttribute('aria-controls', backlinksPanel.id);
    expect(backlinksPanel).toBeVisible();
    expect(outlinePanel).not.toBeVisible();
    expect(outlinePanel).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '局部图谱' })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: '局部图谱' })).toBeVisible();
    expect(backlinksPanel).not.toBeVisible();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tabpanel', { name: '大纲' })).toBe(outlinePanel);
    expect(outlinePanel).toBeVisible();
    expect(screen.getByRole('tab', { name: '大纲' })).toHaveFocus();
  });

  it('WB-05：简易模式移除高级工具后，所有导航键只在仍可用的大纲标签内切换', async () => {
    const user = userEvent.setup();
    render(<RightPanel />);
    await user.tab();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '局部图谱' })).toHaveFocus();
    act(() => useSettingsStore.setState({ simpleMode: true }));
    expect(screen.queryByRole('tab', { name: '局部图谱' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '反链' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);

    await user.tab();
    const outline = screen.getByRole('tab', { name: '大纲' });
    for (const key of ['{ArrowLeft}', '{ArrowRight}', '{Home}', '{End}']) {
      await user.keyboard(key);
      expect(outline).toHaveFocus();
      expect(outline).toHaveAttribute('tabindex', '0');
      expect(outline).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: '大纲' })).toBeVisible();
    }
    expect(useWorkbenchStore.getState().activeTab).toBe('outline');
  });
});
