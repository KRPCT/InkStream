import { act, render, screen, within } from '@testing-library/react';
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

  it('EditorArea 无 vault：显示未打开工作区空态 + 打开文件夹按钮', () => {
    render(<WorkbenchLayout />);
    const editor = within(screen.getByTestId('editor-area'));
    expect(editor.getByText('未打开工作区')).toBeInTheDocument();
    expect(editor.getByRole('button', { name: '打开文件夹' })).toBeInTheDocument();
  });

  it('Sidebar 显示未打开工作区空态', () => {
    render(<WorkbenchLayout />);
    const sidebar = within(screen.getByTestId('sidebar'));
    expect(sidebar.getByText('未打开工作区')).toBeInTheDocument();
    expect(sidebar.getByText('打开一个文件夹作为工作区，开始写作。')).toBeInTheDocument();
  });

  // UAT #6：侧边栏与右侧面板必须互相独立——切换一侧绝不能翻转另一侧的持久化折叠态。
  // 派生逻辑本体见 layoutPatch.test.ts；此处验证 store 层 toggle 的独立性与 both-open 可达。
  describe('UAT #6 面板独立性', () => {
    it('store 切换互相独立：切侧边栏不动右侧 flag，切右侧不动侧边栏 flag（两侧可同时打开）', () => {
      render(<WorkbenchLayout />);
      const store = useWorkbenchStore;
      // 初始两侧均展开（DEFAULT_LAYOUT）——both-open 是可达起点。
      expect(store.getState().layouts.standard.sidebarCollapsed).toBe(false);
      expect(store.getState().layouts.standard.rightPanelCollapsed).toBe(false);

      act(() => store.getState().toggleSidebar());
      expect(store.getState().layouts.standard.sidebarCollapsed).toBe(true);
      expect(store.getState().layouts.standard.rightPanelCollapsed).toBe(false); // 右侧不受影响

      act(() => store.getState().toggleRightPanel());
      expect(store.getState().layouts.standard.rightPanelCollapsed).toBe(true);
      expect(store.getState().layouts.standard.sidebarCollapsed).toBe(true); // 侧边栏不受影响

      act(() => store.getState().toggleSidebar());
      expect(store.getState().layouts.standard.sidebarCollapsed).toBe(false);
      expect(store.getState().layouts.standard.rightPanelCollapsed).toBe(true); // 仍独立
    });
  });
});
