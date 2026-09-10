import type { FileWriteMetadata, FileWriteTarget } from '../types/fileTransfer';
import { invoke } from './invoke';

const MAX_METADATA_BYTES = 256 * 1024;
const ENCODE_UNITS = 256 * 1024;
const YIELD_UNITS = 1024 * 1024;
const MAX_ACTIVE = 4;
const MAX_CHUNK_BYTES = 256 * 1024;
const TOTAL_TIMEOUT_MS = 120_000;
const IDLE_TIMEOUT_MS = 15_000;
let active = 0;
const waiting: Array<() => void> = [];

/** 原有每文档保存顺序仍由 autosave 保证；这里限制同时编码/传输的完整正文数。 */
function enqueue<T>(write: (deadline: number) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    let queuedTimer: ReturnType<typeof setTimeout> | undefined;
    const start = (): void => {
      if (queuedTimer !== undefined) clearTimeout(queuedTimer);
      if (Date.now() >= deadline) { reject(new Error('文件写入排队超时，原文件未修改。')); return; }
      active += 1;
      void Promise.resolve().then(() => write(deadline)).then(resolve, reject).finally(() => {
        active -= 1;
        while (active < MAX_ACTIVE && waiting.length > 0) waiting.shift()?.();
      });
    };
    if (active < MAX_ACTIVE) start();
    else {
      waiting.push(start);
      queuedTimer = setTimeout(() => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error('文件写入排队超时，原文件未修改。'));
      }, TOTAL_TIMEOUT_MS);
    }
  });
}

function highSurrogate(unit: number): boolean { return unit >= 0xd800 && unit <= 0xdbff; }
function lowSurrogate(unit: number): boolean { return unit >= 0xdc00 && unit <= 0xdfff; }

/** TextEncoder 默认替换非法代理项；保存不能把无效输入悄悄改写成替代字符。 */
function requireWellFormed(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (highSurrogate(unit)) {
      if (index + 1 >= text.length || !lowSurrogate(text.charCodeAt(index + 1))) throw new Error('保存内容包含未配对的 UTF-16 代理项。');
      index += 1;
    } else if (lowSurrogate(unit)) throw new Error('保存内容包含未配对的 UTF-16 代理项。');
  }
}

async function encodeText(text: string, deadline: number): Promise<{ chunks: Uint8Array[]; byteLength: number }> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let offset = 0;
  let lastYield = 0;
  let sliceStarted = performance.now();
  while (offset < text.length) {
    requireTime(deadline);
    let end = Math.min(text.length, offset + ENCODE_UNITS);
    if (end < text.length && highSurrogate(text.charCodeAt(end - 1))) end -= 1;
    const part = text.slice(offset, end);
    requireWellFormed(part);
    const bytes = encoder.encode(part);
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    offset = end;
    if (offset < text.length && (offset - lastYield >= YIELD_UNITS || performance.now() - sliceStarted >= 8)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYield = offset;
      sliceStarted = performance.now();
    }
  }
  return { chunks, byteLength };
}

function requireTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('文件写入超过总期限，原文件未修改。');
  return remaining;
}

function waitForAck<T>(response: Promise<T>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('文件写入等待确认超时，原文件未修改。')), timeout);
    response.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function sendSession(target: FileWriteTarget, encoding: FileWriteMetadata['encoding'], chunks: readonly Uint8Array[], byteLength: number, deadline: number): Promise<null> {
  const requestId = crypto.randomUUID();
  const metadata: FileWriteMetadata = { version: 1, requestId, target, encoding, byteLength, timeoutMs: requireTime(deadline) };
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  if (header.byteLength > MAX_METADATA_BYTES) throw new Error('文件写入 metadata 超过大小上限。');
  try {
    await waitForAck(invoke('begin_file_write', { metadata }), Math.min(IDLE_TIMEOUT_MS, requireTime(deadline)));
    let offset = 0;
    for (const chunk of chunks) {
      for (let start = 0; start < chunk.byteLength; start += MAX_CHUNK_BYTES) {
        const timeout = Math.min(IDLE_TIMEOUT_MS, requireTime(deadline));
        const body = chunk.subarray(start, Math.min(chunk.byteLength, start + MAX_CHUNK_BYTES));
        await waitForAck(invoke('append_file_write', body, { headers: {
          'x-inkstream-write-id': requestId,
          'x-inkstream-write-offset': String(offset),
        } }), timeout);
        offset += body.byteLength;
      }
    }
    requireTime(deadline);
    // 发布点与取消由原生统一裁决；commit 必须等真实 rename 回执。
    return await invoke('commit_file_write', { requestId });
  } catch (error) {
    await waitForAck(invoke('abort_file_write', { requestId }), 1_000).catch(() => undefined);
    throw error;
  }
}

export function writeTextRaw(target: FileWriteTarget, content: string): Promise<null> {
  return enqueue(async (deadline) => {
    const encoded = await encodeText(content, deadline);
    return sendSession(target, 'utf8', encoded.chunks, encoded.byteLength, deadline);
  });
}

export function writeBytesRaw(target: FileWriteTarget, content: Uint8Array): Promise<null> {
  // 接受调用时即保留内容快照：调用方随后复用原 buffer 不得改变待保存的字节。
  const snapshot = new Uint8Array(content);
  return enqueue((deadline) => sendSession(target, 'bytes', [snapshot], snapshot.byteLength, deadline));
}
