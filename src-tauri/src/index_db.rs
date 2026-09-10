use super::links::extract_wiki_links;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(super) fn relative_path(path: &str) -> Result<String, String> {
    let slash = path.replace('\\', "/");
    let parsed = Path::new(&slash);
    if parsed.is_absolute() || parsed.components().any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("索引路径必须位于所属工作区内".into());
    }
    let path = parsed.components().filter_map(|c| match c {
        Component::Normal(p) => Some(p.to_string_lossy()), _ => None,
    }).collect::<Vec<_>>().join("/");
    if path.is_empty() { return Err("索引路径不能为空".into()); }
    // SQL 主键与返回路径必须保留真实文件身份；Unicode 归一化仅用于链接匹配键。
    Ok(path)
}

pub(super) async fn open(root: &Path) -> Result<SqlitePool, String> {
    let dir = root.join(".inkstream");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建 .inkstream: {e}"))?;
    let gi = dir.join(".gitignore");
    if !gi.exists() { std::fs::write(&gi, "*\n").map_err(|e| format!("无法写 .gitignore: {e}"))?; }
    let options = SqliteConnectOptions::new().filename(dir.join("index.db"))
        .create_if_missing(true).journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal).busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await
        .map_err(|e| format!("无法打开索引库: {e}"))?;
    if let Err(e) = sqlx::raw_sql(include_str!("index_schema.sql")).execute(&pool).await {
        pool.close().await;
        return Err(format!("索引建表失败: {e}"));
    }
    Ok(pool)
}

pub(super) async fn upsert(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, path: &str, content: &str,
) -> Result<(), String> {
    let mut hash = DefaultHasher::new();
    content.hash(&mut hash);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    sqlx::query("INSERT INTO files (path,content,mtime,size,content_hash,indexed_at) VALUES (?,?,0,?,?,?) \
        ON CONFLICT(path) DO UPDATE SET content=excluded.content,size=excluded.size,content_hash=excluded.content_hash,indexed_at=excluded.indexed_at \
        WHERE files.content_hash<>excluded.content_hash")
        .bind(path).bind(content).bind(content.len() as i64).bind(hash.finish() as i64).bind(now)
        .execute(&mut **tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM links WHERE source_path=?").bind(path).execute(&mut **tx).await.map_err(|e| e.to_string())?;
    for link in extract_wiki_links(content) {
        sqlx::query("INSERT INTO links (source_path,target_raw,target_resolved,alias,heading,block_id,kind) VALUES (?,?,NULL,?,?,?,'wikilink')")
            .bind(path).bind(link.target).bind(link.alias).bind(link.heading).bind(link.block)
            .execute(&mut **tx).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) async fn remove(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, path: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM files WHERE path=?").bind(path).execute(&mut **tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM links WHERE source_path=?").bind(path).execute(&mut **tx).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn collect(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| format!("索引无法读取目录: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') { continue; }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let path = entry.path();
            if kind.is_dir() { walk(root, &path, out)?; }
            else if kind.is_file() && name.ends_with(".md") {
                let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
                out.push((relative_path(&rel.to_string_lossy())?, path));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    Ok(files)
}
