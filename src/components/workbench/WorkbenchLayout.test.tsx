import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import WorkbenchLayout from './WorkbenchLayout';

describe('WorkbenchLayout', () => {
  beforeEach(() => {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  });

  it('渲染五插槽：titlebar / sidebar / editor-area / right-panel / status-bar', () => {
    render(<WorkbenchLayout />);
    expect(screen.getByTestId('titlebar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('editor-area')).toBeInTheDocument();
    expect(screen.getByTestId('right-panel')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('RightPanel 渲染 Standard 三 tab：大纲 / 反链 / 局部图谱', () => {
    render(<WorkbenchLayout />);
    expect(screen.getByRole('tab', { name: '大纲' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '反链' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '局部图谱' })).toBeInTheDocument();
  });

  it('tab 切换 keep-alive：原 tab 内容仍在 DOM 但不可见', async () => {
    const user = userEvent.setup();
    render(<WorkbenchLayout />);
    const outlinePane = screen.getByTestId('tab-pane-outline');
    expect(outlinePane).toBeVisible();
    expect(screen.getByTestId('tab-pane-backlinks')).not.toBeVisible();

    await user.click(screen.getByRole('tab', { name: '反链' }));

    expect(outlinePane).toBeInTheDocument();
    expect(outlinePane).not.toBeVisible();
    expect(screen.getByTestId('tab-pane-backlinks')).toBeVisible();
    expect(screen.getByTestId('tab-pane-localGraph')).not.toBeVisible();
  });

  it('EditorArea 欢迎页：应用名 + 三条 kbd 快捷键提示', () => {
    render(<WorkbenchLayout />);
    const editor = within(screen.getByTestId('editor-area'));
    expect(editor.getByText('InkStream / 墨流')).toBeInTheDocument();
    expect(editor.getByText('Ctrl+Shift+P')).toBeInTheDocument();
    expect(editor.getByText('Ctrl+B')).toBeInTheDocument();
    expect(editor.getByText('Ctrl+Alt+B')).toBeInTheDocument();
  });

  it('Sidebar 显示未打开工作区空态', () => {
    render(<WorkbenchLayout />);
    const sidebar = within(screen.getByTestId('sidebar'));
    expect(sidebar.getByText('未打开工作区')).toBeInTheDocument();
    expect(sidebar.getByText('文件树会在打开文件夹后显示在这里。')).toBeInTheDocument();
  });
});
