//! Phase 4 W1：FTS5(trigram) 全库索引服务（写侧，sqlx 一统）。
//!
//! 架构（见记忆 inkstream-phase4-w1-design）：写全部走本 Rust 端 sqlx 独占写连接 + mpsc 单写入队列；
//! 前端只读查询走 tauri-plugin-sql。索引库位 `<vault>/.inkstream/index.db`（WAL；连同 -wal/-shm 由
//! `.inkstream/.gitignore`('*') 整目录忽略，不入用户 git；该点目录亦被 watcher should_emit 跳过，写入不回灌）。
//!
//! 写队列：command 同步投递有界 channel（try_send，满则 Err 前端吞，绝不阻塞 UI）；后台单 worker
//! 独占写连接（max_connections=1 串行写），recv+try_recv 排空 burst 后按 path last-wins 折叠成一次事务
//! （与前端 autosave 500ms / watcher 400ms 协同去重）。worker 全 Result 绝不 panic（panic 杀任务=整库写停摆）。

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;
use unicode_normalization::UnicodeNormalization;

const SCHEMA_SQL: &str = include_str!("index_schema.sql");
const DB_DIR: &str = ".inkstream";
const DB_FILE: &str = "index.db";
const GITIGNORE_BODY: &str = "*\n";
const QUEUE_CAP: usize = 1024;
/// rebuild 分批提交粒度：每 N 文件一次事务，批间让出连接给积压的实时 job。
const REBUILD_BATCH: usize = 200;

/// 写队列任务。`path` 为 NFC 规范化的 vault 相对路径（'/' 分隔）。
#[derive(Debug, Clone)]
pub enum IndexJob {
    Upsert { path: String, content: String },
    Remove { path: String },
    Rebuild { root: PathBuf },
    SwitchVault { root: PathBuf },
}

/// `.manage` 单例：仅持有界 mpsc 发送端；写连接由后台 worker 独占。
pub struct IndexState {
    tx: mpsc::Sender<IndexJob>,
}

impl IndexState {
    fn enqueue(&self, job: IndexJob) -> Result<(), String> {
        self.tx
            .try_send(job)
            .map_err(|e| format!("索引队列繁忙或已关闭: {e}"))
    }
}

/// Builder.setup 注册：建有界 channel + spawn 后台单写 worker。
pub fn init(app: &tauri::App) {
    let (tx, rx) = mpsc::channel::<IndexJob>(QUEUE_CAP);
    app.manage(IndexState { tx });
    tauri::async_runtime::spawn(worker_loop(rx));
}

/// NFC 规范化（索引 path 键跨平台一致）。
fn nfc(s: &str) -> String {
    s.nfc().collect()
}

// ---- commands（同步投递，不阻塞 UI；实际写入全在 worker）-------------------------------

#[tauri::command]
pub fn index_upsert_doc(app: AppHandle, path: String, content: String) -> Result<(), String> {
    app.state::<IndexState>().enqueue(IndexJob::Upsert {
        path: nfc(&path),
        content,
    })
}

#[tauri::command]
pub fn index_remove_doc(app: AppHandle, path: String) -> Result<(), String> {
    app.state::<IndexState>()
        .enqueue(IndexJob::Remove { path: nfc(&path) })
}

#[tauri::command]
pub fn index_rebuild(app: AppHandle, root: String) -> Result<(), String> {
    app.state::<IndexState>().enqueue(IndexJob::Rebuild {
        root: PathBuf::from(root),
    })
}

#[tauri::command]
pub fn index_switch_vault(app: AppHandle, root: String) -> Result<(), String> {
    app.state::<IndexState>().enqueue(IndexJob::SwitchVault {
        root: PathBuf::from(root),
    })
}

// ---- worker（后台单任务，独占写连接）-------------------------------------------------

async fn worker_loop(mut rx: mpsc::Receiver<IndexJob>) {
    let mut pool: Option<SqlitePool> = None;
    while let Some(first) = rx.recv().await {
        // 排空当前 burst（事件驱动去抖，无固定延迟）。
        let mut batch = vec![first];
        while let Ok(job) = rx.try_recv() {
            batch.push(job);
        }
        if let Err(e) = process_batch(&mut pool, batch).await {
            // 绝不 panic：失败仅记日志（索引失败不影响 doc 真相源，可经 index_rebuild 重建）。
            eprintln!("[index] 批处理失败: {e}");
        }
    }
}

