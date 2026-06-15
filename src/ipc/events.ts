import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from './invoke';

/** 取消订阅函数类型（自 @tauri-apps/api 重导出，业务层经 ipc/ 收口取用，不直接 import）。 */
export type { UnlistenFn };

/**
 * 后端事件订阅收口层（唯一接触 @tauri-apps/api/event 的文件之一）。
 *
 * watcher 变更经 `vault://change` channel 推前端；业务层（02-04 冲突仲裁）经 onVaultChange
 * 订阅，不直接 import @tauri-apps/api。订阅返回 Promise<UnlistenFn>，照 window.ts onThemeChanged 范式。
 */

/** watcher 变更载荷（与 Rust VaultChange 同形）。 */
export interface VaultChangePayload {
  /** 变更文件的绝对路径。 */
  path: string;
  /** 变更类型标签（create / modify / remove / other）。 */
  kind: string;
}

/**
 * 订阅 vault 外部变更（FILE-02）。本任务建通道，冲突仲裁消费留 02-04。
 * 返回取消订阅函数的 Promise。
 */
export function onVaultChange(cb: (payload: VaultChangePayload) => void): Promise<UnlistenFn> {
  return listen<VaultChangePayload>('vault://change', ({ payload }) => cb(payload));
}

/**
 * 订阅「打开方式」/拖拽转发的文件打开事件（#6）：Rust（单实例第二次启动）发文件绝对路径，
 * 前端路由到 openExternalFile。返回取消订阅函数的 Promise。
 */
export function onOpenFile(cb: (path: string) => void): Promise<UnlistenFn> {
  return listen<string>('inkstream://open-file', ({ payload }) => cb(payload));
}

/** 取冷启动「打开方式」的初始文件参数（argv 解析，消费一次）；无则 null（#6）。 */
export function getInitialOpenFile(): Promise<string | null> {
  return invoke('initial_open_file', undefined);
}

/** 启动 vault 根 watcher（切入新 vault 时调）。 */
export function startWatch(root: string): Promise<null> {
  return invoke('start_watch', { root });
}

/** 停止当前 watcher（切出 / 关闭 vault 时调）。幂等。 */
export function stopWatch(): Promise<null> {
  return invoke('stop_watch', undefined);
}
