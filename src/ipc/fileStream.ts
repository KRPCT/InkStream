import type { FileReadMessage, FileReadOptions, FileReadTarget } from '../types/fileTransfer';
import { inFileReadQueue, readAbortReason } from './fileReadQueue';
import { invoke, invokeStreamed } from './invoke';

const CHUNK_BYTES = 256 * 1024;
const ACK_BYTES = 2 * CHUNK_BYTES;
const HEADER_BYTES = 8;
const IDLE_MS = 15_000;
const TOTAL_MS = 120_000;

interface Receiver<T> {
  begin: (byteLength: number) => void;
  append: (bytes: Uint8Array) => void;
  finish: () => T;
  dispose: () => void;
}

function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readWithinBudget<T>(target: FileReadTarget, options: FileReadOptions | undefined, receiver: Receiver<T>): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new DOMException('文件读取已取消', 'AbortError'));
  if (options?.signal?.aborted) return Promise.reject(new DOMException('文件读取已取消', 'AbortError'));
  options?.signal?.addEventListener('abort', abort, { once: true });
  // 总期限包含排队时间，进度消息不能无限延长任务。
  const timeout = setTimeout(() => controller.abort(new Error('文件读取超过120秒总期限。')), TOTAL_MS);
  return inFileReadQueue(controller.signal, () => collect(target, controller.signal, receiver))
    .finally(() => {
      clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', abort);
      receiver.dispose();
    });
}

function collect<T>(target: FileReadTarget, signal: AbortSignal, receiver: Receiver<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(readAbortReason(signal));
  const id = requestId();
  return new Promise((resolve, reject) => {
    let settled = false;
    let started = false;
    let ended = false;
    let invoked = false;
    let invocationComplete = false;
    let expected = 0;
    let received = 0;
    let acknowledged = 0;
    let idleTimer: ReturnType<typeof setTimeout>;
    const cancelNative = (): void => { void invoke('cancel_file_read', { requestId: id }).catch(() => {}); };
    const cleanup = (): void => {
      clearTimeout(idleTimer);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      receiver.dispose();
      if (invoked) cancelNative();
      reject(error instanceof Error || error instanceof DOMException ? error : new Error(String(error)));
    };
    const onAbort = (): void => fail(readAbortReason(signal));
    const touch = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail(new Error('文件读取15秒没有进展，已取消。')), IDLE_MS);
    };
    const finish = (): void => {
      if (settled || !ended || !invocationComplete) return;
      try {
        const value = receiver.finish();
        settled = true;
        cleanup();
        resolve(value);
      } catch (error) { fail(error); }
    };
    const deliver = (message: FileReadMessage): void => {
      if (settled) {
        // 取消早于原生注册时，收到start后再通知一次，避免遗漏取消。
        if (!started && !(message instanceof ArrayBuffer) && message?.type === 'start') {
          started = true;
          cancelNative();
        }
        return;
      }
      try {
        if (message instanceof ArrayBuffer) {
          if (!started || ended || message.byteLength <= HEADER_BYTES || message.byteLength > CHUNK_BYTES + HEADER_BYTES) {
            throw new Error('文件读取收到无效数据帧。');
          }
          const offset = new DataView(message).getBigUint64(0, true);
          if (offset !== BigInt(received)) throw new Error('文件读取的数据帧顺序不一致。');
          const bytes = new Uint8Array(message, HEADER_BYTES);
          if (received + bytes.byteLength > expected) throw new Error('文件读取超出声明的长度。');
          receiver.append(bytes);
          received += bytes.byteLength;
          if (received - acknowledged >= ACK_BYTES || received === expected) {
            acknowledged = received;
            void invoke('ack_file_read', { requestId: id, receivedBytes: received }).catch(fail);
          }
        } else if (message?.type === 'start') {
          const maximumMiB = target.kind === 'image' ? 25 : 100;
          if (started || !Number.isSafeInteger(message.byteLength) || message.byteLength < 0 || message.chunkBytes !== CHUNK_BYTES) {
            throw new Error('文件读取的长度或分块信息无效。');
          }
          if (message.byteLength > maximumMiB * 1024 * 1024) throw new Error(`文件超过${maximumMiB}MiB读取上限。`);
          expected = message.byteLength;
          receiver.begin(expected);
          started = true;
        } else if (message?.type === 'end') {
          if (!started || ended || received !== expected || message.byteLength !== expected) {
            throw new Error('文件读取未完整结束。');
          }
          ended = true;
        } else throw new Error('文件读取收到未知消息。');
        touch();
        finish();
      } catch (error) { fail(error); }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    touch();
    try {
      invoked = true;
      void invokeStreamed('read_file_stream', { requestId: id, target }, deliver).then(() => {
        invocationComplete = true;
        finish();
      }, fail);
    } catch (error) { fail(error); }
  });
}

export function readTextStream(target: FileReadTarget, options?: FileReadOptions): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const parts: string[] = [];
  return readWithinBudget(target, options, {
    begin: () => {},
    append: (bytes) => { parts.push(decoder.decode(bytes, { stream: true })); },
    finish: () => { parts.push(decoder.decode()); return parts.join(''); },
    dispose: () => { parts.length = 0; },
  });
}

export function readBytesStream(target: FileReadTarget, options?: FileReadOptions): Promise<Uint8Array> {
  let bytes: Uint8Array | null = null;
  let position = 0;
  return readWithinBudget(target, options, {
    begin: (length) => { bytes = new Uint8Array(length); },
    append: (chunk) => { bytes!.set(chunk, position); position += chunk.byteLength; },
    finish: () => bytes!,
    dispose: () => { bytes = null; },
  });
}