async fn process_batch(pool: &mut Option<SqlitePool>, batch: Vec<IndexJob>) -> Result<(), String> {
    // 库级 job（换库/重建重置 pool）按序先行；文档级 job 按 path 折叠 last-wins（去抖核心）。
    let mut latest: HashMap<String, IndexJob> = HashMap::new();
    for job in batch {
        match job {
            IndexJob::SwitchVault { root } => {
                if let Some(p) = pool.take() {
                    p.close().await;
                }
                *pool = Some(open_db(&root).await?);
                latest.clear();
            }
            IndexJob::Rebuild { root } => {
                if let Some(p) = pool.take() {
                    p.close().await;
                }
                let p = open_db(&root).await?;
                rebuild_all(&p, &root).await?;
                *pool = Some(p);
                latest.clear();
            }
            IndexJob::Upsert { path, content } => {
                latest.insert(path.clone(), IndexJob::Upsert { path, content });
            }
            IndexJob::Remove { path } => {
                latest.insert(path.clone(), IndexJob::Remove { path });
            }
        }
    }
    let Some(pool) = pool.as_ref() else {
        return Ok(()); // 未开库（无活动 vault）：丢弃文档级 job。
    };
    if latest.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (_path, job) in latest {
        match job {
            IndexJob::Upsert { path, content } => upsert_doc(&mut tx, &path, &content, 0).await?,
            IndexJob::Remove { path } => remove_doc(&mut tx, &path).await?,
            _ => {}
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    checkpoint(pool).await;
    Ok(())
}

/// 确保 `<vault>/.inkstream/` 存在 + 写 `.gitignore`('*') + 打开 WAL 库 + 建表（幂等）。
async fn open_db(root: &Path) -> Result<SqlitePool, String> {
    let dir = root.join(DB_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建 .inkstream: {e}"))?;
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        std::fs::write(&gi, GITIGNORE_BODY).map_err(|e| format!("无法写 .gitignore: {e}"))?;
    }
    let opts = SqliteConnectOptions::new()
        .filename(dir.join(DB_FILE))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| format!("无法打开索引库: {e}"))?;
    sqlx::raw_sql(SCHEMA_SQL)
        .execute(&pool)
        .await
        .map_err(|e| format!("建表失败: {e}"))?;
    Ok(pool)
}

/// UPSERT 一篇文档（content_hash 未变则 WHERE 守卫跳过写，免触发器空转）；files 触发器自动同步 files_fts。
async fn upsert_doc(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    path: &str,
    content: &str,
    mtime: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO files (path, content, mtime, size, content_hash, indexed_at) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(path) DO UPDATE SET \
           content = excluded.content, mtime = excluded.mtime, size = excluded.size, \
           content_hash = excluded.content_hash, indexed_at = excluded.indexed_at \
         WHERE files.content_hash <> excluded.content_hash",
    )
    .bind(path)
    .bind(content)
    .bind(mtime)
    .bind(content.len() as i64)
    .bind(hash_i64(content))
    .bind(unix_now())
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    rewrite_links(tx, path, content).await?;
    Ok(())
}

