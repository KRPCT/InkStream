import { vi } from 'vitest';

interface CompileRequest {
  type: 'compile';
  id: number;
  source: string;
}

/** 只替换 Worker 传输边界；不模拟 Typst 编译器，也不能作为 WASM 验收。 */
export class ControlledTypstWorker extends EventTarget {
  static instances: ControlledTypstWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly sent: unknown[] = [];
  readonly terminate = vi.fn();

  constructor() {
    super();
    ControlledTypstWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  emit(data: unknown): void {
    const event = new MessageEvent('message', { data });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }

  fail(message: string): void {
    const event = new ErrorEvent('error', { message, cancelable: true });
    this.onerror?.(event);
    this.dispatchEvent(event);
  }

  compileRequests(): CompileRequest[] {
    return this.sent.filter((message): message is CompileRequest =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === 'compile',
    );
  }
}

export function installControlledTypstWorker(): void {
  ControlledTypstWorker.instances = [];
  vi.stubGlobal('Worker', ControlledTypstWorker);
}

export function latestTypstWorker(): ControlledTypstWorker {
  const worker = ControlledTypstWorker.instances.at(-1);
  if (!worker) throw new Error('Typst Worker was not created');
  return worker;
}
