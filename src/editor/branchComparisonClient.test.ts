import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compareBranchText } from './branchComparisonClient';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('切换文件中止唯一 Worker，过期消息无法发布比较结果', async () => {
  const controller = new AbortController();
  const result = compareBranchText('旧。', '新。', controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  FakeWorker.instances[0].onmessage?.({ data: { result: { mode: 'sentences' } } } as MessageEvent);
  await rejected;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
});
it('8秒超时终止计算并明确降级，大文档不启动Worker', async () => {
  vi.useFakeTimers();
  const result = compareBranchText('旧。', '新。', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(8001);
  await expect(result).resolves.toMatchObject({ mode: 'text', note: expect.stringContaining('超过 8 秒') });
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  await expect(compareBranchText('a'.repeat(1_000_001), 'b', new AbortController().signal)).resolves.toMatchObject({ mode: 'text' });
  expect(FakeWorker.instances).toHaveLength(1);
});
