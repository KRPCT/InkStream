import { beforeEach, expect, it, vi } from 'vitest';
import type { FileReadMessage } from '../types/fileTransfer';
import type { GitCompareSide } from '../types/gitCompare';

const { request, stream } = vi.hoisted(() => ({ request: vi.fn().mockResolvedValue(null), stream: vi.fn() }));
vi.mock('./invoke', () => ({ invoke: request, invokeStreamed: stream }));
import { gitCompareFiles, gitCompareText } from './gitCompare';

const side: GitCompareSide = { commitOid: 'a'.repeat(40), blobOid: 'b'.repeat(40), path: '中文.md', byteLength: 100, readable: true };
beforeEach(() => { request.mockClear(); stream.mockReset(); });

it('比较全文跨 Raw 帧完整保留 UTF8、CRLF 和末尾，无正文 JSON 回传', async () => {
  const original = '\uFEFF开头。\r\n' + '跨帧中文🙂正文。'.repeat(50_000) + '\r\n完整末尾。';
  const bytes = new TextEncoder().encode(original);
  stream.mockImplementation(async (_name: string, _args: unknown, deliver: (message: FileReadMessage) => void) => {
    deliver({ type: 'start', byteLength: bytes.length, chunkBytes: 262_144 });
    for (let offset = 0; offset < bytes.length; offset += 262_144) {
      const chunk = bytes.subarray(offset, offset + 262_144);
      const frame = new ArrayBuffer(chunk.length + 8);
      new DataView(frame).setBigUint64(0, BigInt(offset), true); new Uint8Array(frame, 8).set(chunk); deliver(frame);
    }
    deliver({ type: 'end', byteLength: bytes.length });
    return null;
  });
  await expect(gitCompareText('/repo', side, new AbortController().signal)).resolves.toBe(original);
  expect(stream).toHaveBeenCalledWith('read_file_stream', expect.objectContaining({ target: { kind: 'gitBlob', repoRoot: '/repo', commitOid: side.commitOid, blobOid: side.blobOid, path: '中文.md' } }), expect.any(Function));
  expect(request.mock.calls.every(([name]) => name === 'ack_file_read')).toBe(true);
});
it('分页和当前文档过滤使用同一固定提交，无文件的一侧是空全文', async () => {
  await gitCompareFiles('/repo', 'a'.repeat(40), 'b'.repeat(40), 100, '中文.md');
  expect(request).toHaveBeenCalledWith('git_compare_files', { repoRoot: '/repo', fromOid: 'a'.repeat(40), toOid: 'b'.repeat(40), skip: 100, limit: 100, focusPath: '中文.md' });
  await expect(gitCompareText('/repo', null, new AbortController().signal)).resolves.toBe('');
  expect(stream).not.toHaveBeenCalled();
});
it('不可读类型和事先取消均不启动原生正文读取', async () => {
  await expect(gitCompareText('/repo', { ...side, readable: false }, new AbortController().signal)).rejects.toThrow('完整比较');
  const controller = new AbortController(); controller.abort();
  await expect(gitCompareText('/repo', side, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(stream).not.toHaveBeenCalled();
});
