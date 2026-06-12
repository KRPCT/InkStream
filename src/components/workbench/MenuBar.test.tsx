import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../../commands/builtins';
import { hydrate } from '../../commands/mru';
import { windowControls } from '../../ipc/window';
import { useAboutStore } from '../../stores/useAboutStore';
import { usePaletteStore } from '../../stores/usePaletteStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import AboutDialog from '../common/AboutDialog';
import MenuBar from './MenuBar';

vi.mock('../../ipc/app', () => ({
  getAppVersion: vi.fn().mockResolvedValue('0.1.0-test'),
}));

let disposeBuiltins: () => void;

describe('MenuBar（D-02 同源框架）', () => {
  beforeEach(() => {
    hydrate([]);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    usePaletteStore.setState(usePaletteStore.getInitialState(), true);
    useAboutStore.setState(useAboutStore.getInitialState(), true);
    delete document.documentElement.dataset.mode;
    disposeBuiltins = registerBuiltinCommands();
  });

  afterEach(() => {
    disposeBuiltins();
  });

  it('渲染 文件 / 编辑 / 段落 / 格式 / 视图 / 帮助 六个顶层菜单', () => {
    render(<MenuBar />);
    for (const name of ['文件', '编辑', '段落', '格式', '视图', '帮助']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('展开「视图」含命令面板（带快捷键芯片）与 外观 / 模式 两个子菜单', async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '视图' }));
    const palette = screen.getByRole('menuitem', { name: /命令面板/ });
    expect(palette).toHaveTextContent('Ctrl+Shift+P');
    // R4 §3：侧栏让位 Ctrl+B，改 Ctrl+\
    expect(screen.getByRole('menuitem', { name: /切换侧边栏/ })).toHaveTextContent('Ctrl+\\');
    expect(screen.getByRole('menuitem', { name: /^外观$/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^模式$/ })).toBeInTheDocument();
  });

  it('展开「格式」含加粗（Ctrl+B 芯片）与清除格式', async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '格式' }));
    expect(screen.getByRole('menuitem', { name: /加粗/ })).toHaveTextContent('Ctrl+B');
    expect(screen.getByRole('menuitem', { name: '清除格式' })).toBeInTheDocument();
  });

  it('展开「文件」含原生打开文件/文件夹（Ctrl+O / Ctrl+Shift+O 芯片）', async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '文件' }));
    expect(screen.getByRole('menuitem', { name: /打开文件…/ })).toHaveTextContent('Ctrl+O');
    expect(screen.getByRole('menuitem', { name: /打开文件夹…/ })).toHaveTextContent('Ctrl+Shift+O');
  });

  it('「外观」子菜单三项标题取自 registry（与主题命令同源）', async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '视图' }));
    await user.click(screen.getByRole('menuitem', { name: /外观/ }));
    expect(screen.getByRole('menuitem', { name: '主题：亮色' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '主题：暗色' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '主题：跟随系统' })).toBeInTheDocument();
  });

  it('「模式」子菜单选择经 registry.execute 切模式并关闭整个菜单', async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '视图' }));
    await user.click(screen.getByRole('menuitem', { name: /^模式$/ }));
    await user.click(screen.getByRole('menuitem', { name: '模式：切换到 Creative（长篇创作）' }));
    expect(useWorkbenchStore.getState().mode).toBe('creative');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('命令未注册时菜单项禁用（registry.subscribe 驱动可用态）', async () => {
    const user = userEvent.setup();
    disposeBuiltins();
    disposeBuiltins = () => {};
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '文件' }));
    expect(screen.getByRole('menuitem', { name: '退出' })).toBeDisabled();
  });

  it('点击「退出」触发 app.exit（经 ipc 收口 close）', async () => {
    const close = vi.spyOn(windowControls, 'close').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '文件' }));
    await user.click(screen.getByRole('menuitem', { name: '退出' }));
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });

  it('「帮助」→「关于 InkStream」打开含版本号的对话框', async () => {
    const user = userEvent.setup();
    render(
      <>
        <MenuBar />
        <AboutDialog />
      </>,
    );
    await user.click(screen.getByRole('menuitem', { name: '帮助' }));
    await user.click(screen.getByRole('menuitem', { name: '关于 InkStream' }));
    const dialog = await screen.findByRole('dialog', { name: '关于 InkStream' });
    expect(dialog).toHaveTextContent('InkStream / 墨流');
    expect(await screen.findByText(/0\.1\.0-test/)).toBeInTheDocument();
  });

  it('顶层菜单键盘左右切换（文件 ↔ 编辑）', async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '文件' }));
    expect(screen.getByRole('menu', { name: '文件' })).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('menu', { name: '编辑' })).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('menu', { name: '文件' })).toBeInTheDocument();
  });
});
