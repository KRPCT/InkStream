//! Immutable, metadata-only comparison. Bodies use the bounded Raw file channel.
use super::GitError;
use git2::{Delta, DiffFindOptions, DiffOptions, ObjectType, Oid, Repository};
use serde::Serialize;
use std::path::{Component, Path};

const MAX_PAGE: usize = 100;
const MAX_FILES: usize = 50_000;
pub(crate) const MAX_BLOB_BYTES: usize = 100 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareSide {
    pub commit_oid: String,
    pub blob_oid: String,
    pub path: String,
    pub byte_length: usize,
    pub readable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFile {
    pub status: String,
    pub old: Option<CompareSide>,
    pub new: Option<CompareSide>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparePage {
    pub from_oid: String,
    pub to_oid: String,
    pub total: usize,
    pub next: Option<usize>,
    pub files: Vec<CompareFile>,
}

fn exact_oid(value: &str) -> Result<Oid, GitError> {
    if value.len() != 40 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(GitError::Git("比较需要固定的完整提交 OID，请重新选择分支。".into()));
    }
    Ok(Oid::from_str(value)?)
}

fn side(repo: &Repository, commit_oid: Oid, file: git2::DiffFile<'_>) -> Result<Option<CompareSide>, GitError> {
    if file.id().is_zero() { return Ok(None); }
    let path = file.path().and_then(Path::to_str)
        .ok_or_else(|| GitError::Git("文件路径不是有效 UTF-8，无法比较。".into()))?;
    // A gitlink references another repository's commit and may not exist in this ODB.
    let (byte_length, readable) = if file.mode() == git2::FileMode::Commit {
        (0, false)
    } else {
        let (length, kind) = repo.odb()?.read_header(file.id())?;
        (length, kind == ObjectType::Blob && length <= MAX_BLOB_BYTES)
    };
    Ok(Some(CompareSide { commit_oid: commit_oid.to_string(), blob_oid: file.id().to_string(),
        path: path.to_owned(), byte_length, readable }))
}

pub fn compare_files(repo: &Repository, from: &str, to: &str, skip: usize, limit: usize, focus_path: Option<&str>) -> Result<ComparePage, GitError> {
    if limit == 0 || limit > MAX_PAGE {
        return Err(GitError::Git("比较文件每页须为 1–100 项。".into()));
    }
    let from = exact_oid(from)?;
    let to = exact_oid(to)?;
    let old = repo.find_commit(from)?.tree()?;
    let new = repo.find_commit(to)?.tree()?;
    let mut options = DiffOptions::new();
    options.skip_binary_check(true).context_lines(0).max_size(1024 * 1024);
    let mut diff = repo.diff_tree_to_tree(Some(&old), Some(&new), Some(&mut options))?;
    if diff.deltas().len() > MAX_FILES {
        return Err(GitError::Git("变更超过 50000 个文件，请在外部 Git 工具比较。未截断结果。".into()));
    }
    // Exact renames need no content reads; edited renames remain honest add/delete pairs.
    diff.find_similar(Some(DiffFindOptions::new().renames(true).exact_match_only(true)))?;
    if let Some(path) = focus_path {
        let matching = diff.deltas().find(|delta| delta.old_file().path() == Some(Path::new(path)) || delta.new_file().path() == Some(Path::new(path)));
        let file = if let Some(delta) = matching {
            Some(CompareFile { status: match delta.status() { Delta::Added => "added", Delta::Deleted => "deleted", Delta::Renamed => "renamed", Delta::Typechange => "typechange", _ => "modified" }.into(),
                old: side(repo, from, delta.old_file())?, new: side(repo, to, delta.new_file())? })
        } else {
            let entry_side = |tree: &git2::Tree<'_>, commit: Oid| -> Result<Option<CompareSide>, GitError> {
                let entry = match tree.get_path(Path::new(path)) { Ok(entry) => entry, Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None), Err(error) => return Err(error.into()) };
                let (byte_length, readable) = if entry.kind() == Some(ObjectType::Blob) { let (length, _) = repo.odb()?.read_header(entry.id())?; (length, length <= MAX_BLOB_BYTES) } else { (0, false) };
                Ok(Some(CompareSide { commit_oid: commit.to_string(), blob_oid: entry.id().to_string(), path: path.into(), byte_length, readable }))
            };
            let old_side = entry_side(&old, from)?;
            let new_side = entry_side(&new, to)?;
            if old_side.is_none() && new_side.is_none() { None } else { Some(CompareFile { status: "unchanged".into(), old: old_side, new: new_side }) }
        };
        return Ok(ComparePage { from_oid: from.to_string(), to_oid: to.to_string(), total: usize::from(file.is_some()), next: None, files: file.into_iter().collect() });
    }
    let total = diff.deltas().len();
    let mut files = Vec::new();
    for delta in diff.deltas().skip(skip).take(limit) {
        let status = match delta.status() {
            Delta::Added => "added", Delta::Deleted => "deleted", Delta::Renamed => "renamed",
            Delta::Typechange => "typechange", _ => "modified",
        };
        files.push(CompareFile { status: status.into(), old: side(repo, from, delta.old_file())?, new: side(repo, to, delta.new_file())? });
    }
    let consumed = skip.saturating_add(files.len());
    Ok(ComparePage { from_oid: from.to_string(), to_oid: to.to_string(), total,
        next: (consumed < total).then_some(consumed), files })
}

pub(crate) fn read_blob(repo_root: &str, commit_oid: &str, path: &str, expected_blob_oid: &str) -> Result<Vec<u8>, String> {
    let repo = super::open_repo(repo_root).map_err(String::from)?;
    let read = || -> Result<Vec<u8>, GitError> {
        let path_ref = Path::new(path);
        if path.is_empty() || path.contains('\\') || path_ref.components().any(|part| !matches!(part, Component::Normal(_))) {
            return Err(GitError::Git("比较文件路径必须位于提交树内。".into()));
        }
        let commit = repo.find_commit(exact_oid(commit_oid)?)?;
        let tree = commit.tree()?;
        let entry = tree.get_path(path_ref)?;
        if entry.kind() != Some(ObjectType::Blob) || entry.id() != exact_oid(expected_blob_oid)? {
            return Err(GitError::Git("比较文件与固定提交不一致，请重新选择。".into()));
        }
        // Check ODB header before asking libgit2 to materialize the blob.
        let (length, kind) = repo.odb()?.read_header(entry.id())?;
        if kind != ObjectType::Blob || length > MAX_BLOB_BYTES {
            return Err(GitError::Git("此文件无法按文本读取，或超过 100MiB 完整读取上限。".into()));
        }
        let blob = repo.find_blob(entry.id())?;
        if blob.is_binary() || std::str::from_utf8(blob.content()).is_err() {
            return Err(GitError::Git("此文件是二进制或不是 UTF-8 文本，无法显示正文比较。".into()));
        }
        Ok(blob.content().to_vec())
    };
    read().map_err(String::from)
}

#[tauri::command]
pub async fn git_compare_files(repo_root: String, from_oid: String, to_oid: String, skip: usize, limit: usize, focus_path: Option<String>) -> Result<ComparePage, String> {
    super::blocking(move || compare_files(&super::open_repo(&repo_root)?, &from_oid, &to_oid, skip, limit, focus_path.as_deref())).await
}

#[cfg(test)]
#[path = "compare_tests.rs"]
mod tests;
