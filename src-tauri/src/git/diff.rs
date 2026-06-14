//! git diff：三态（工作区/暂存区/两 commit 间）+ hunk 结构化（不传整文件 patch 文本）。

use super::types::{DiffHunk, DiffLine, DiffTarget, FileDiff};
use super::GitError;
use git2::{Delta, Diff, DiffOptions, Patch, Repository};

/// 按目标构建结构化 diff（纯函数，临时 repo 单测）。
pub fn build_diff(repo: &Repository, target: DiffTarget) -> Result<Vec<FileDiff>, GitError> {
    let mut opts = DiffOptions::new();
    opts.context_lines(3)
        .include_untracked(true)
        .recurse_untracked_dirs(true);
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let diff = match target {
        DiffTarget::Workdir => {
            repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))?
        }
        DiffTarget::Staged => repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?,
        DiffTarget::Commit { oid } => {
            // 单 commit 的改动 = 该 commit tree vs 首父 tree（root commit 无父 → vs 空树）。
            let commit = repo.revparse_single(&oid)?.peel_to_commit()?;
            let new_tree = commit.tree()?;
            let old_tree = match commit.parent(0) {
                Ok(p) => Some(p.tree()?),
                Err(_) => None,
            };
            repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))?
        }
        DiffTarget::Commits { from, to } => {
            let ot = repo.revparse_single(&from)?.peel_to_commit()?.tree()?;
            let nt = repo.revparse_single(&to)?.peel_to_commit()?.tree()?;
            repo.diff_tree_to_tree(Some(&ot), Some(&nt), Some(&mut opts))?
        }
    };
    collect_file_diffs(&diff)
}

/// Diff → Vec<FileDiff>：逐 delta 经 Patch::from_diff 取 hunk/line。
/// 用 Patch 而非 Diff::foreach——避开「四个 &mut 闭包同时借用累加器」的借用检查难题。
fn collect_file_diffs(diff: &Diff) -> Result<Vec<FileDiff>, GitError> {
    let mut out = Vec::new();
    for idx in 0..diff.deltas().len() {
        let delta = diff
            .get_delta(idx)
            .ok_or_else(|| GitError::Internal("diff delta 越界".into()))?;
        let status = classify_delta(delta.status());
        let patch = Patch::from_diff(diff, idx)?;
        // patch 为 None：二进制或纯模式/重命名无内容变更。renamed 不当二进制处理。
        let binary = patch.is_none() && status != "renamed";
        let mut hunks = Vec::new();
        if let Some(patch) = patch {
            for h in 0..patch.num_hunks() {
                let (hunk, _) = patch.hunk(h)?;
                let mut lines = Vec::new();
                for l in 0..patch.num_lines_in_hunk(h)? {
                    let line = patch.line_in_hunk(h, l)?;
                    lines.push(DiffLine {
                        origin: line.origin(),
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                        content: String::from_utf8_lossy(line.content()).into_owned(),
                    });
                }
                hunks.push(DiffHunk {
                    header: String::from_utf8_lossy(hunk.header()).into_owned(),
                    lines,
                });
            }
        }
        out.push(FileDiff {
            old_path: path_of(delta.old_file().path()),
            new_path: path_of(delta.new_file().path()),
            status,
            binary,
            hunks,
        });
    }
    Ok(out)
}

fn path_of(p: Option<&std::path::Path>) -> Option<String> {
    p.map(|p| p.to_string_lossy().replace('\\', "/"))
}

fn classify_delta(d: Delta) -> String {
    match d {
        Delta::Added | Delta::Untracked => "added",
        Delta::Deleted => "deleted",
        Delta::Renamed => "renamed",
        Delta::Copied => "copied",
        Delta::Typechange => "typechange",
        _ => "modified",
    }
    .to_string()
}

#[tauri::command]
pub async fn git_diff(repo_root: String, target: DiffTarget) -> Result<Vec<FileDiff>, String> {
    super::blocking(move || build_diff(&super::open_repo(&repo_root)?, target)).await
}
