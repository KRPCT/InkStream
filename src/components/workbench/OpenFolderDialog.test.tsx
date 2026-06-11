import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFolderDialog, useOpenFolderStore } from '../../stores/useOpenFolderStore';
import OpenFolderDialog from './OpenFolderDialog';

function reset(): void {
  useOpenFolderStore.setState({ request: null });
}

beforeEach(reset);
afterEach(reset);

describe('OpenFolderDialog', () => {
  it('无请求时不渲染', () => {
    render(<OpenFolderDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('挂载后自动聚焦输入框并显示路径提示', () => {
    render(<OpenFolderDialog />);
    void openFolderDialog();
    return Promise.resolve().then(() => {
      const input = screen.getByRole('textbox');
      expect(document.activeElement).toBe(input);
      expect(screen.getByText('粘贴工作区的绝对路径')).toBeTruthy();
    });
  });

  it('Enter 提交时 resolve 输入的路径', async () => {
    const user = userEvent.setup();
    render(<OpenFolderDialog />);
    const pending = openFolderDialog();
    await screen.findByRole('textbox');
    await user.type(screen.getByRole('textbox'), 'D:\\Notes{Enter}');
    await expect(pending).resolves.toBe('D:\\Notes');
  });

  it('打开按钮提交输入的路径', async () => {
    const user = userEvent.setup();
    render(<OpenFolderDialog />);
    const pending = openFolderDialog();
    await screen.findByRole('textbox');
    await user.type(screen.getByRole('textbox'), '/Users/me/vault');
    await user.click(screen.getByRole('button', { name: '打开' }));
    await expect(pending).resolves.toBe('/Users/me/vault');
  });

  it('空路径不提交：打开按钮禁用，Enter 为 no-op', async () => {
    const user = userEvent.setup();
    render(<OpenFolderDialog />);
    const pending = openFolderDialog();
    await screen.findByRole('textbox');
    const open = screen.getByRole('button', { name: '打开' });
    expect((open as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox'), '   {Enter}');
    // 仍渲染（未 resolve），输入纯空白不提交
    expect(screen.getByRole('dialog')).toBeTruthy();
    // 收尾：取消使 pending 兑现，避免悬挂
    await user.keyboard('{Escape}');
    await expect(pending).resolves.toBeNull();
  });

  it('取消按钮 resolve(null)', async () => {
    const user = userEvent.setup();
    render(<OpenFolderDialog />);
    const pending = openFolderDialog();
    await screen.findByRole('textbox');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await expect(pending).resolves.toBeNull();
  });

  it('Esc resolve(null)', async () => {
    const user = userEvent.setup();
    render(<OpenFolderDialog />);
    const pending = openFolderDialog();
    await screen.findByRole('textbox');
    await user.keyboard('{Escape}');
    await expect(pending).resolves.toBeNull();
  });
});
