import type { BranchInfo, CommitInfo, DiffTarget, FileDiff, GitStatus } from './git';
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
  // 草稿另存为：原生保存对话框给出的绝对路径（用户显式授权边界，不经 path_guard）。
  write_file_to_path: { args: { path: string; content: string }; result: null };
  create_file: { args: { root: string; path: string }; result: null };
  create_dir: { args: { root: string; path: string }; result: null };
  rename_path: { args: { root: string; from: string; to: string }; result: null };
  move_path: { args: { root: string; from: string; to: string }; result: null };
  trash_path: { args: { root: string; path: string }; result: null };
  // watcher 生命周期（切 vault 时 stop 旧 start 新）。
  start_watch: { args: { root: string }; result: null };
  stop_watch: { args: undefined; result: null };
  // Phase 4 W1 FTS5 索引写侧（投递到 Rust 单写入队列；前端只读查询走 plugin-sql Database API，不登记于此）。
  index_upsert_doc: { args: { path: string; content: string }; result: null };
  index_remove_doc: { args: { path: string }; result: null };
  index_rebuild: { args: { root: string }; result: null };
  index_switch_vault: { args: { root: string }; result: null };
  // Phase 6 GIT-01：git 读命令（Rust spawn_blocking；仓库根 = VaultInfo.repoRoot）。
  git_status: { args: { repoRoot: string }; result: GitStatus };
  git_branch_list: { args: { repoRoot: string }; result: BranchInfo[] };
  git_log: { args: { repoRoot: string; skip: number; limit: number }; result: CommitInfo[] };
  git_diff: { args: { repoRoot: string; target: DiffTarget }; result: FileDiff[] };
}
