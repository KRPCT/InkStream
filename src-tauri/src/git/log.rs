//! git log：revwalk 拓扑 + 时间序，分页（skip + limit）。

use super::types::CommitInfo;
use super::GitError;
use git2::{Repository, Sort};

/// 分页遍历提交历史（纯函数，临时 repo 单测）。
/// `refs` 空 = 显示所有分支（本地 + 远程）全 DAG；非空 = 仅这些 ref/分支名的可达提交（W5 Filter Branches）。
pub fn walk_log(
    repo: &Repository,
    refs: &[String],
    skip: usize,
    limit: usize,
) -> Result<Vec<CommitInfo>, GitError> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    if refs.is_empty() {
        // 显示**所有分支**的全 DAG（本地 + 远程），不随当前 HEAD 变——对照 vscode-git-graph：
        // 切到 master 也能看到 test 等其它分支领先的提交（push_head 那套只看当前分支祖先）。
        // push_glob 对空仓库/无匹配返回 Ok 不报错；unborn 时三推皆无效 → 后续遍历自然空。
        let _ = walk.push_glob("refs/heads/*");
        let _ = walk.push_glob("refs/remotes/*");
        let _ = walk.push_head(); // 兜底：detached HEAD（unborn 报错忽略）
    } else {
        // Filter Branches：仅选中分支。名字经 revparse 解析（'main' / 'origin/main' / tag / oid 皆可），
        // peel 到 commit 后 push。无法解析的名字静默跳过（不报错，过滤体验稳）。
        for name in refs {
            if let Ok(commit) = repo.revparse_single(name).and_then(|o| o.peel_to_commit()) {
                let _ = walk.push(commit.id());
            }
        }
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
    refs: Vec<String>,
    skip: usize,
    limit: usize,
) -> Result<Vec<CommitInfo>, String> {
    super::blocking(move || walk_log(&super::open_repo(&repo_root)?, &refs, skip, limit)).await
}
