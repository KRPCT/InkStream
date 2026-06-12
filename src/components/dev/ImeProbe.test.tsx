import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAll } from '../../commands/registry';
import ImeProbe from './ImeProbe';
import { registerImeProbeCommand } from './imeProbeCommand';
import { useImeProbeStore } from './useImeProbeStore';

describe('ImeProbe', () => {
  beforeEach(() => {
    useImeProbeStore.setState({ open: false });
  });

  afterEach(() => {
    useImeProbeStore.setState({ open: false });
  });

  it('面板关闭时不渲染任何受试区', () => {
    render(<ImeProbe />);
    expect(screen.queryByLabelText('textarea 受试区')).not.toBeInTheDocument();
  });

  it('打开后挂载即程序化聚焦 textarea（document.activeElement）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const textarea = screen.getByLabelText('textarea 受试区');
    expect(document.activeElement).toBe(textarea);
  });

  it('三个并排受试区均渲染：textarea / input / contentEditable', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    expect(screen.getByLabelText('textarea 受试区').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('input 受试区')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('contentEditable 受试区')).toHaveAttribute('contenteditable', 'true');
  });

  it('事件日志记录 composition 事件（start/update/end + data）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const textarea = screen.getByLabelText('textarea 受试区');
    const log = screen.getByLabelText(/textarea.*事件日志/);

    fireEvent.compositionStart(textarea, { data: '' });
    fireEvent.compositionUpdate(textarea, { data: 'ce' });
    fireEvent.compositionEnd(textarea, { data: '测试' });

    expect(log.textContent).toContain('compositionstart');
    expect(log.textContent).toContain('compositionupdate');
    expect(log.textContent).toContain('compositionend');
    expect(log.textContent).toContain('测试');
  });

  it('keydown 日志记录 isComposing（IME 防误触判据可见）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const textarea = screen.getByLabelText('textarea 受试区');
    fireEvent.keyDown(textarea, { key: 'a', isComposing: true });
    expect(screen.getByLabelText(/textarea.*事件日志/).textContent).toContain('isComposing=true');
  });

  it('日志面板防误触：mousedown 被 preventDefault（点击不夺焦）', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const log = screen.getByLabelText(/textarea.*事件日志/);
    const ev = fireEvent.mouseDown(log);
    expect(ev).toBe(false); // preventDefault 已调用，fireEvent 返回 false
  });

  it('转焦按钮程序化切换焦点到对应受试区', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    fireEvent.click(screen.getByText(/转焦.*input/));
    expect(document.activeElement).toBe(screen.getByLabelText('input 受试区'));
  });

  it('日志只保留最近 20 条', () => {
    useImeProbeStore.setState({ open: true });
    render(<ImeProbe />);
    const textarea = screen.getByLabelText('textarea 受试区');
    for (let i = 0; i < 25; i += 1) {
      fireEvent.keyDown(textarea, { key: String(i), isComposing: false });
    }
    const items = screen.getByLabelText(/textarea.*事件日志/).querySelectorAll('li');
    expect(items.length).toBe(20);
  });
});

describe('registerImeProbeCommand', () => {
  it('DEV 下注册 dev.ime-probe 命令，dispose 后注销', () => {
    expect(import.meta.env.DEV).toBe(true);
    const dispose = registerImeProbeCommand();
    expect(getAll().some((c) => c.id === 'dev.ime-probe')).toBe(true);
    const cmd = getAll().find((c) => c.id === 'dev.ime-probe');
    expect(cmd?.title).toBe('开发：IME 输入探针');

    cmd?.run();
    expect(useImeProbeStore.getState().open).toBe(true);

    dispose();
    expect(getAll().some((c) => c.id === 'dev.ime-probe')).toBe(false);
    useImeProbeStore.setState({ open: false });
  });
});
