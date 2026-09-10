use super::policy::RemoteTarget;
use super::{GitError, GitProgress, CRED_HELPER};
use std::io::{BufRead, BufReader};
use std::process::{Command, Output, Stdio};
use tauri::ipc::Channel;

fn git_command() -> Command {
    let mut command = Command::new("git");
    // 凭据只来自本次经过主机/模式准入的请求，不能继承上一次环境中的 token。
    command.env_remove("INKSTREAM_GH_TOKEN");
    command.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

pub(super) fn local_output(repo: &str, args: &[&str]) -> Result<Output, GitError> {
    git_command().current_dir(repo).args(args).output()
        .map_err(|e| GitError::Internal(format!("无法执行 git（请确认已安装）: {e}")))
}

pub(super) fn head_oid(repo: &str) -> Option<String> {
    local_output(repo, &["rev-parse", "HEAD"]).ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// `get-url` 展开 insteadOf/pushInsteadOf；push 必须含全部 pushurl，而非只看 fetch URL。
pub(super) fn remote_urls(repo: &str, remote: &str, push: bool) -> Result<Vec<String>, GitError> {
    let mut args = vec!["remote", "get-url"];
    if push { args.extend(["--push", "--all"]); }
    args.extend(["--", remote]);
    let output = local_output(repo, &args)?;
    if !output.status.success() {
        return Err(GitError::Git("无法读取远程仓库地址；请检查当前仓库的 remote 配置。".into()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).lines()
        .map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect())
}

pub(super) fn run_streamed(
    repo: Option<&str>,
    args: &[&str],
    target: &RemoteTarget,
    channel: &Channel<GitProgress>,
) -> Result<(bool, String), GitError> {
    let token = if target.github_auth {
        Some(super::super::auth::github_token().ok_or_else(|| {
            GitError::Git("请先在「账户」设置登录 GitHub，或选择 SSH 远程方式。".into())
        })?)
    } else { None };
    let mut command = git_command();
    if let Some(repo) = repo { command.current_dir(repo); }
    // 防止 URL rewrite 偷换选定协议；HTTPS/SSH 的凭据交互失败明确返回，不等不可见 stdin。
    command.env("GIT_ALLOW_PROTOCOL", target.protocol)
        .env("GIT_TERMINAL_PROMPT", "0").env("GCM_INTERACTIVE", "never");
    if let Some(token) = token.as_deref() {
        command.env("INKSTREAM_GH_TOKEN", token)
            // 清空继承 helper 链：应用 token 不交给其他 helper 的 get/store/erase。
            .args(["-c", "credential.helper=", "-c", CRED_HELPER])
            // 不把已取得凭据复用到重定向后的 origin/端口。移动的仓库需更新明确 URL。
            .args(["-c", "http.followRedirects=false"]);
    }
    let _ = channel.send(GitProgress { line: format!("目标：{}", target.display) });
    let mut child = command.args(args).stdout(Stdio::null()).stderr(Stdio::piped()).spawn()
        .map_err(|e| GitError::Internal(format!("无法执行 git（请确认已安装）: {e}")))?;
    let mut collected = String::new();
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr);
        let mut segment = Vec::new();
        loop {
            match read_segment(&mut reader, &mut segment) {
                Ok(0) => break,
                Ok(_) => {
                    let raw = String::from_utf8_lossy(&segment);
                    let line = if let Some(token) = token.as_deref() {
                        raw.replace(token, "[redacted]")
                    } else { raw.into_owned() };
                    let line = line.trim();
                    if !line.is_empty() {
                        collected.push_str(line);
                        collected.push('\n');
                        let _ = channel.send(GitProgress { line: line.to_string() });
                    }
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            }
        }
    }
    let status = child.wait().map_err(|e| GitError::Internal(format!("git 等待失败: {e}")))?;
    Ok((status.success(), collected))
}

fn read_segment<R: BufRead>(reader: &mut R, buf: &mut Vec<u8>) -> Result<usize, GitError> {
    buf.clear();
    let mut total = 0;
    let mut byte = [0; 1];
    loop {
        let read = std::io::Read::read(reader, &mut byte)
            .map_err(|e| GitError::Internal(format!("读 git 输出失败: {e}")))?;
        if read == 0 { return Ok(total); }
        total += 1;
        if byte[0] == b'\r' || byte[0] == b'\n' { return Ok(total); }
        buf.push(byte[0]);
    }
}

pub(super) fn last_line(stderr: &str) -> &str {
    stderr.lines().filter(|line| !line.trim().is_empty()).last().unwrap_or("远程操作失败").trim()
}
