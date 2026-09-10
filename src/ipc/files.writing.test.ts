import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn<(command: string, args: unknown, options?: { headers?: Record<string, string> }) => Promise<null>>() }));
vi.mock('./invoke', () => ({ invoke: request, invokeStreamed: vi.fn() }));
import { writeBytesToPath, writeFileAtomic, writeFileToPath } from './files';

interface WriteMetadata {
  version: number;
  requestId: string;
  target: { kind: 'vault'; root: string; path: string } | { kind: 'absolute'; path: string };
  encoding: 'utf8' | 'bytes';
  byteLength: number;
}

function isByteView(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function receivedSession(): { metadata: WriteMetadata; bytes: Uint8Array } {
  const [begin, args] = request.mock.calls[0];
  expect(begin).toBe('begin_file_write');
  const metadata = (args as { metadata: WriteMetadata }).metadata;
  expect(metadata.version).toBe(1);
  expect(metadata.requestId).toMatch(/^[\da-f-]{36}$/i);
  const bytes = new Uint8Array(metadata.byteLength);
  let offset = 0;
  for (const [command, body, options] of request.mock.calls.slice(1, -1)) {
    expect(command).toBe('append_file_write');
    expect(isByteView(body)).toBe(true);
    const chunk = body as Uint8Array;
    expect(chunk.byteLength).toBeGreaterThan(0);
    expect(chunk.byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(options?.headers).toEqual({ 'x-inkstream-write-id': metadata.requestId, 'x-inkstream-write-offset': String(offset) });
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  expect(offset).toBe(metadata.byteLength);
  expect(request.mock.calls.at(-1)?.slice(0, 2)).toEqual(['commit_file_write', { requestId: metadata.requestId }]);
  return { metadata, bytes };
}

function deferred() {
  let resolve!: (value: null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<null>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => { request.mockReset().mockResolvedValue(null); });
afterEach(() => vi.useRealTimers());

describe('原子保存的有界 Raw 会话', () => {
  it('大文本逐块发送，每个Raw请求至多256KiB且保留完整UTF-8/BOM和vault路径', async () => {
    const text = '\uFEFF# 文档\n' + '中文 English 😀\n'.repeat(100_000) + '\nTAIL';
    await expect(writeFileAtomic('C:/资料库', '章节/草稿.md', text)).resolves.toBeNull();
    // 先检查实际请求体；旧的单帧实现应因真实入站负载超限而失败。
    const bodies = request.mock.calls.map((call) => call[1]).filter(isByteView);
    expect(bodies.length).toBeGreaterThan(0);
    expect(Math.max(...bodies.map((body) => body.byteLength))).toBeLessThanOrEqual(256 * 1024);
    const { metadata, bytes } = receivedSession();
    expect(metadata.target).toEqual({ kind: 'vault', root: 'C:/资料库', path: '章节/草稿.md' });
    expect(metadata.encoding).toBe('utf8');
    expect(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)).toBe(text);
  });

  it.each(['', '\uFEFF甲🙂乙'])('绝对路径保存支持空文本/BOM/emoji，保持原有public wrapper：%j', async (text) => {
    await writeFileToPath('C:/导出/中文.md', text);
    const { metadata, bytes } = receivedSession();
    expect(metadata.target).toEqual({ kind: 'absolute', path: 'C:/导出/中文.md' });
    expect(metadata.encoding).toBe('utf8');
    expect(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)).toBe(text);
  });

  it('二进制写保持视图范围与调用时快照，不转number[]或扩大到底层buffer', async () => {
    const storage = new Uint8Array([90, 0, 255, 128, 65, 91]);
    const writing = writeBytesToPath('C:/导出/文稿.docx', storage.subarray(1, 5));
    storage.fill(7);
    await writing;
    const { metadata, bytes } = receivedSession();
    expect(metadata.target).toEqual({ kind: 'absolute', path: 'C:/导出/文稿.docx' });
    expect(metadata.encoding).toBe('bytes');
    expect(Array.from(bytes)).toEqual([0, 255, 128, 65]);
  });

  it('大文本编码期间让出事件循环，输入任务能在发送前获得机会', async () => {
    let inputOpportunity = false;
    const timer = setTimeout(() => { inputOpportunity = true; }, 0);
    try {
      await writeFileToPath('C:/large.md', '中文😀\n'.repeat(300_000));
      expect(inputOpportunity).toBe(true);
      receivedSession();
    } finally { clearTimeout(timer); }
  });

  it('未配对UTF-16代理项拒绝保存，不能被TextEncoder静默替换成乱码', async () => {
    await expect(writeFileToPath('C:/invalid.md', '保留原文件\ud800')).rejects.toThrow(/UTF-16|代理/);
    expect(request).not.toHaveBeenCalled();
  });

  it('原生写失败继续拒绝，由既有SaveOutcome链保留dirty和失败恢复', async () => {
    request.mockRejectedValue(new Error('fixture write denied'));
    await expect(writeFileAtomic('C:/v', 'note.md', '未保存内容')).rejects.toThrow('fixture write denied');
  });

  it('上一块确认前不发送下一块，全部块确认前不commit', async () => {
    const first = deferred();
    let appendCount = 0;
    request.mockImplementation((command) => command === 'append_file_write' && ++appendCount === 1 ? first.promise : Promise.resolve(null));
    const writing = writeBytesToPath('C:/backpressure.bin', new Uint8Array(256 * 1024 + 1).fill(42));
    try {
      await vi.waitFor(() => expect(request.mock.calls.some(([command]) => command === 'append_file_write')).toBe(true));
      expect(request.mock.calls.map(([command]) => command)).toEqual(['begin_file_write', 'append_file_write']);
      first.resolve(null);
      await writing;
      expect(appendCount).toBe(2);
      receivedSession();
    } finally { first.resolve(null); await writing.catch(() => undefined); }
  });

  it('中途失败会abort当前会话，不commit且仍向调用方报告原始失败', async () => {
    let appendCount = 0;
    request.mockImplementation((command) => command === 'append_file_write' && ++appendCount === 2 ? Promise.reject(new Error('fixture chunk denied')) : Promise.resolve(null));
    await expect(writeBytesToPath('C:/failure.bin', new Uint8Array(256 * 1024 + 1))).rejects.toThrow('fixture chunk denied');
    const metadata = (request.mock.calls[0][1] as { metadata: WriteMetadata }).metadata;
    expect(request.mock.calls.map(([command]) => command)).toEqual(['begin_file_write', 'append_file_write', 'append_file_write', 'abort_file_write']);
    expect(request.mock.calls.at(-1)?.[1]).toEqual({ requestId: metadata.requestId });
  });

  it('commit未确认不能报告成功，commit失败也会abort并继续拒绝', async () => {
    const commit = deferred();
    request.mockImplementation((command) => command === 'commit_file_write' ? commit.promise : Promise.resolve(null));
    const settled = vi.fn();
    const writing = writeFileToPath('C:/commit.md', 'pending');
    const observed = writing.then(settled, settled);
    try {
      await vi.waitFor(() => expect(request.mock.calls.some(([command]) => command === 'commit_file_write')).toBe(true));
      expect(settled).not.toHaveBeenCalled();
      commit.reject(new Error('fixture rename denied'));
      await expect(writing).rejects.toThrow('fixture rename denied');
      expect(request.mock.calls.at(-1)?.[0]).toBe('abort_file_write');
    } finally { commit.resolve(null); await observed; }
  });
});
