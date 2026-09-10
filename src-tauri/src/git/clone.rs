//! 克隆只操作独占 staging；完整且已退出的 Git 结果才能发布到一个仍不存在的目标目录。
use super::rebase_process::{run_process_with_progress, ProcessOutput, ProcessSpec, StopReason};
use super::remote::{policy::RemoteTarget, GitProgress, RemoteOptions, CRED_HELPER};
use serde::Serialize;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;

#[path = "clone_destination.rs"]
mod destination;
#[path = "clone_state.rs"]
mod state;
#[cfg(test)]
#[path = "clone_tests.rs"]
mod tests;

use destination::{display_path, Destination};
use state::Control;

const TIMEOUT: Duration = Duration::from_secs(600);
const MAX_URL_BYTES: usize = 8192;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FailureCode {
    Cancelled,
    Failed,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneFailure {
    pub code: FailureCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub residual_path: Option<String>,
}
impl CloneFailure {
    fn failed(message: impl Into<String>) -> Self {
        Self {
            code: FailureCode::Failed,
            message: message.into(),
            residual_path: None,
        }
    }
    fn cancelled() -> Self {
        Self {
            code: FailureCode::Cancelled,
            message: "克隆已取消，目标目录未创建。".into(),
            residual_path: None,
        }
    }
}

struct Runtime {
    git: PathBuf,
    environment: Vec<(OsString, OsString)>,
    timeout: Duration,
}
struct RequestData {
    url: String,
    destination: String,
    request_id: String,
    options: RemoteOptions,
}

fn redacted(message: &str, token: Option<&str>) -> String {
    match token.filter(|token| !token.is_empty()) {
        Some(token) => message.replace(token, "[redacted]"),
        None => message.into(),
    }
}

fn fail(destination: &mut Destination, mut failure: CloneFailure) -> CloneFailure {
    if let Err(error) = destination.cleanup() {
        failure.code = FailureCode::Failed;
        failure.message = format!("{}\n{}", failure.message, error);
        failure.residual_path = Some(display_path(&destination.stage));
    }
    failure
}

fn remaining(control: &Control, timeout: Duration) -> Result<Duration, CloneFailure> {
    if control.cancelled.load(Ordering::Acquire) {
        return Err(CloneFailure::cancelled());
    }
    timeout
        .checked_sub(control.started.elapsed())
        .filter(|value| !value.is_zero())
        .ok_or_else(|| CloneFailure::failed("克隆超过执行期限，目标目录未创建。"))
}

fn spec(
    runtime: &Runtime,
    destination: &Destination,
    protocol: &str,
    token: Option<&str>,
    arguments: Vec<OsString>,
) -> ProcessSpec {
    let mut environment: Vec<_> = runtime
        .environment
        .iter()
        .filter(|(name, _)| name != "INKSTREAM_GH_TOKEN" && name != "INKSTREAM_GITHUB_TOKEN")
        .cloned()
        .collect();
    environment.extend([
        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
        ("GCM_INTERACTIVE".into(), "never".into()),
        ("SSH_ASKPASS_REQUIRE".into(), "never".into()),
        ("GIT_ALLOW_PROTOCOL".into(), protocol.into()),
        // 解析 URL 与 clone 共享一个无仓库的 cwd，不读取所选父目录中其他项目的 local config。
        (
            "GIT_CEILING_DIRECTORIES".into(),
            display_path(destination.stage.parent().unwrap()).into(),
        ),
    ]);
    let mut args = Vec::new();
    if let Some(token) = token {
        environment.push(("INKSTREAM_GH_TOKEN".into(), token.into()));
        args.extend(
            [
                "-c",
                "credential.helper=",
                "-c",
                CRED_HELPER,
                "-c",
                "http.followRedirects=false",
            ]
            .map(OsString::from),
        );
    }
    args.extend(arguments);
    ProcessSpec {
        program: runtime.git.clone(),
        cwd: destination.stage.clone(),
        args,
        env_remove: [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_COMMON_DIR",
            "GIT_INDEX_FILE",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
            "INKSTREAM_GH_TOKEN",
            "INKSTREAM_GITHUB_TOKEN",
        ]
        .map(OsString::from)
        .to_vec(),
        env_set: environment,
    }
}

fn run(
    runtime: &Runtime,
    destination: &mut Destination,
    control: &Control,
    process: &ProcessSpec,
    token: Option<&str>,
    progress: &mut dyn FnMut(&str),
) -> Result<ProcessOutput, CloneFailure> {
    let time = remaining(control, runtime.timeout).map_err(|error| fail(destination, error))?;
    destination.before_process();
    let result = run_process_with_progress(process, &control.cancelled, time, &mut |line| {
        progress(&redacted(line, token))
    });
    let output = match result {
        Ok(output) => output,
        // Err 也可能发生于已启动后的管道读取；runner 未返回结构化清理证明时不能删除 cwd。
        Err(error) => {
            return Err(fail(
                destination,
                CloneFailure::failed(redacted(&error, token)),
            ))
        }
    };
    if let Some(error) = &output.cleanup_error {
        return Err(fail(
            destination,
            CloneFailure::failed(format!(
                "无法确认克隆进程已退出: {}",
                redacted(error, token)
            )),
        ));
    }
    destination.processes_stopped();
    if output.interruption == Some(StopReason::Cancelled) {
        return Err(fail(destination, CloneFailure::cancelled()));
    }
    if output.interruption == Some(StopReason::TimedOut) {
        return Err(fail(
            destination,
            CloneFailure::failed("克隆超过执行期限，进程已停止。"),
        ));
    }
    if output.exit_code != Some(0) {
        let message = if output.stderr.trim().is_empty() {
            "Git 未完成克隆，请检查仓库地址与登录方式。"
        } else {
            output.stderr.trim()
        };
        return Err(fail(
            destination,
            CloneFailure::failed(redacted(message, token)),
        ));
    }
    remaining(control, runtime.timeout).map_err(|error| fail(destination, error))?;
    Ok(output)
}

fn resolve_target(
    runtime: &Runtime,
    destination: &mut Destination,
    control: &Control,
    options: &RemoteOptions,
    url: &str,
    progress: &mut dyn FnMut(&str),
) -> Result<RemoteTarget, CloneFailure> {
    let initial = options.for_clone(url).map_err(CloneFailure::failed)?;
    let query = spec(
        runtime,
        destination,
        initial.protocol,
        None,
        ["ls-remote", "--get-url", "--", url]
            .map(OsString::from)
            .to_vec(),
    );
    let output = run(runtime, destination, control, &query, None, progress)?;
    let resolved = output.stdout.trim();
    if resolved.is_empty() || resolved.len() > MAX_URL_BYTES || resolved.lines().count() != 1 {
        return Err(fail(
            destination,
            CloneFailure::failed("Git 未返回唯一、完整的仓库地址。"),
        ));
    }
    let mut target = options
        .for_url(resolved)
        .map_err(|error| fail(destination, CloneFailure::failed(error)))?;
    // Git get-url 已执行一次 insteadOf；实际 clone 保留原参数，使同一规则恰好再执行一次。
    target.argument = url.into();
    Ok(target)
}

fn execute(
    request: RequestData,
    runtime: Runtime,
    control: Arc<Control>,
    mut token: impl FnMut() -> Result<Option<String>, String>,
    progress: &mut dyn FnMut(&str),
) -> Result<String, CloneFailure> {
    remaining(&control, runtime.timeout)?;
    let url = request.url.trim();
    if url.len() > MAX_URL_BYTES {
        return Err(CloneFailure::failed("仓库地址超过长度上限。"));
    }
    request
        .options
        .for_clone(url)
        .map_err(CloneFailure::failed)?;
    let mut destination = Destination::create(&request.destination, &request.request_id)
        .map_err(CloneFailure::failed)?;
    let target = resolve_target(
        &runtime,
        &mut destination,
        &control,
        &request.options,
        url,
        progress,
    )?;
    progress(&format!("目标：{}", target.display));
    remaining(&control, runtime.timeout).map_err(|error| fail(&mut destination, error))?;
    let credential = if target.github_auth {
        progress("正在确认 GitHub 登录…");
        match token() {
            Ok(Some(token)) if !token.trim().is_empty() => Some(token),
            Ok(_) => {
                return Err(fail(
                    &mut destination,
                    CloneFailure::failed("请先在账户设置登录 GitHub，或选择 SSH 远程方式。"),
                ))
            }
            Err(error) => return Err(fail(&mut destination, CloneFailure::failed(error))),
        }
    } else {
        None
    };
    remaining(&control, runtime.timeout).map_err(|error| fail(&mut destination, error))?;
    let process = spec(
        &runtime,
        &destination,
        target.protocol,
        credential.as_deref(),
        ["clone", "--progress", "--", &target.argument, "."]
            .map(OsString::from)
            .to_vec(),
    );
    run(
        &runtime,
        &mut destination,
        &control,
        &process,
        credential.as_deref(),
        progress,
    )?;
    destination
        .validate_repository()
        .map_err(|error| fail(&mut destination, CloneFailure::failed(error)))?;
    match control.publish(runtime.timeout, || destination.publish()) {
        Ok(path) => Ok(path),
        Err(error) => {
            let failure = if control.cancelled.load(Ordering::Acquire) {
                CloneFailure::cancelled()
            } else {
                CloneFailure::failed(error)
            };
            Err(fail(&mut destination, failure))
        }
    }
}

#[tauri::command]
pub async fn git_clone_owned(
    window: tauri::WebviewWindow,
    url: String,
    dest: String,
    request_id: String,
    options: RemoteOptions,
    channel: Channel<GitProgress>,
) -> Result<String, CloneFailure> {
    let lease = state::acquire(window.label(), request_id.clone()).map_err(CloneFailure::failed)?;
    let control = lease.control.clone();
    let git =
        super::rebase::git_executable().map_err(|error| CloneFailure::failed(error.to_string()))?;
    let request = RequestData {
        url,
        destination: dest,
        request_id,
        options,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        execute(
            request,
            Runtime {
                git,
                environment: vec![],
                timeout: TIMEOUT,
            },
            control.clone(),
            || tauri::async_runtime::block_on(super::auth::github_token()),
            &mut |line| {
                if channel.send(GitProgress { line: line.into() }).is_err() {
                    control.cancelled.store(true, Ordering::Release);
                }
            },
        )
    })
    .await
    .map_err(|_| CloneFailure::failed("克隆任务异常中止；请检查目标父目录中的克隆临时目录。"))?
}

#[tauri::command]
pub fn git_cancel_clone(window: tauri::WebviewWindow, request_id: String) -> bool {
    state::cancel(window.label(), &request_id)
}
pub(crate) fn close_owner(owner: &str) {
    state::close_owner(owner);
}
