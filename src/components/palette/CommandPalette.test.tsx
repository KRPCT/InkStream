import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { hydrate, list } from '../../commands/mru';
import { register } from '../../commands/registry';
import { usePaletteStore } from '../../stores/usePaletteStore';
import { useVaultStore } from '../../stores/useVaultStore';
import type { FileEntry, VaultInfo } from '../../types/vault';
import CommandPalette from './CommandPalette';

const openFileByPath = vi.hoisted(() => vi.fn());
vi.mock('../../editor/fileOpenFlow', () => ({ openFileByPath }));

const VAULT: VaultInfo = { root: '/vault', repoRoot: null, name: 'vault' };
const FILES: FileEntry[] = [
  { name: '会议纪要.md', path: '笔记/会议纪要.md' },
  { name: 'readme.md', path: 'readme.md' },
];

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
    openFileByPath.mockClear();
    act(() => usePaletteStore.setState(usePaletteStore.getInitialState(), true));
    act(() => useVaultStore.setState(useVaultStore.getInitialState(), true));
  });

  afterEach(() => {
    while (disposers.length) disposers.pop()!();
    act(() => useVaultStore.setState(useVaultStore.getInitialState(), true));
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

  function openQuick(): void {
    act(() => usePaletteStore.getState().openQuickOpen());
  }

  it('有 vault 时无前缀输入路由到 fileProvider（快速打开）', () => {
    act(() => useVaultStore.setState({ vault: VAULT, files: FILES }));
    render(<CommandPalette />);
    openQuick();
    type('会议');
    expect(screen.getByText('会议纪要.md')).toBeInTheDocument();
    expect(screen.getByText('笔记/会议纪要.md')).toBeInTheDocument();
    expect(screen.queryByText('readme.md')).not.toBeInTheDocument();
  });

  it('无 vault 时无前缀输入回退命令前缀提示（快速打开不可用）', () => {
    render(<CommandPalette />);
    openQuick();
    type('readme');
    // 无 workspace 时无前缀无可路由 provider，回退命令前缀提示而非文件 provider。
    expect(screen.getByText('输入 “>” 以搜索并执行命令')).toBeInTheDocument();
    expect(openFileByPath).not.toHaveBeenCalled();
  });

  it('选中快速打开结果调用 openFileByPath 并关闭面板', () => {
    act(() => useVaultStore.setState({ vault: VAULT, files: FILES }));
    render(<CommandPalette />);
    openQuick();
    type('会议');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(openFileByPath).toHaveBeenCalledWith('笔记/会议纪要.md');
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('快速打开无前缀且空 vault 文件清单显示空态文案', () => {
    act(() => useVaultStore.setState({ vault: VAULT, files: [] }));
    render(<CommandPalette />);
    openQuick();
    type('任意');
    expect(screen.getByText('没有匹配的文件')).toBeInTheDocument();
  });
});
