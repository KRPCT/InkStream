import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import WordCountIndicator from './WordCountIndicator';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWordCountStore } from '../../stores/useWordCountStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

beforeEach(() => {
  useWorkbenchStore.setState({ mode: 'creative' });
  useSettingsStore.setState({ dailyWordGoal: 1000 });
  useWordCountStore.setState({ activeCount: 0, todayWritten: 300 });
});

describe('WordCountIndicator（CREA-04）', () => {
  it('Creative + 目标>0：显示 今日/目标', () => {
    render(<WordCountIndicator />);
    expect(screen.getByText('300/1000')).toBeInTheDocument();
  });

  it('非 Creative 模式不显示', () => {
    useWorkbenchStore.setState({ mode: 'standard' });
    const { container } = render(<WordCountIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('目标为 0（关闭）不显示', () => {
    useSettingsStore.setState({ dailyWordGoal: 0 });
    const { container } = render(<WordCountIndicator />);
    expect(container.firstChild).toBeNull();
  });
});
