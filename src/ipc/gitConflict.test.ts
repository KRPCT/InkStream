import { beforeEach, expect, it, vi } from 'vitest';
import type { ConflictBaseline } from '../types/gitConflict';
const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./invoke', () => ({ invoke: io.invoke, invokeStreamed: vi.fn() }));
import { gitSaveConflict } from './gitConflict';

const baseline: ConflictBaseline = { workingOid: 'a'.repeat(40), headOid: 'b'.repeat(40), operation: 'merge', stages: [null, null, null] };
beforeEach(() => { io.invoke.mockReset().mockResolvedValue(null); });

it('large conflict saves bind one small baseline and transfer exact UTF8 as bounded Raw chunks', async () => {
  const text = '中文🙂\r\n'.repeat(110_000);
  await gitSaveConflict('/repo', 'note.md', baseline, text);
  const start = io.invoke.mock.calls.find(([name]) => name === 'begin_file_write')!;
  expect(start[1].metadata.target).toEqual({ kind: 'gitConflict', repoRoot: '/repo', path: 'note.md', baseline });
  expect(JSON.stringify(start[1]).length).toBeLessThan(4096);
  const frames = io.invoke.mock.calls.filter(([name]) => name === 'append_file_write');
  expect(frames.length).toBeGreaterThan(4);
  const received = new Uint8Array(start[1].metadata.byteLength);
  let offset = 0;
  for (const [, value, options] of frames) {
    expect(ArrayBuffer.isView(value)).toBe(true);
    expect(Object.prototype.toString.call(value)).toBe('[object Uint8Array]');
    expect(value.byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(options.headers['x-inkstream-write-offset']).toBe(String(offset));
    received.set(value, offset); offset += value.byteLength;
  }
  expect(new TextDecoder().decode(received)).toBe(text);
  expect(io.invoke.mock.calls.some(([name]) => name === 'git_resolve_conflict')).toBe(false);
});

it('cancellation during upload aborts the owned session and never publishes a partial resolution', async () => {
  const controller = new AbortController();
  io.invoke.mockImplementation((command) => {
    if (command === 'append_file_write') controller.abort();
    return Promise.resolve(null);
  });
  await expect(gitSaveConflict('/repo', 'note.md', baseline, 'x'.repeat(600_000), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(io.invoke.mock.calls.filter(([name]) => name === 'append_file_write')).toHaveLength(1);
  expect(io.invoke.mock.calls.some(([name]) => name === 'abort_file_write')).toBe(true);
  expect(io.invoke.mock.calls.some(([name]) => name === 'commit_file_write')).toBe(false);
});
