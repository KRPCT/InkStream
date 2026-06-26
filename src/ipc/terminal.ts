import { invoke, invokeStreamed } from './invoke';

/**
 * 内置终端 IPC 封装（v1.2 #3）。
 *
 * 输出走 Channel（高吞吐，不 emit/listen）：Rust 读线程以 `InvokeResponseBody::Raw` 回传原始字节
 * （前端 onmessage 收 ArrayBuffer），进程退出以 `Json` 回传 `{type:"exit"}`（前端收对象）。单条 Channel
 * 有序，二变体按 `instanceof ArrayBuffer` 区分。键入/尺寸/关闭走普通 invoke。
 */

export type TerminalEvent = { kind: 'data'; bytes: Uint8Array } | { kind: 'exit' };

/** 开终端会话：onEvent 收输出字节 / 退出通知；resolve 会话 id。cwd=null 则继承当前目录。 */
export function terminalOpen(
  args: { cwd: string | null; cols: number; rows: number },
  onEvent: (e: TerminalEvent) => void,
): Promise<number> {
  return invokeStreamed('terminal_open', args, (chunk: ArrayBuffer | { type?: string }) => {
    if (chunk instanceof ArrayBuffer) onEvent({ kind: 'data', bytes: new Uint8Array(chunk) });
    else if (chunk && chunk.type === 'exit') onEvent({ kind: 'exit' });
  });
}

/** 向会话写入键入（xterm onData 文本）。 */
export function terminalWrite(id: number, data: string): Promise<null> {
  return invoke('terminal_write', { id, data });
}

/** 调整会话列/行（xterm fit 后回传）。 */
export function terminalResize(id: number, cols: number, rows: number): Promise<null> {
  return invoke('terminal_resize', { id, cols, rows });
}

/** 关闭会话（杀子进程，幂等）。 */
export function terminalClose(id: number): Promise<null> {
  return invoke('terminal_close', { id });
}
