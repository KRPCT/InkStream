import { collectWikiReferences, hasUnlinkedMention, referenceRangeFrom, type WikiReference } from './wikiReferences';

function analyze(doc: string, mention: string | undefined, signal: AbortSignal): Promise<WikiReference[] | boolean> {
  if (signal.aborted) return Promise.reject(new DOMException('查询已取消', 'AbortError'));
  if (doc.length <= 64_000) return Promise.resolve(mention === undefined ? collectWikiReferences(doc) : hasUnlinkedMention(doc, mention));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./wikiReferenceWorker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error('无法启动长文档关联解析，请重试。')); return; }
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; worker.terminate(); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(new DOMException('查询已取消', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('长文档关联解析超时，请缩小文档后重试。')), 8_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: WikiReference[] | boolean; error?: string }>) => {
      if (settled) return;
      if (event.data.error || event.data.result === undefined) fail(new Error(event.data.error ?? '关联解析未返回结果'));
      else { settled = true; cleanup(); resolve(event.data.result); }
    };
    worker.onerror = () => fail(new Error('关联解析失败，请重试。'));
    try { worker.postMessage({ doc, mention }); }
    catch (error) { fail(error); }
  });
}

export async function readWikiReferences(doc: string, signal: AbortSignal): Promise<WikiReference[]> {
  const result = await analyze(doc, undefined, signal);
  if (!Array.isArray(result)) throw new Error('关联解析返回类型错误');
  return result;
}
export async function readUnlinkedMention(doc: string, name: string, signal: AbortSignal): Promise<boolean> {
  const result = await analyze(doc, name, signal);
  if (typeof result !== 'boolean') throw new Error('提及解析返回类型错误');
  return result;
}
export async function readReferenceRange(doc: string, reference: WikiReference, signal: AbortSignal): Promise<{ from: number; to: number } | null> {
  return referenceRangeFrom(doc, reference, await readWikiReferences(doc, signal));
}
