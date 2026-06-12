import type { FileEntry, TreeEntry, VaultInfo } from './vault';

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
  // 快速打开（Ctrl+P）vault 文件清单递归枚举（FILE-03）。
  list_files: { args: { root: string }; result: FileEntry[] };
  find_repo_root: { args: { path: string }; result: string | null };
  read_file: { args: { root: string; path: string }; result: string };
  // 写侧 command（02-03）。均经 path_guard 校验落在 vault 根内；同名拒绝绝不覆盖（D-12）。
  write_file_atomic: { args: { root: string; path: string; content: string }; result: null };
  create_file: { args: { root: string; path: string }; result: null };
  create_dir: { args: { root: string; path: string }; result: null };
  rename_path: { args: { root: string; from: string; to: string }; result: null };
  move_path: { args: { root: string; from: string; to: string }; result: null };
  trash_path: { args: { root: string; path: string }; result: null };
  // watcher 生命周期（切 vault 时 stop 旧 start 新）。
  start_watch: { args: { root: string }; result: null };
  stop_watch: { args: undefined; result: null };
}
