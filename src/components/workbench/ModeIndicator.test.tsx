import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinCommands } from '../../commands/builtins';
import { hydrate } from '../../commands/mru';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import ModeIndicator from './ModeIndicator';

let disposeBuiltins: () => void;

describe('ModeIndicator（D-08）', () => {
  beforeEach(() => {
    hydrate([]);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    delete document.documentElement.dataset.mode;
    disposeBuiltins = registerBuiltinCommands();
  });

  afterEach(() => {
    disposeBuiltins();
  });

  it('渲染当前模式名', () => {
    render(<ModeIndicator />);
    expect(screen.getByTestId('mode-indicator')).toHaveTextContent('Standard · 通用');
  });

  it('点击展开三行模式菜单且当前模式行带 check', async () => {
    const user = userEvent.setup();
    render(<ModeIndicator />);
    await user.click(screen.getByTestId('mode-indicator'));
    const rows = screen.getAllByRole('menuitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Standard · 通用');
    expect(rows[1]).toHaveTextContent('Academic · 学术');
    expect(rows[2]).toHaveTextContent('Creative · 长篇创作');
    expect(within(rows[0]).getByTestId('mode-check')).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId('mode-check')).not.toBeInTheDocument();
  });

  it('点击「Academic · 学术」行经命令通道切模式且菜单关闭', async () => {
    const user = userEvent.setup();
    render(<ModeIndicator />);
    await user.click(screen.getByTestId('mode-indicator'));
    await user.click(screen.getByRole('menuitem', { name: 'Academic · 学术' }));
    expect(useWorkbenchStore.getState().mode).toBe('academic');
    expect(document.documentElement.dataset.mode).toBe('academic');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('mode-indicator')).toHaveTextContent('Academic · 学术');
  });

  it('键盘 Esc 关闭菜单', async () => {
    const user = userEvent.setup();
    render(<ModeIndicator />);
    await user.click(screen.getByTestId('mode-indicator'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('键盘 Up/Down + Enter 可选择模式', async () => {
    const user = userEvent.setup();
    render(<ModeIndicator />);
    await user.click(screen.getByTestId('mode-indicator'));
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(useWorkbenchStore.getState().mode).toBe('academic');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
