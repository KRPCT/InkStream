import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinCommands } from '../../commands/builtins';
import { hydrate } from '../../commands/mru';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useWritingMetricsStore } from '../../stores/useWritingMetricsStore';
import HudHintIndicator from './HudHintIndicator';

let disposeBuiltins: () => void;

beforeEach(() => {
  hydrate([]);
  useWorkbenchStore.setState({ mode: 'creative' });
  useWritingMetricsStore.setState({ visible: false });
  disposeBuiltins = registerBuiltinCommands();
});

afterEach(() => {
  disposeBuiltins();
});

describe('HudHintIndicator（写作 HUD 入口）', () => {
  it('Creative 模式显示入口按钮', () => {
    render(<HudHintIndicator />);
    expect(screen.getByTestId('hud-hint-indicator')).toBeInTheDocument();
  });

  it('非 Creative 模式不显示', () => {
    useWorkbenchStore.setState({ mode: 'standard' });
    const { container } = render(<HudHintIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('点击经命令通道切换 HUD 可见', async () => {
    const user = userEvent.setup();
    render(<HudHintIndicator />);
    await user.click(screen.getByTestId('hud-hint-indicator'));
    expect(useWritingMetricsStore.getState().visible).toBe(true);
  });
});
