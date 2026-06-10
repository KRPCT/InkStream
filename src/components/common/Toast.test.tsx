import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast, useToastStore } from '../../stores/useToastStore';
import Toast from './Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('showToast 后渲染消息文本', () => {
    render(<Toast />);
    act(() => showToast('error', '读取失败'));
    expect(screen.getByText('读取失败')).toBeInTheDocument();
  });

  it('6 秒后自动消失', () => {
    render(<Toast />);
    act(() => showToast('warning', '保存失败'));
    expect(screen.getByText('保存失败')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByText('保存失败')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('保存失败')).not.toBeInTheDocument();
  });

  it('点击立即关闭并清理定时器', () => {
    render(<Toast />);
    act(() => showToast('error', '点击关闭我'));
    fireEvent.click(screen.getByText('点击关闭我'));
    expect(screen.queryByText('点击关闭我')).not.toBeInTheDocument();
    // 定时器已清理：推进 6s 不应再触发任何状态变更（无报错即可）
    act(() => vi.advanceTimersByTime(6000));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('error 与 warning 图标颜色类区分（--color-error / --text-muted）', () => {
    render(<Toast />);
    act(() => {
      showToast('error', '错误一条');
      showToast('warning', '警告一条');
    });
    const error = screen.getByText('错误一条').closest('button');
    const warning = screen.getByText('警告一条').closest('button');
    expect(error).toHaveAttribute('data-kind', 'error');
    expect(warning).toHaveAttribute('data-kind', 'warning');
    expect(error?.querySelector('svg')?.getAttribute('class')).toContain('--color-error');
    expect(warning?.querySelector('svg')?.getAttribute('class')).toContain('--text-muted');
  });

  it('多条 toast 堆叠共存，关闭一条不影响其余', () => {
    render(<Toast />);
    act(() => {
      showToast('error', '第一条');
      showToast('warning', '第二条');
    });
    expect(screen.getByText('第一条')).toBeInTheDocument();
    expect(screen.getByText('第二条')).toBeInTheDocument();
    const first = useToastStore.getState().toasts[0];
    act(() => useToastStore.getState().dismiss(first.id));
    expect(screen.queryByText('第一条')).not.toBeInTheDocument();
    expect(screen.getByText('第二条')).toBeInTheDocument();
  });
});
