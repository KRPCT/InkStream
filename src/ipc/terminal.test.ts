import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const invokeStreamed = vi.hoisted(() => vi.fn());
vi.mock('./invoke', () => ({ invoke, invokeStreamed }));

import { terminalClose, terminalOpen, terminalResize, terminalWrite, type TerminalEvent } from './terminal';

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(null);
  invokeStreamed.mockReset().mockResolvedValue(7);
});

describe('terminal ipc', () => {
  it('terminalOpen：ArrayBuffer→data 字节、{type:"exit"}→exit、其它忽略', async () => {
    let chunk: (c: ArrayBuffer | { type?: string }) => void = () => {};
    invokeStreamed.mockImplementation((_cmd, _args, cb) => {
      chunk = cb;
      return Promise.resolve(7);
    });
    const events: TerminalEvent[] = [];
    const id = await terminalOpen({ cwd: 'D:/v', cols: 80, rows: 24 }, (e) => events.push(e));
    expect(id).toBe(7);
    expect(invokeStreamed).toHaveBeenCalledWith(
      'terminal_open',
      { cwd: 'D:/v', cols: 80, rows: 24 },
      expect.any(Function),
    );
    chunk(new Uint8Array([104, 105]).buffer); // 'hi' 字节
    chunk({ type: 'exit' });
    chunk({ type: 'noise' }); // 未知控制：忽略
    expect(events).toEqual([
      { kind: 'data', bytes: new Uint8Array([104, 105]) },
      { kind: 'exit' },
    ]);
  });

  it('write/resize/close 走普通 invoke', async () => {
    await terminalWrite(7, 'ls\n');
    expect(invoke).toHaveBeenCalledWith('terminal_write', { id: 7, data: 'ls\n' });
    await terminalResize(7, 100, 30);
    expect(invoke).toHaveBeenCalledWith('terminal_resize', { id: 7, cols: 100, rows: 30 });
    await terminalClose(7);
    expect(invoke).toHaveBeenCalledWith('terminal_close', { id: 7 });
  });
});
