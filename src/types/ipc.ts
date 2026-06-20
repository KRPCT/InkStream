import type {
  BranchInfo,
  Comment,
  CommitInfo,
  DiffTarget,
  FileDiff,
  GitOpResult,
  GitRef,
  GitStatus,
  Issue,
  MergeMethod,
  MergeResult,
  PullOutcome,
  PullRequest,
  ResetMode,
  Review,
  ReviewEvent,
  StashEntry,
} from './git';
import type { DirTreeEntry } from './bookshelf';
import type { FileEntry, TreeEntry, VaultInfo } from './vault';
import type { CslItem, ZoteroCredStatus, ZoteroItem, ZoteroSyncResult } from './zotero';

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
  // 文件导出二进制写（DOCX 等）：绝对路径 + 字节数组（Uint8Array→Vec<u8>），同 write_file_to_path 授权边界。
  write_file_bytes: { args: { path: string; content: number[] }; result: null };
  // 阅读模式二进制读（DOCX/EPUB/PDF）：绝对路径 → 字节数组（Vec<u8>→Uint8Array）。read_file 仅 UTF-8 文本。
  read_file_bytes: { args: { path: string }; result: number[] };
  // 书架文件夹导入：读绝对路径文件夹的书籍目录树（书→卷→章，深度封顶，只读）。
  list_dir_tree: { args: { path: string }; result: DirTreeEntry };
  // 文件导出：检测系统 pandoc + 经其把 gfm markdown 转更多格式（odt/rtf/latex/epub/typst/org）。
  pandoc_available: { args: undefined; result: boolean };
  pandoc_convert: { args: { markdown: string; outPath: string; toFormat: string }; result: null };
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
  git_log: {
    args: { repoRoot: string; refs: string[]; skip: number; limit: number };
    result: CommitInfo[];
  };
  git_diff: { args: { repoRoot: string; target: DiffTarget }; result: FileDiff[] };
  git_refs: { args: { repoRoot: string }; result: GitRef[] };
  // Phase 6 W3 写命令。产生提交类（commit/merge/cherry-pick/revert）走 git CLI -S 签名；引用操作走 git2。
  git_commit: { args: { repoRoot: string; message: string; paths: string[] }; result: GitOpResult };
  git_merge: { args: { repoRoot: string; branch: string }; result: GitOpResult };
  git_cherry_pick: { args: { repoRoot: string; oid: string }; result: GitOpResult };
  git_revert: { args: { repoRoot: string; oid: string }; result: GitOpResult };
  git_checkout: { args: { repoRoot: string; target: string; force: boolean }; result: null };
  git_create_branch: {
    args: { repoRoot: string; name: string; targetOid: string | null; checkout: boolean };
    result: null;
  };
  git_delete_branch: { args: { repoRoot: string; name: string }; result: null };
  git_reset: {
    args: { repoRoot: string; targetOid: string; mode: ResetMode; confirmHard: boolean };
    result: null;
  };
  git_tag_create: {
    args: { repoRoot: string; name: string; targetOid: string | null; message: string | null };
    result: null;
  };
  git_tag_delete: { args: { repoRoot: string; name: string }; result: null };
  git_stash_save: { args: { repoRoot: string; message: string }; result: null };
  git_stash_pop: { args: { repoRoot: string; index: number }; result: null };
  git_stash_drop: { args: { repoRoot: string; index: number }; result: null };
  git_stash_list: { args: { repoRoot: string }; result: StashEntry[] };
  git_abort_op: { args: { repoRoot: string }; result: null };
  // Phase 6 W4 远程（SSH）。进度走 Channel（invokeStreamed 追加 channel 参数，args 不含 channel）。
  git_fetch: { args: { repoRoot: string; remote: string }; result: null };
  git_push: { args: { repoRoot: string; remote: string; branch: string }; result: null };
  git_pull: { args: { repoRoot: string; remote: string; branch: string }; result: PullOutcome };
  git_clone: { args: { url: string; dest: string }; result: string };
  // 簇④ GitHub 登录（PAT 存 keyring）。
  git_login_github: { args: { token: string }; result: null };
  git_logout_github: { args: undefined; result: null };
  git_github_status: { args: undefined; result: boolean };
  // Phase 6 GIT-07 GitHub PR（REST API 走 Rust reqwest，token 留 keyring）。owner/repo 由 origin 远程解析。
  gh_pr_list: { args: { repoRoot: string }; result: PullRequest[] };
  gh_pr_create: {
    args: { repoRoot: string; title: string; body: string; base: string; head: string };
    result: PullRequest;
  };
  gh_pr_merge: {
    args: { repoRoot: string; number: number; method: MergeMethod };
    result: MergeResult;
  };
  // Phase 11 GH-02/03：Issue / 评论 / PR diff / PR review（全走 Rust reqwest，token 留 keyring）。
  gh_pr_diff: { args: { repoRoot: string; number: number }; result: FileDiff[] };
  gh_pr_reviews: { args: { repoRoot: string; number: number }; result: Review[] };
  gh_pr_review_create: {
    args: { repoRoot: string; number: number; event: ReviewEvent; body: string };
    result: Review;
  };
  gh_issue_list: { args: { repoRoot: string; state: string }; result: Issue[] };
  gh_issue_create: { args: { repoRoot: string; title: string; body: string }; result: Issue };
  gh_comment_list: { args: { repoRoot: string; number: number }; result: Comment[] };
  gh_comment_create: { args: { repoRoot: string; number: number; body: string }; result: Comment };
  // Phase 11 GH-01：gh CLI 备用登录（探测 + 取 token 存 keyring）。
  gh_cli_status: { args: undefined; result: boolean };
  git_login_github_gh: { args: undefined; result: null };
  // Phase 12 DIFF-03：prose 三向合并冲突读取/解决。
  git_read_conflict: { args: { repoRoot: string; path: string }; result: string };
  git_resolve_conflict: { args: { repoRoot: string; path: string; content: string }; result: null };
  // Phase 8 ZOT-01：Zotero Better BibTeX CAYW（Rust reqwest 代理 localhost:23119）。
  zotero_cayw: { args: undefined; result: string };
  // Phase 8 ZOT-03：Zotero 库全部 citekey（Citation Panel 未解析判定）。
  zotero_citekeys: { args: undefined; result: string[] };
  // Phase 8 ACAD-01：Zotero 库条目（Sidebar 文献库）。
  zotero_items: { args: undefined; result: ZoteroItem[] };
  // Phase 8 ZOT-04：指定 citekey 的完整 CSL-JSON 条目（参考文献按样式展开）。
  zotero_csl: { args: { keys: string[] }; result: CslItem[] };
  // Phase 8 ZOT-02：Web API 凭据（keyring）+ 增量同步 + 离线缓存读取。
  zotero_set_credentials: { args: { apiKey: string; userId: string }; result: null };
  zotero_clear_credentials: { args: undefined; result: null };
  zotero_credentials_status: { args: undefined; result: ZoteroCredStatus };
  zotero_sync: { args: undefined; result: ZoteroSyncResult };
  zotero_cache_items: { args: undefined; result: ZoteroItem[] };
  zotero_cache_csl: { args: { keys: string[] }; result: CslItem[] };
  // #6：冷启动「打开方式」——取启动 argv 解析到的文件绝对路径（消费一次，无则 null）。
  initial_open_file: { args: undefined; result: string | null };
}