/// 重写本文档的 wiki-link 关系（W2'，反链 W4 数据源）：先删旧 source_path 的链，再插当前正文抽出的链。
/// target 解析到具体文件留 W4 查询时做（target_resolved 暂 NULL，避重建顺序/重命名陈旧问题）。
async fn rewrite_links(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    path: &str,
    content: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM links WHERE source_path = ?")
        .bind(path)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    for r in extract_wiki_links(content) {
        sqlx::query(
            "INSERT INTO links (source_path, target_raw, target_resolved, alias, heading, block_id, kind) \
             VALUES (?, ?, NULL, ?, ?, ?, 'wikilink')",
        )
        .bind(path)
        .bind(&r.target)
        .bind(r.alias.as_deref())
        .bind(r.heading.as_deref())
        .bind(r.block.as_deref())
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 删除一篇文档（files_ad 触发器自动删 FTS 倒排）+ 其出链。
async fn remove_doc(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    path: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM files WHERE path = ?")
        .bind(path)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM links WHERE source_path = ?")
        .bind(path)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 全量重建：清 files/links → 递归扫 .md → 逐文件读盘 upsert（分批提交，批间让出连接）。
async fn rebuild_all(pool: &SqlitePool, root: &Path) -> Result<(), String> {
    sqlx::query("DELETE FROM files")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM links")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    collect_md(root, &mut files);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (n, (rel, abs)) in files.into_iter().enumerate() {
        let Ok(content) = std::fs::read_to_string(&abs) else {
            continue; // 读失败（已删 / 非 UTF-8）跳过，绝不 panic。
        };
        upsert_doc(&mut tx, &rel, &content, mtime_of(&abs)).await?;
        if (n + 1) % REBUILD_BATCH == 0 {
            tx.commit().await.map_err(|e| e.to_string())?;
            tx = pool.begin().await.map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    checkpoint(pool).await;
    Ok(())
}

/// WAL checkpoint（截断 -wal 防无限增长）；失败无害（仅日志开销，下次再截）。
async fn checkpoint(pool: &SqlitePool) {
    let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(pool)
        .await;
}

/// 递归收集 vault 内 .md 文件（rel NFC '/' 路径, abs）；跳过点开头目录/文件（.git/.inkstream，与 watcher 对齐）。
fn collect_md(root: &Path, out: &mut Vec<(String, PathBuf)>) {
    walk(root, root, out);
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        let path = entry.path();
        if ft.is_dir() {
            walk(root, &path, out);
        } else if ft.is_file() && name.ends_with(".md") {
            if let Some(rel) = rel_path(root, &path) {
                out.push((rel, path));
            }
        }
    }
}

fn rel_path(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let joined = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    Some(nfc(&joined))
}

fn hash_i64(s: &str) -> i64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish() as i64
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mtime_of(abs: &Path) -> i64 {
    std::fs::metadata(abs)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 正文里抽出的一条 wiki-link 引用（W2'）。target = 路径部分（NFC），#heading / ^block / |alias 分离。
struct WikiRef {
    target: String,
    heading: Option<String>,
    block: Option<String>,
    alias: Option<String>,
}

/// 扫描正文里的 `[[...]]`（单行；未闭合 / 空 / 跨行不计）。
///
/// `[` `]` `|` `#` `^` `\n` 皆 ASCII（<0x80），UTF-8 多字节续字节 >=0x80 不会撞这些字节，故字节扫描对中文
/// 安全；切片边界恒落在 ASCII 标记处，子串仍是合法 UTF-8。与前端 wikiLink.ts 的 lezer 解析同构（已单测）。
fn extract_wiki_links(content: &str) -> Vec<WikiRef> {
    let b = content.as_bytes();
    let n = b.len();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 1 < n {
        if b[i] == b'[' && b[i + 1] == b'[' {
            let inner_start = i + 2;
            let mut j = inner_start;
            let mut closed = false;
            while j < n {
                if b[j] == b'\n' {
                    break;
                }
                if j + 1 < n && b[j] == b']' && b[j + 1] == b']' {
                    closed = true;
                    break;
                }
                j += 1;
            }
            if closed && j > inner_start {
                if let Some(r) = parse_wiki_ref(&content[inner_start..j]) {
                    out.push(r);
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// 解析 `[[...]]` 内核 `target#heading^block|alias` → WikiRef；target 空则 None（不成链）。
fn parse_wiki_ref(inner: &str) -> Option<WikiRef> {
    let (spec, alias) = match inner.find('|') {
        Some(p) => (&inner[..p], Some(inner[p + 1..].trim().to_string())),
        None => (inner, None),
    };
    let hash = spec.find('#');
    let caret = spec.find('^');
    let target_end = [hash, caret].iter().filter_map(|x| *x).min().unwrap_or(spec.len());
    let target = nfc(spec[..target_end].trim());
    if target.is_empty() {
        return None;
    }
    let heading = hash.map(|h| {
        let end = match caret {
            Some(c) if c > h => c,
            _ => spec.len(),
        };
        spec[h + 1..end].trim().to_string()
    });
    let block = caret.map(|c| spec[c + 1..].trim().to_string());
    Some(WikiRef { target, heading, block, alias })
}

// 注：index DB 行为（FTS5 trigram 中文往返 / case_sensitive 0 / external-content 触发器同步 / 更新去重 /
// 删除清倒排）经「运行应用 + CDP 集成」验证——本机 gnu 工具链下链接 tauri 的 cargo test 二进制无法启动
// （STATUS_ENTRYPOINT_NOT_FOUND，运行时 DLL 入口点不匹配，环境限制非代码问题；app exe 正常运行）。
// 若后续要 Rust 单测，须把纯 DB 逻辑拆为不依赖 tauri 的独立 workspace crate（其测试 exe 不链 tauri）。
