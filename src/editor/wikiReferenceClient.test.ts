import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readReferenceRange, readUnlinkedMention, readWikiReferences } from './wikiReferenceClient';
import { collectWikiReferences } from './wikiReferences';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failTransfer = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn(() => { if (FakeWorker.failTransfer) throw new Error('fixture transfer error'); });
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
beforeEach(() => { FakeWorker.instances = []; FakeWorker.failTransfer = false; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('小文档直接验证正文，长文档使用独立Worker并在成功后回收', async () => {
  await expect(readUnlinkedMention('这是研究记录。', '研究', new AbortController().signal)).resolves.toBe(true);
  expect(FakeWorker.instances).toHaveLength(0);
  const doc = 'a'.repeat(64_001) + '\n\n唯一 [[研究]]。';
  const pending = readWikiReferences(doc, new AbortController().signal);
  const worker = FakeWorker.instances[0];
  worker.onmessage?.({ data: { result: collectWikiReferences(doc) } } as MessageEvent);
  expect((await pending)[0].linkText).toBe('[[研究]]');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.onmessage).toBeNull();
});

it('取消和超时均终止Worker，不返回半份关联数据', async () => {
  const controller = new AbortController();
  const aborted = readWikiReferences('a'.repeat(64_001), controller.signal);
  const rejected = expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  const timed = readUnlinkedMention('a'.repeat(64_001), '研究', new AbortController().signal);
  const timeout = expect(timed).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(8_001); await timeout;
  expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce();
});

it('Worker报错、错误结果类型、传输失败都明确拒绝并清理', async () => {
  const one = readWikiReferences('a'.repeat(64_001), new AbortController().signal);
  const failure = expect(one).rejects.toThrow('fixture error');
  FakeWorker.instances[0].onmessage?.({ data: { error: 'fixture error' } } as MessageEvent); await failure;
  const two = readWikiReferences('a'.repeat(64_001), new AbortController().signal);
  const mismatch = expect(two).rejects.toThrow('类型错误');
  FakeWorker.instances[1].onmessage?.({ data: { result: true } } as MessageEvent); await mismatch;
  FakeWorker.failTransfer = true;
  await expect(readWikiReferences('a'.repeat(64_001), new AbortController().signal)).rejects.toThrow('transfer error');
  expect(FakeWorker.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
});

it('Raw CRLF 长文定位复用Worker结果，重复上下文不猜落点', async () => {
  const paragraph = '唯一段落 [[研究]]。';
  const reference = collectWikiReferences(paragraph)[0];
  const doc = 'a'.repeat(64_001) + '\r\n\r\n' + paragraph;
  const pending = readReferenceRange(doc, reference, new AbortController().signal);
  FakeWorker.instances[0].onmessage?.({ data: { result: collectWikiReferences(doc) } } as MessageEvent);
  const normalized = doc.replaceAll('\r\n', '\n'); const from = normalized.indexOf('[[');
  expect(await pending).toEqual({ from, to: from + 6 });
  await expect(readReferenceRange(`${paragraph}\n\n${paragraph}`, reference, new AbortController().signal)).resolves.toBeNull();
});
