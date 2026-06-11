import type { TreeEntry, VaultInfo } from './vault';

/** 单条 IPC command 的形状：参数与返回值。 */
export interface IpcCommandEntry {
  args: Record<string, unknown> | undefined;
  result: unknown;
}

/**
 * IPC command 注册表：command 名 -> { args; result } 映射。
 * 新增 Rust command 时在此登记，`src/ipc/invoke.ts` 的泛型签名即获得端到端类型约束。
 * 键名与 Rust `#[tauri::command]` 函数名（snake_case）一致。
 */
export interface IpcCommands {
  open_vault: { args: { path: string }; result: VaultInfo };
  list_dir: { args: { root: string; rel: string }; result: TreeEntry[] };
  find_repo_root: { args: { path: string }; result: string | null };
  read_file: { args: { root: string; path: string }; result: string };
}
