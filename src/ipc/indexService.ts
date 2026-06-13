import Database from '@tauri-apps/plugin-sql';
import { useVaultStore } from '../stores/useVaultStore';
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

/**
 * vault 根 → 索引库 sqlite: 连接串。Windows `std::fs::canonicalize`（Tauri 文件夹选择/规范化）会产出扩展
 * 长度前缀 `\\?\`（UNC 形 `\\?\UNC\`），必须剥除：留着会让 `sqlite://?/...` 的 `//?/` 被 URI 解析成
 * 空 authority + query 串，连到错误/空库 —— 这是反链/未链接提及恒空的真因（真机 vault 才暴露，干净路径漏检）。
 * 剥前缀后把 '\' 归一为 '/' 再拼库相对路径。
 */
export function indexDbUrl(root: string): string {
  let p = root;
  if (p.startsWith('\\\\?\\UNC\\')) p = '\\\\' + p.slice(8);
  else if (p.startsWith('\\\\?\\')) p = p.slice(4);
  return `sqlite:${toSlash(p)}/.inkstream/index.db`;
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

// ---- 只读查询（W4 反链 / unlinked mentions）-------------------------------------------
//
// 前端经 tauri-plugin-sql 只读连接（capability sql:default，无 allow-execute——写全在 Rust）打开同一
// <vault>/.inkstream/index.db（WAL 由 Rust 写连接持久化，读连接自动继承）。库路径在本层强拼当前 vault 根
// （业务代码不得自由传 URI）。连接懒开（首次查询时，此刻 Rust 写连接早已建好库 + WAL）+ 切 vault 重连。

let dbConn: Promise<Database> | null = null;
let dbRoot: string | null = null;

/** 当前 vault 的只读索引连接（懒开；切 vault 重连；无 vault 返 null）。 */
function indexDb(): Promise<Database> | null {
  const root = useVaultStore.getState().vault?.root ?? null;
  if (root === null) return null;
  if (dbRoot !== root) {
    dbConn = null;
    dbRoot = root;
  }
  if (dbConn === null) {
    dbConn = Database.load(indexDbUrl(root));
  }
  return dbConn;
}

/** 查询/连接失败后弃连接，下次重开（如库尚未建好、切 vault）。 */
function resetConn(): void {
  dbConn = null;
}

/** 文件路径 → 反链匹配键（裸名 / 无扩展路径 / 全路径，对应 links.target_raw 三形态）。 */
function backlinkKeys(filePath: string): { nameNoExt: string; pathNoMd: string; path: string } {
  const path = toSlash(filePath);
  const pathNoMd = path.endsWith('.md') ? path.slice(0, -3) : path;
  const nameNoExt = pathNoMd.split('/').pop() ?? pathNoMd;
  return { nameNoExt, pathNoMd, path };
}

/** 反链：哪些文件以 `[[]]` 引用了 filePath（按 target_raw 三形态匹配，排除自身），返回 source_path 列表。 */
export async function queryBacklinks(filePath: string): Promise<string[]> {
  const conn = indexDb();
  if (!conn) return [];
  const k = backlinkKeys(filePath);
  try {
    const db = await conn;
    const rows = await db.select<Array<{ source_path: string }>>(
      'SELECT DISTINCT source_path FROM links WHERE target_raw IN (?, ?, ?) AND source_path <> ? ORDER BY source_path',
      [k.nameNoExt, k.pathNoMd, k.path, k.path],
    );
    return rows.map((r) => r.source_path);
  } catch {
    resetConn();
    return [];
  }
}

/** unlinked mentions：正文提及文件名却未建 `[[]]` 链的文件（trigram MATCH 文件名，排除自身 + 已反链）。 */
export async function queryUnlinkedMentions(filePath: string): Promise<string[]> {
  const conn = indexDb();
  if (!conn) return [];
  const k = backlinkKeys(filePath);
  if (k.nameNoExt.length < 3) return []; // trigram 最小可搜 3 字，短名跳过。
  try {
    const db = await conn;
    const rows = await db.select<Array<{ path: string }>>(
      'SELECT path FROM files_fts WHERE files_fts MATCH ? ORDER BY path LIMIT 100',
      [`"${k.nameNoExt}"`],
    );
    const linked = new Set(await queryBacklinks(filePath));
    return rows.map((r) => r.path).filter((p) => p !== k.path && !linked.has(p));
  } catch {
    resetConn();
    return [];
  }
}
