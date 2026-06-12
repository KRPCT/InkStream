import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useConfirmStore, type ConfirmRequest } from '../../stores/useConfirmStore';
import ConfirmDialog from './ConfirmDialog';

/** 弹一个确认请求（resolve 收集到 calls）。 */
function openRequest(calls: boolean[]): ConfirmRequest {
  const req: ConfirmRequest = {
    title: '删除文件',
    body: '确定送回收站吗？',
    confirmLabel: '删除',
    resolve: (ok) => calls.push(ok),
  };
  useConfirmStore.setState({ request: req });
  return req;
}

beforeEach(() => {
  useConfirmStore.setState({ request: null });
});

afterEach(() => {
  useConfirmStore.setState({ request: null });
});

describe('ConfirmDialog 焦点陷阱与还原（IN-01）', () => {
  it('无请求时不渲染', () => {
    const { container } = render(<ConfirmDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it('打开后焦点落在确认按钮', () => {
    openRequest([]);
    render(<ConfirmDialog />);
    expect(screen.getByRole('button', { name: '删除' })).toHaveFocus();
  });

  it('Tab 在首尾按钮间循环（焦点不逃出模态）', async () => {
    const user = userEvent.setup();
    openRequest([]);
    render(<ConfirmDialog />);
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '删除' });
    // 确认（末按钮）→ Tab 回到取消（首按钮）。
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    // 取消（首按钮）→ Shift+Tab 回到确认（末按钮）。
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('卸载时还原打开前焦点', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    openRequest([]);
    const { unmount } = render(<ConfirmDialog />);
    expect(screen.getByRole('button', { name: '删除' })).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('Esc 取消请求（resolve(false)）', async () => {
    const user = userEvent.setup();
    const calls: boolean[] = [];
    openRequest(calls);
    render(<ConfirmDialog />);
    await user.keyboard('{Escape}');
    expect(calls).toEqual([false]);
  });
});
