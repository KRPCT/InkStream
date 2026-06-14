//! git log：revwalk 拓扑 + 时间序，分页（skip + limit）。

use super::types::CommitInfo;
use super::GitError;
use git2::{Repository, Sort};

/// 分页遍历提交历史（纯函数，临时 repo 单测）。
pub fn walk_log(repo: &Repository, skip: usize, limit: usize) -> Result<Vec<CommitInfo>, GitError> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    // unborn（无提交）→ 空列表，不报错（首次提交前打开仓库的常态）。
    if let Err(e) = walk.push_head() {
        if e.code() == git2::ErrorCode::UnbornBranch {
            return Ok(Vec::new());
        }
        return Err(e.into());
    }
    let mut out = Vec::new();
    // revwalk 惰性迭代：达到 limit 即 break，大仓库不全量遍历。
    for (i, oid) in walk.enumerate() {
        if i < skip {
            continue;
        }
        if out.len() >= limit {
            break;
        }
        let c = repo.find_commit(oid?)?;
        let (summary, body) = split_msg(c.message().unwrap_or(""));
        let a = c.author();
        out.push(CommitInfo {
            oid: c.id().to_string(),
            parents: c.parent_ids().map(|p| p.to_string()).collect(),
            summary,
            body,
            author_name: a.name().unwrap_or("").to_string(),
            author_email: a.email().unwrap_or("").to_string(),
            author_time: c.time().seconds(),
            refs: Vec::new(),
        });
    }
    Ok(out)
}

/// commit message → (首行 summary, 余下 body)。
fn split_msg(msg: &str) -> (String, String) {
    let mut parts = msg.splitn(2, '\n');
    let summary = parts.next().unwrap_or("").trim().to_string();
    let body = parts.next().unwrap_or("").trim().to_string();
    (summary, body)
}

#[tauri::command]
pub async fn git_log(
    repo_root: String,
    skip: usize,
    limit: usize,
) -> Result<Vec<CommitInfo>, String> {
    super::blocking(move || walk_log(&super::open_repo(&repo_root)?, skip, limit)).await
}
