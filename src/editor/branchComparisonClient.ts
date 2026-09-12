import { plainComparison, SENTENCE_TEXT_LIMIT, type TextComparison } from '../diff/compareText';

/** Each calculation has one disposable worker. Cancelled selections cannot publish old highlights. */
export function compareBranchText(oldText: string, newText: string, signal: AbortSignal): Promise<TextComparison> {
  if (signal.aborted) return Promise.reject(new DOMException('比较已取消', 'AbortError'));
  if (oldText.length + newText.length > SENTENCE_TEXT_LIMIT) return Promise.resolve(plainComparison());
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('../diff/compareWorker.ts', import.meta.url), { type: 'module' }); }
    catch { resolve(plainComparison('句级比较无法启动，完整正文仍可阅读。')); return; }
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('比较已取消', 'AbortError')); };
    const timeout = setTimeout(() => { cleanup(); resolve(plainComparison('句级比较超过 8 秒，已停止高亮计算；完整正文仍可阅读。')); }, 8_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: TextComparison; error?: string }>) => {
      cleanup(); resolve(event.data.result ?? plainComparison(event.data.error));
    };
    worker.onerror = () => { cleanup(); resolve(plainComparison('句级比较失败，完整正文仍可阅读。')); };
    try { worker.postMessage({ oldText, newText }); }
    catch { cleanup(); resolve(plainComparison('句级比较无法传输，完整正文仍可阅读。')); }
  });
}
