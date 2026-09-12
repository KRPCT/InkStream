import { parseConflicts, type ParsedConflicts } from '../diff/parseConflicts';

/** Small linear parses stay local; long chapters have an owned disposable worker. */
export function parseConflictDocument(content: string, signal: AbortSignal): Promise<ParsedConflicts> {
  if (signal.aborted) return Promise.reject(new DOMException('读取冲突已取消', 'AbortError'));
  if (content.length <= 200_000) return Promise.resolve(parseConflicts(content));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('../diff/conflictParserWorker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error('大冲突正文解析器无法启动；原文保留，请重试或在外部编辑器处理。')); return; }
    const cleanup = () => { worker.terminate(); clearTimeout(timeout); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('读取冲突已取消', 'AbortError')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('冲突解析超过 8 秒，已停止；原文保留，未允许写入。')); }, 8_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<ParsedConflicts>) => { cleanup(); resolve(event.data); };
    worker.onerror = () => { cleanup(); reject(new Error('冲突解析失败；原文保留，未允许写入。')); };
    try { worker.postMessage(content); } catch (error) { cleanup(); reject(error); }
  });
}
