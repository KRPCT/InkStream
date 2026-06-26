import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

interface FakeTerm {
  options: { theme: unknown };
  cols: number;
  rows: number;
  loadAddon: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
}
const terms: FakeTerm[] = [];
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function (this: FakeTerm, opts: { theme: unknown }) {
    this.options = { theme: opts.theme };
    this.cols = 80;
    this.rows = 24;
    this.loadAddon = vi.fn();
    this.open = vi.fn();
    this.write = vi.fn();
    this.focus = vi.fn();
    this.dispose = vi.fn();
    this.onData = vi.fn(() => ({ dispose: vi.fn() }));
    this.onResize = vi.fn(() => ({ dispose: vi.fn() }));
    terms.push(this);
  }),
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function (this: { fit: ReturnType<typeof vi.fn> }) {
    this.fit = vi.fn();
  }),
}));

const terminalOpen = vi.hoisted(() => vi.fn());
const terminalClose = vi.hoisted(() => vi.fn());
const terminalWrite = vi.hoisted(() => vi.fn());
const terminalResize = vi.hoisted(() => vi.fn());
vi.mock('../../ipc/terminal', () => ({ terminalOpen, terminalClose, terminalWrite, terminalResize }));

import { useVaultStore } from '../../stores/useVaultStore';
import TerminalPanel from './TerminalPanel';

beforeEach(() => {
  terms.length = 0;
  terminalOpen.mockReset();
  terminalClose.mockReset().mockResolvedValue(null);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  };
  act(() => useVaultStore.setState({ vault: { root: 'D:/v', repoRoot: null, name: 'v' }, files: [] }));
});

afterEach(() => {
  act(() => useVaultStore.setState(useVaultStore.getInitialState(), true));
});

describe('TerminalPanel', () => {
  it('挂载即在工作区根开会话；输出字节写入终端', async () => {
    let emit: (e: { kind: 'data'; bytes: Uint8Array } | { kind: 'exit' }) => void = () => {};
    terminalOpen.mockImplementation((_args, onEvent) => {
      emit = onEvent;
      return Promise.resolve(42);
    });
    render(<TerminalPanel />);
    await act(async () => {});
    expect(terminalOpen).toHaveBeenCalledWith(
      { cwd: 'D:/v', cols: 80, rows: 24 },
      expect.any(Function),
    );
    const term = terms[terms.length - 1];
    act(() => emit({ kind: 'data', bytes: new Uint8Array([65]) }));
    expect(term.write).toHaveBeenCalledWith(new Uint8Array([65]));
  });

  it('卸载后到达的字节被丢弃，不写已 dispose 的终端', async () => {
    let emit: (e: { kind: 'data'; bytes: Uint8Array } | { kind: 'exit' }) => void = () => {};
    terminalOpen.mockImplementation((_args, onEvent) => {
      emit = onEvent;
      return Promise.resolve(42);
    });
    const { unmount } = render(<TerminalPanel />);
    await act(async () => {});
    const term = terms[terms.length - 1];
    term.write.mockClear();
    unmount();
    act(() => emit({ kind: 'data', bytes: new Uint8Array([65]) }));
    act(() => emit({ kind: 'exit' }));
    expect(term.write).not.toHaveBeenCalled();
  });

  it('卸载即关会话 + dispose', async () => {
    terminalOpen.mockResolvedValue(42);
    const { unmount } = render(<TerminalPanel />);
    await act(async () => {});
    const term = terms[terms.length - 1];
    unmount();
    expect(terminalClose).toHaveBeenCalledWith(42);
    expect(term.dispose).toHaveBeenCalled();
  });

  it('open 在卸载后才 resolve → 立即回收会话，不泄漏', async () => {
    let resolveOpen: (id: number) => void = () => {};
    terminalOpen.mockReturnValue(new Promise<number>((res) => (resolveOpen = res)));
    const { unmount } = render(<TerminalPanel />);
    unmount(); // 先卸载
    await act(async () => resolveOpen(99)); // 会话 id 才到
    expect(terminalClose).toHaveBeenCalledWith(99);
  });
});
