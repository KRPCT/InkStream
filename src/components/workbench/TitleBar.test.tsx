import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isMacOS } from '../../ipc/platform';
import { windowControls } from '../../ipc/window';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import TitleBar from './TitleBar';

vi.mock('../../ipc/window', () => ({
  windowControls: {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../ipc/platform', () => ({
  isMacOS: vi.fn(() => false),
}));

describe('TitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMacOS).mockReturnValue(false);
  });

  it('容器与居中标题都挂 data-tauri-drag-region（属性不冒泡）', () => {
    render(<TitleBar />);
    expect(screen.getByTestId('titlebar')).toHaveAttribute('data-tauri-drag-region');
    expect(screen.getByText('InkStream / 墨流')).toHaveAttribute('data-tauri-drag-region');
  });

  it('菜单插槽与控制按钮不挂拖拽属性', () => {
    render(<TitleBar />);
    expect(screen.getByTestId('titlebar-menu-slot')).not.toHaveAttribute('data-tauri-drag-region');
    expect(screen.getByRole('button', { name: '关闭' })).not.toHaveAttribute(
      'data-tauri-drag-region',
    );
  });

  it('三个窗口控制按钮点击触发对应 ipc 调用', async () => {
    const user = userEvent.setup();
    render(<TitleBar />);
    await user.click(screen.getByRole('button', { name: '最小化' }));
    expect(windowControls.minimize).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '最大化' }));
    expect(windowControls.toggleMaximize).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(windowControls.close).toHaveBeenCalledTimes(1);
  });

  it('macOS：不渲染控制按钮，左侧红绿灯 inset 存在', () => {
    vi.mocked(isMacOS).mockReturnValue(true);
    render(<TitleBar />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('titlebar-mac-inset')).toBeInTheDocument();
  });

  it('双击拖拽区调用 toggleMaximize（A1 防御）', async () => {
    const user = userEvent.setup();
    render(<TitleBar />);
    await user.dblClick(screen.getByText('InkStream / 墨流'));
    expect(windowControls.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('双击非拖拽区（菜单插槽）不触发 toggleMaximize', async () => {
    const user = userEvent.setup();
    render(<TitleBar />);
    await user.dblClick(screen.getByTestId('titlebar-menu-slot'));
    expect(windowControls.toggleMaximize).not.toHaveBeenCalled();
  });

  it('title prop 留 Phase 2 接口：传入即替换居中标题', () => {
    render(<TitleBar title="chapter-01.md - my-vault" />);
    expect(screen.getByText('chapter-01.md - my-vault')).toBeInTheDocument();
  });

  describe('三态标题（D-03/UI-SPEC，自 store 数据源）', () => {
    beforeEach(() => {
      useVaultStore.setState({ vault: null });
      useEditorStore.setState({ tabs: [], activePath: null });
    });

    it('无 vault：标题为「InkStream / 墨流」', () => {
      render(<TitleBar />);
      expect(screen.getByText('InkStream / 墨流')).toBeInTheDocument();
    });

    it('有 vault 无活动文件：标题为 vault 名', () => {
      useVaultStore.setState({ vault: { root: '/my-vault', repoRoot: null, name: 'my-vault' } });
      render(<TitleBar />);
      expect(screen.getByText('my-vault')).toBeInTheDocument();
    });

    it('有活动文件：标题为「{文件名} - {vault 名}」', () => {
      useVaultStore.setState({ vault: { root: '/my-vault', repoRoot: null, name: 'my-vault' } });
      useEditorStore.setState({
        tabs: [{ path: 'notes/chapter-01.md', name: 'chapter-01.md' }],
        activePath: 'notes/chapter-01.md',
      });
      render(<TitleBar />);
      expect(screen.getByText('chapter-01.md - my-vault')).toBeInTheDocument();
    });
  });
});
