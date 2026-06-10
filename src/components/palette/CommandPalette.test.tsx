import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { hydrate, list } from '../../commands/mru';
import { register } from '../../commands/registry';
import { usePaletteStore } from '../../stores/usePaletteStore';
import CommandPalette from './CommandPalette';

const disposers: Array<() => void> = [];

function reg(id: string, title: string): Mock<() => void> {
  const run = vi.fn();
  disposers.push(register({ id, title, run }));
  return run;
}

function openPalette(): void {
  act(() => usePaletteStore.getState().openPalette());
}

function input(): HTMLElement {
  return screen.getByLabelText('命令输入');
}

function type(value: string): void {
  fireEvent.change(input(), { target: { value } });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    hydrate([]);
    act(() => usePaletteStore.setState(usePaletteStore.getInitialState(), true));
  });

  afterEach(() => {
    while (disposers.length) disposers.pop()!();
  });

  it('open 后输入框值为 ">" 且聚焦', () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openPalette();
    expect(input()).toHaveValue('>');
    expect(input()).toHaveFocus();
  });

  it('中文 query 命中命令，未命中项不渲染', () => {
    reg('theme.dark', '主题：暗色');
    reg('view.toggle-sidebar', '视图：切换侧边栏');
    render(<CommandPalette />);
    openPalette();
    type('>主');
    expect(screen.getByText('主题：暗色')).toBeInTheDocument();
    expect(screen.queryByText('视图：切换侧边栏')).not.toBeInTheDocument();
  });

  it('Up/Down 循环移动选中行', () => {
    reg('theme.light', '主题：亮色');
    reg('theme.dark', '主题：暗色');
    render(<CommandPalette />);
    openPalette();
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter 执行选中命令、写 MRU 并关闭面板', () => {
    const run = reg('theme.dark', '主题：暗色');
    render(<CommandPalette />);
    openPalette();
    type('>暗');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(list()[0]).toBe('theme.dark');
    expect(usePaletteStore.getState().open).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('IME 组合中的 Enter 不执行（isComposing 防御）', () => {
    const run = reg('theme.dark', '主题：暗色');
    render(<CommandPalette />);
    openPalette();
    type('>暗');
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(run).not.toHaveBeenCalled();
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it('keyCode 229 的 Enter 不执行', () => {
    const run = reg('theme.dark', '主题：暗色');
    render(<CommandPalette />);
    openPalette();
    type('>暗');
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    expect(run).not.toHaveBeenCalled();
  });

  it('Esc 关闭面板', () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('无前缀显示提示行', () => {
    render(<CommandPalette />);
    openPalette();
    type('');
    expect(screen.getByText('输入 “>” 以搜索并执行命令')).toBeInTheDocument();
  });

  it('无匹配结果显示空态行', () => {
    reg('theme.dark', '主题：暗色');
    render(<CommandPalette />);
    openPalette();
    type('>qhcb');
    expect(screen.getByText('没有匹配的命令')).toBeInTheDocument();
  });
});
