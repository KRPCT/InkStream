import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileReadMessage } from '../types/fileTransfer';

const { request, streamRequest } = vi.hoisted(() => ({
  request: vi.fn<(name: string, args?: unknown) => Promise<unknown>>(),
  streamRequest: vi.fn<(name: string, args: unknown, deliver: (message: FileReadMessage) => void) => Promise<null>>(),
}));
vi.mock('./invoke', () => ({ invoke: request, invokeStreamed: streamRequest }));
let files: typeof import('./files');

function frame(offset: number, bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.length + 8);
  new DataView(result).setBigUint64(0, BigInt(offset), true);
  new Uint8Array(result, 8).set(bytes);
  return result;
}

function respond(bytes: Uint8Array, split = 262_144): void {
  streamRequest.mockImplementation(async (_name, _args, deliver) => {
    deliver({ type: 'start', byteLength: bytes.length, chunkBytes: 262_144 });
    for (let offset = 0; offset < bytes.length; offset += split) {
      deliver(frame(offset, bytes.subarray(offset, Math.min(bytes.length, offset + split))));
    }
    deliver({ type: 'end', byteLength: bytes.length });
    return null;
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

beforeEach(async () => {
  vi.resetModules();
  request.mockReset().mockImplementation(async (name) => name === 'read_file' ? 'legacy JSON response' : [255]);
  streamRequest.mockReset();
  files = await import('./files');
});
afterEach(() => vi.useRealTimers());

describe('文件读取的 Raw 分块协议', () => {
  it('超过1MiB的阅读文件完整组装，不使用旧number[]回复', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 9);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
    respond(bytes);
    const actual = await files.readFileBytes('/fixture/book.pdf');
    expect(actual.byteLength).toBe(bytes.byteLength);
    expect(actual.every((byte, index) => byte === bytes[index])).toBe(true);
    expect(streamRequest).toHaveBeenCalledWith('read_file_stream', expect.objectContaining({ target: { kind: 'reading', path: '/fixture/book.pdf' } }), expect.any(Function));
    expect(request).not.toHaveBeenCalledWith('read_file_bytes', expect.anything());
  });

  it.each(['甲🙂乙', '\uFEFF# 标题', ''])('跨帧读取保持UTF8、BOM和空文档：%j', async (text) => {
    respond(new TextEncoder().encode(text), 2);
    await expect(files.readFile('/fixture', 'note.md')).resolves.toBe(text);
  });

  it('图片读取保留image权限目标与原始字节', async () => {
    respond(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    const image = await files.readImageBytes('/fixture/cover.png');
    expect(Array.from(image)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(streamRequest).toHaveBeenCalledWith('read_file_stream', expect.objectContaining({ target: { kind: 'image', path: '/fixture/cover.png' } }), expect.any(Function));
  });

  it.each(['offset', 'length', 'utf8'] as const)('%s错误使整次读取失败，不返回部分正文', async (fault) => {
    streamRequest.mockImplementation(async (_name, _args, deliver) => {
      deliver({ type: 'start', byteLength: fault === 'length' ? 2 : 1, chunkBytes: 262_144 });
      deliver(frame(fault === 'offset' ? 1 : 0, new Uint8Array([fault === 'utf8' ? 255 : 65])));
      deliver({ type: 'end', byteLength: 1 });
      return null;
    });
    await expect(files.readFile('/fixture', 'note.md')).rejects.toThrow();
  });

  it('已取消的请求不会进入原生读取', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(files.readFileBytes('/fixture/book.pdf', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
    expect(streamRequest).not.toHaveBeenCalled();
  });

  it('读取中取消会拒绝结果并通知原生释放该requestId', async () => {
    let finish: (() => void) | undefined;
    streamRequest.mockImplementation((_name, _args, deliver) => {
      deliver({ type: 'start', byteLength: 10, chunkBytes: 262_144 });
      return new Promise((resolve) => { finish = () => resolve(null); });
    });
    const controller = new AbortController();
    const outcome = files.readFileBytes('/fixture/book.pdf', { signal: controller.signal }).then(
      () => ({ cancelled: false }), (error: unknown) => ({ cancelled: error instanceof DOMException && error.name === 'AbortError' }),
    );
    await flush();
    controller.abort();
    try {
      expect((await outcome).cancelled).toBe(true);
      expect(request).toHaveBeenCalledWith('cancel_file_read', expect.objectContaining({ requestId: expect.any(String) }));
    } finally { finish?.(); }
  });

  it('15秒无数据则超时并取消', async () => {
    vi.useFakeTimers();
    streamRequest.mockImplementation(async () => null);
    const controller = new AbortController();
    let failure: unknown;
    const pending = files.readFileBytes('/fixture/book.pdf', { signal: controller.signal }).catch((error: unknown) => { failure = error; });
    await flush();
    await vi.advanceTimersByTimeAsync(15_001);
    try {
      expect(failure).toBeInstanceOf(Error);
      expect(request).toHaveBeenCalledWith('cancel_file_read', expect.objectContaining({ requestId: expect.any(String) }));
    } finally { controller.abort(); await pending; }
  });

  it('持续有进度也不能超过120秒总期限', async () => {
    vi.useFakeTimers();
    let deliver: ((message: FileReadMessage) => void) | undefined;
    streamRequest.mockImplementation(async (_name, _args, callback) => {
      deliver = callback;
      callback({ type: 'start', byteLength: 1000, chunkBytes: 262_144 });
      return null;
    });
    const controller = new AbortController();
    let failure: unknown;
    const pending = files.readFileBytes('/fixture/book.pdf', { signal: controller.signal }).catch((error: unknown) => { failure = error; });
    await flush();
    for (let second = 10; second < 120; second += 10) {
      await vi.advanceTimersByTimeAsync(10_000);
      deliver?.(frame(second / 10 - 1, new Uint8Array([65])));
    }
    await vi.advanceTimersByTimeAsync(10_001);
    try { expect(failure).toBeInstanceOf(Error); }
    finally { controller.abort(); await pending; }
  });
});
