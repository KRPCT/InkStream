import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute } from '../../commands/registry';
import { useEditorStore } from '../../stores/useEditorStore';
import RenderModeIndicator from './RenderModeIndicator';

vi.mock('../../commands/registry', () => ({
  execute: vi.fn(() => Promise.resolve()),
}));

describe('RenderModeIndicator（EDIT-02 / D-05 / D-01）', () => {
  beforeEach(() => {
    vi.mocked(execute).mockClear();
    useEditorStore.setState({ activeRenderMode: 'live' });
  });

  afterEach(() => {
    useEditorStore.setState({ activeRenderMode: 'live' });
  });

  it('Live 态：显 Live Preview 文本 + accent 状态点', () => {
    useEditorStore.setState({ activeRenderMode: 'live' });
    render(<RenderModeIndicator />);
    expect(screen.getByTestId('render-mode-indicator')).toHaveTextContent('Live Preview');
    expect(screen.getByTestId('render-mode-dot')).toBeInTheDocument();
  });

  it('Source 态：显 Source 文本且无状态点', () => {
    useEditorStore.setState({ activeRenderMode: 'source' });
    render(<RenderModeIndicator />);
    expect(screen.getByTestId('render-mode-indicator')).toHaveTextContent('Source');
    expect(screen.queryByTestId('render-mode-dot')).not.toBeInTheDocument();
  });

  it('点击经命令通道 execute(view.toggle-render-mode)', async () => {
    const user = userEvent.setup();
    useEditorStore.setState({ activeRenderMode: 'live' });
    render(<RenderModeIndicator />);
    await user.click(screen.getByTestId('render-mode-indicator'));
    expect(execute).toHaveBeenCalledWith('view.toggle-render-mode');
  });

  it('非 markdown 文档（activeRenderMode 为 null）：return null（容器空，D-01）', () => {
    useEditorStore.setState({ activeRenderMode: null });
    const { container } = render(<RenderModeIndicator />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('render-mode-indicator')).not.toBeInTheDocument();
  });

  it('指示器为可聚焦 button（键盘可达）', () => {
    useEditorStore.setState({ activeRenderMode: 'source' });
    render(<RenderModeIndicator />);
    const btn = screen.getByTestId('render-mode-indicator');
    expect(btn.tagName).toBe('BUTTON');
    btn.focus();
    expect(btn).toHaveFocus();
  });
});
