import { invoke as tauriInvoke, Channel } from '@tauri-apps/api/core';
import type { IpcCommands } from '../types/ipc';

/**
 * 类型化 invoke：command 名、参数与返回值由 `src/types/ipc.ts` 的 IpcCommands 约束。
 * 业务代码一律经此函数调用 Rust command，不得直接 import @tauri-apps/api。
 */
export function invoke<K extends keyof IpcCommands>(
  cmd: K,
  args: IpcCommands[K]['args'],
): Promise<IpcCommands[K]['result']> {
  return tauriInvoke(cmd, args);
}

/**
 * Channel 流式 invoke 骨架：单次 invoke 负载 > 1MB 必须改走此通道（红线见 src/ipc/README.md）。
 * 对应 Rust command 须接收一个名为 `channel` 的 `tauri::ipc::Channel` 参数并分块回传。
 */
export function invokeStreamed<K extends keyof IpcCommands, TChunk>(
  cmd: K,
  args: IpcCommands[K]['args'],
  onChunk: (chunk: TChunk) => void,
): Promise<IpcCommands[K]['result']> {
  const channel = new Channel<TChunk>();
  channel.onmessage = onChunk;
  return tauriInvoke(cmd, { ...args, channel });
}
