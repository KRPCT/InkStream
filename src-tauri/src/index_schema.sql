-- Phase 4 W1 FTS5 索引 schema（index.rs 经 include_str! 内嵌，首次开库以 sqlx::raw_sql 执行多语句）。
-- 全部 CREATE IF NOT EXISTS / INSERT OR IGNORE，幂等可重复执行。schema 演进经 index_meta.schema_version 判定。
-- 该库位于 <vault>/.inkstream/index.db，连同 -wal/-shm 由 .inkstream/.gitignore('*') 整目录忽略，不入用户 git。

-- 文件元数据 + 原文。content 既是 external-content FTS 的真相源（省一半磁盘：FTS 不另存正文副本），
-- 也供后续反链解析 / 断链 lint / 高亮回显复用。rowid 显式整数主键，供 files_fts 的 content_rowid 关联。
CREATE TABLE IF NOT EXISTS files (
  rowid        INTEGER PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,          -- NFC 规范化的 vault 相对路径（'/' 分隔，跨平台键统一）
  content      TEXT NOT NULL DEFAULT '',
  mtime        INTEGER NOT NULL DEFAULT 0,     -- 文件 mtime（秒），增量判脏
  size         INTEGER NOT NULL DEFAULT 0,
  content_hash INTEGER NOT NULL DEFAULT 0,     -- 内容指纹（std DefaultHasher，仅判变化），未变则跳过重灌
  indexed_at   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

-- FTS5 全文索引（external-content 指向 files.content）。
-- trigram：中文按 3 字滑窗成 token，规避 unicode61 把整句 CJK 当一个 token（中文搜索失效，CLAUDE.md 已定）。
-- case_sensitive 0：英文大小写不敏感（trigram 默认敏感）；中文不受影响。<3 字查询召回弱属 trigram 固有，搜索 UI 提示≥3 字。
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  content,
  path UNINDEXED,
  content='files',
  content_rowid='rowid',
  tokenize="trigram case_sensitive 0"
);

-- external-content 同步触发器：FTS 不自动跟随基表，须用官方 'delete' 命令模式手工同步。
-- INSERT 列序严格 = fts5 声明列序 (content, path)，否则倒排写错列。
CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, content, path) VALUES (new.rowid, new.content, new.path);
END;
CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, content, path) VALUES ('delete', old.rowid, old.content, old.path);
END;
CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, content, path) VALUES ('delete', old.rowid, old.content, old.path);
  INSERT INTO files_fts(rowid, content, path) VALUES (new.rowid, new.content, new.path);
END;

-- 反链边表：一行 = 一条 [[wiki]] / [@cite] 引用。W1 仅建表，W2' 由解析器填充。
-- idx_links_resolved 支撑「谁引用我」反链查询；target_resolved IS NULL = 断链（lint）；idx_links_raw 供重命名重解析。
CREATE TABLE IF NOT EXISTS links (
  id              INTEGER PRIMARY KEY,
  source_path     TEXT NOT NULL,               -- 引用方文件（NFC 相对路径），随 source 重索引整体替换
  target_raw      TEXT NOT NULL,               -- 原始目标内核（[[A/B|别名#标题^块]] 的 'A/B'）
  target_resolved TEXT,                         -- 解析到的真实文件 path；NULL = 断链
  alias           TEXT,
  heading         TEXT,
  block_id        TEXT,
  kind            TEXT NOT NULL DEFAULT 'wikilink'   -- wikilink / embed / citation
);
CREATE INDEX IF NOT EXISTS idx_links_source   ON links(source_path);
CREATE INDEX IF NOT EXISTS idx_links_resolved ON links(target_resolved);
CREATE INDEX IF NOT EXISTS idx_links_raw      ON links(target_raw);

-- schema 版本（迁移/重建判定）。
CREATE TABLE IF NOT EXISTS index_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
INSERT OR IGNORE INTO index_meta(k, v) VALUES ('schema_version', '1');
