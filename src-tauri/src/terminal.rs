use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Manager;

/// 内置终端会话注册表（v1.2 #3）。全 App 单例，`init` 在 Builder.setup 经 `manage` 注册。
///
/// 每个会话保留三件套：`master`（resize）、`writer`（向 PTY 写键入）、`child`（关闭时杀子进程）。
/// 高吞吐输出**不**走 emit/listen，而走 `terminal_open` 传入的 `Channel<InvokeResponseBody>`：读线程
/// 把原始字节以 `Raw`（前端收 ArrayBuffer）回传，进程退出以 `Json`（前端收 `{type:"exit"}`）通知。
/// 单条 Channel 有序，二变体由前端按 `instanceof ArrayBuffer` 区分。
#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: AtomicU32,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    /// 写端独立锁：键入写是阻塞 I/O（子进程不读 stdin 时 ConPTY 输入缓冲满即阻塞）。绝不在持有
    /// sessions 全局锁时写——否则一个卡住的写会冻结整个终端子系统（含本可解卡的 terminal_close）。
    /// 故写端单独 Arc<Mutex>，terminal_write 在全局锁内仅克隆出句柄、随即释放全局锁再写。
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
}

/// 在 Builder.setup 注册终端单例状态。
pub fn init(app: &tauri::App) {
    app.manage(TerminalManager::default());
}

/// 开一个终端会话：在 `cwd`（缺省/非目录则继承当前目录）起系统默认 shell，返回会话 id。
///
/// 释放 slave 句柄是 EOF 正确性关键——否则子进程退出后 master 的读端永不返回 EOF、读线程挂死。
/// 读线程把输出经 `channel` 回传；会话退出由读线程发 exit 控制并自清理。
#[tauri::command]
pub fn terminal_open(
    app: tauri::AppHandle,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    channel: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("无法创建 PTY: {e}"))?;

    let mut cmd = CommandBuilder::new_default_prog();
    cmd.env("TERM", "xterm-256color");
    if let Some(dir) = cwd.as_deref() {
        if std::path::Path::new(dir).is_dir() {
            cmd.cwd(dir);
        }
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("无法启动终端: {e}"))?;
    // 必须释放 slave：保留它会让 master 读端在子进程退出后仍不 EOF（slave fd 持有 PTY 打开），读线程挂死。
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("无法读取终端输出: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("无法写入终端: {e}"))?;

    let manager = app.state::<TerminalManager>();
    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    manager
        .sessions
        .lock()
        .map_err(|_| "终端锁中毒".to_string())?
        .insert(
            id,
            Session {
                master: pair.master,
                writer: Arc::new(Mutex::new(writer)),
                child,
            },
        );

    // 读线程：阻塞 read → Channel Raw 回传原始字节；EOF/读错发 exit 控制并移除会话。
    let chan = channel.clone();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // 子进程退出，PTY 读端 EOF。
                Ok(n) => {
                    if chan
                        .send(InvokeResponseBody::Raw(buf[..n].to_vec()))
                        .is_err()
                    {
                        break; // 前端 Channel 已失效（面板卸载），停读。
                    }
                }
                Err(_) => break, // 读错（PTY 关闭等）：退出循环。
            }
        }
        let _ = chan.send(InvokeResponseBody::Json(json!({ "type": "exit" }).to_string()));
        if let Some(mgr) = app_handle.try_state::<TerminalManager>() {
            if let Ok(mut sessions) = mgr.sessions.lock() {
                sessions.remove(&id); // 退出即清理（移除即 drop master/writer/child）。
            }
        }
    });

    Ok(id)
}

/// 向某会话写入键入（xterm onData 文本，UTF-8 字节）。会话不存在则静默忽略（已退出）。
///
/// 全局 sessions 锁仅用于克隆出该会话的写端句柄，**随即释放**；阻塞的 write_all 在写端独立锁内进行，
/// 不冻结其它会话与 close/resize（堵「一个卡住的写 wedge 整个终端」）。
#[tauri::command]
pub fn terminal_write(app: tauri::AppHandle, id: u32, data: String) -> Result<(), String> {
    let manager = app.state::<TerminalManager>();
    let writer = {
        let sessions = manager.sessions.lock().map_err(|_| "终端锁中毒".to_string())?;
        match sessions.get(&id) {
            Some(session) => session.writer.clone(),
            None => return Ok(()), // 会话已退出：静默忽略。
        }
    }; // 全局锁在此释放，下面的阻塞写不再持有它。
    let mut writer = writer.lock().map_err(|_| "终端写锁中毒".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("写入终端失败: {e}"))?;
    let _ = writer.flush();
    Ok(())
}

/// 调整某会话的列/行（xterm fit 后回传）。会话不存在则忽略。
#[tauri::command]
pub fn terminal_resize(app: tauri::AppHandle, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let manager = app.state::<TerminalManager>();
    let sessions = manager.sessions.lock().map_err(|_| "终端锁中毒".to_string())?;
    if let Some(session) = sessions.get(&id) {
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("调整终端尺寸失败: {e}"))?;
    }
    Ok(())
}

/// 关闭某会话：移除并杀子进程。幂等。
///
/// kill 是 EOF 的可靠触发：子进程死 → slave 全部关闭 → master 读端 EOF → 读线程退出（unix 上仅 drop
/// master 不杀子进程、读线程可能挂死，故显式 kill）。drop session 顺带关 master/writer。
#[tauri::command]
pub fn terminal_close(app: tauri::AppHandle, id: u32) -> Result<(), String> {
    let manager = app.state::<TerminalManager>();
    let session = manager
        .sessions
        .lock()
        .map_err(|_| "终端锁中毒".to_string())?
        .remove(&id);
    if let Some(mut session) = session {
        let _ = session.child.kill(); // best-effort：杀子进程触发读线程 EOF 退出。
    }
    Ok(())
}
