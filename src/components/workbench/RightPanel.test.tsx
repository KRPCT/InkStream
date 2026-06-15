import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import RightPanel from './RightPanel';
import WorkbenchLayout from './WorkbenchLayout';

function setMode(mode: 'standard' | 'academic' | 'creative') {
  act(() => {
    useWorkbenchStore.getState().setMode(mode);
  });
}

describe('RightPanel 按模式渲染（消费 MODE_PRESETS）', () => {
  beforeEach(() => {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    delete document.documentElement.dataset.mode;
  });

  it('creative 模式渲染 Codex / 场景概要 两 tab 与空态文案', () => {
    render(<RightPanel />);
    setMode('creative');
    expect(screen.getByRole('tab', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '场景概要' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '大纲' })).not.toBeInTheDocument();
    // codex tab 现渲染 CodexPanel（其自身空态），非通用 TAB_EMPTY 文案。
    expect(screen.getByText('Codex 还是空的')).toBeInTheDocument();
    expect(
      screen.getByText(
        '在 Codex/ 文件夹放角色/地点/设定条目（frontmatter 写 type 与 name），编辑器中的提及会自动高亮。',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('暂无场景概要')).toBeInTheDocument();
    expect(screen.getByText('打开场景后，这里会显示概要卡片。')).toBeInTheDocument();
  });

  it('academic 模式渲染 引用 / Typst 预览 / 大纲 三 tab', () => {
    render(<RightPanel />);
    setMode('academic');
    expect(screen.getByRole('tab', { name: '引用' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Typst 预览' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '大纲' })).toBeInTheDocument();
    expect(screen.getByText('暂无引用')).toBeInTheDocument();
    expect(screen.getByText('在文档中插入 [@citekey] 后，引用条目会列在这里。')).toBeInTheDocument();
  });

  it('切模式后 activeTab 落到该模式 tabs[0]', () => {
    render(<RightPanel />);
    setMode('academic');
    expect(useWorkbenchStore.getState().activeTab).toBe('citation');
    expect(screen.getByRole('tab', { name: '引用' })).toHaveAttribute('aria-selected', 'true');
    setMode('creative');
    expect(screen.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keep-alive 限当前模式 tabs 集合内（模式内 display:none，跨模式不保活）', () => {
    render(<RightPanel />);
    setMode('standard');
    expect(screen.getByTestId('tab-pane-outline')).toBeVisible();
    expect(screen.getByTestId('tab-pane-backlinks')).not.toBeVisible();
    expect(screen.queryByTestId('tab-pane-codex')).not.toBeInTheDocument();
    setMode('creative');
    expect(screen.getByTestId('tab-pane-codex')).toBeVisible();
    expect(screen.queryByTestId('tab-pane-outline')).not.toBeInTheDocument();
  });
});

describe('模式切换零卸载（SHELL-01 核心语义）', () => {
  beforeEach(() => {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    delete document.documentElement.dataset.mode;
  });

  it('EditorArea DOM 节点在模式切换前后同一（不卸载）', () => {
    render(<WorkbenchLayout />);
    const before = screen.getByTestId('editor-area');
    setMode('academic');
    expect(screen.getByTestId('editor-area')).toBe(before);
    setMode('creative');
    expect(screen.getByTestId('editor-area')).toBe(before);
    setMode('standard');
    expect(screen.getByTestId('editor-area')).toBe(before);
  });
});
