const MAX_ACTIVE = 4;
const MAX_QUEUED = 1024;
let active = 0;
const queued: Array<() => void> = [];

export function readAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error || signal.reason instanceof DOMException
    ? signal.reason
    : new DOMException('文件读取已取消', 'AbortError');
}

/** 统一约束现有并行搜索、阅读器和导航的读取量；取消的排队任务不会进入原生端。 */
export function inFileReadQueue<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(readAbortReason(signal));
  return new Promise((resolve, reject) => {
    const cancelQueued = (): void => {
      const index = queued.indexOf(start);
      if (index >= 0) queued.splice(index, 1);
      signal.removeEventListener('abort', cancelQueued);
      reject(readAbortReason(signal));
    };
    const start = (): void => {
      signal.removeEventListener('abort', cancelQueued);
      if (signal.aborted) { reject(readAbortReason(signal)); return; }
      active += 1;
      void Promise.resolve().then(read).then(resolve, reject).finally(() => {
        active -= 1;
        while (active < MAX_ACTIVE && queued.length > 0) queued.shift()?.();
      });
    };
    if (active < MAX_ACTIVE) start();
    else if (queued.length >= MAX_QUEUED) reject(new Error('待读取文件过多，请稍后重试。'));
    else {
      queued.push(start);
      signal.addEventListener('abort', cancelQueued, { once: true });
    }
  });
}
