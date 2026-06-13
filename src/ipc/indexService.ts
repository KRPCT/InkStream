import { invoke } from './invoke';

/**
 * FTS5 索引写侧 IPC 收口（Phase 4 W1）。
 *
 * 写全部经 Rust 端 sqlx 单写入队列（index.rs worker），本层只投递；前端只读查询（W2）另走
 * tauri-plugin-sql Database API（届时同样在本层收口、库路径强拼 vaultRoot+/.inkstream/index.db）。
 *
 * 路径一律归一为 '/' 分隔的 vault 相对路径（Rust 侧再 NFC 规范化作 files.path 键）——与 rebuild 的
 * Rust 枚举路径（'/' + NFC）一致，保索引键单一。命令失败不应阻断编辑/保存（调用方 fire-and-forget）。
 */

/** 相对路径分隔归一为 '/'（字符串方法，不用正则）。 */
function toSlash(path: string): string {
  return path.split('\\').join('/');
}

/** 仅 .md 进全文索引（与 Rust rebuild 仅扫 .md 一致）。 */
export function isIndexable(path: string): boolean {
  return path.endsWith('.md');
}

/** 单篇文档 upsert（autosave 写盘成功 / 外部变更后调）。 */
export function indexUpsertDoc(path: string, content: string): Promise<null> {
  return invoke('index_upsert_doc', { path: toSlash(path), content });
}

/** 删除一篇文档的索引（外部删除后调）。 */
export function indexRemoveDoc(path: string): Promise<null> {
  return invoke('index_remove_doc', { path: toSlash(path) });
}

/** 全量重建索引（打开 vault 时 / 「重建索引」命令）：worker 开库 + 清表 + 扫 .md 重灌。 */
export function indexRebuild(root: string): Promise<null> {
  return invoke('index_rebuild', { root });
}

/** 仅打开/切换索引库（不全量重建）：worker 开 <root>/.inkstream/index.db。 */
export function indexSwitchVault(root: string): Promise<null> {
  return invoke('index_switch_vault', { root });
}
