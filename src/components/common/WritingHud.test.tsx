import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWritingMetricsStore } from '../../stores/useWritingMetricsStore';
import WritingHud from './WritingHud';

beforeEach(() => {
  useWritingMetricsStore.setState(useWritingMetricsStore.getInitialState(), true);
});

describe('WritingHud（写作 HUD 卡片）', () => {
  it('默认不可见时渲染 null', () => {
    const { container } = render(<WritingHud />);
    expect(container.firstChild).toBeNull();
  });

  it('可见时渲染码字速度 / 时间 / 番茄钟', () => {
    useWritingMetricsStore.setState({ visible: true, charsPerMin: 42 });
    render(<WritingHud />);
    expect(screen.getByTestId('writing-hud')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('字/分')).toBeInTheDocument();
    expect(screen.getByText('码字时间')).toBeInTheDocument();
  });

  it('点击开始按钮启动番茄钟', async () => {
    const user = userEvent.setup();
    useWritingMetricsStore.setState({ visible: true });
    render(<WritingHud />);
    await user.click(screen.getByRole('button', { name: '开始番茄钟' }));
    expect(useWritingMetricsStore.getState().pomodoroRunning).toBe(true);
  });

  it('关闭按钮隐藏 HUD', async () => {
    const user = userEvent.setup();
    useWritingMetricsStore.setState({ visible: true });
    render(<WritingHud />);
    await user.click(screen.getByRole('button', { name: '关闭写作 HUD' }));
    expect(useWritingMetricsStore.getState().visible).toBe(false);
  });
});
