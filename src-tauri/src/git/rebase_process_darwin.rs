//! Verify Darwin's zombie-only process-group EPERM without hiding permission failures.
use std::mem::{size_of, zeroed};
use std::time::{Duration, Instant};

fn process_info(pid: i32) -> Result<Option<libc::proc_bsdinfo>, String> {
    let mut info: libc::proc_bsdinfo = unsafe { zeroed() };
    let size = size_of::<libc::proc_bsdinfo>() as i32;
    // arg=1 includes zombies; this query never reaps a process.
    let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 1, (&mut info as *mut libc::proc_bsdinfo).cast(), size) };
    if read == size { return Ok(Some(info)); }
    let error = std::io::Error::last_os_error();
    if read == 0 && error.raw_os_error() == Some(libc::ESRCH) { return Ok(None); }
    Err(format!("无法查询自有 Git 进程 {pid} 的退出状态（读取 {read}/{size} 字节）：{error}"))
}

/// Observe the retained child through libproc, independent of waitid's MAC wait checks.
/// The Child handle is owned by this runner and is not reaped until group cleanup ends.
pub(super) fn leader_exited(leader: u32) -> Result<bool, String> {
    let Some(info) = process_info(leader as i32)? else {
        // Live-to-zombie lookup can race teardown. No missing snapshot proves exit.
        return Ok(false);
    };
    if info.pbi_pid != leader || info.pbi_ppid != std::process::id() || info.pbi_pgid != leader {
        return Err("自有 Git 根进程身份发生变化，拒绝回收其它进程组".into());
    }
    Ok(info.pbi_status == libc::SZOMB)
}

/// The caller retains its exited, unreaped group leader, so this group ID cannot be reused.
pub(super) fn group_has_no_live_members(leader: u32, cleanup_deadline: Instant) -> Result<bool, String> {
    let deadline = cleanup_deadline.min(Instant::now() + Duration::from_millis(250));
    if Instant::now() >= deadline { return Err("自有 Git 进程组核对超过回收期限".into()); }
    let mut pids = [0_i32; 4096];
    // libproc returns a PID count here, whereas proc_listpids returns a byte count.
    let count = unsafe {
        libc::proc_listpgrppids(leader as i32, pids.as_mut_ptr().cast(), size_of::<[i32; 4096]>() as i32)
    };
    // A full buffer may be truncated. An empty result cannot prove anything because
    // libproc also represents errors as zero, and our unreaped leader must be present.
    if count <= 0 || count as usize >= pids.len() {
        return Err("无法完整核对自有 Git 进程组成员".into());
    }
    let pids = &pids[..count as usize];
    if !pids.contains(&(leader as i32)) {
        return Err("自有 Git 进程组缺少尚未回收的根进程".into());
    }
    for &pid in pids {
        if Instant::now() >= deadline {
            return Err("核对自有 Git 进程组成员超时".into());
        }
        let Some(info) = process_info(pid)? else {
            if pid != leader as i32 { continue; }
            return Err("无法确认自有 Git 进程组成员的退出状态".into());
        };
        if info.pbi_pid != pid as u32 || (pid == leader as i32 && info.pbi_pgid != leader) {
            return Err("自有 Git 进程组成员身份发生变化".into());
        }
        if info.pbi_pgid == leader && info.pbi_status != libc::SZOMB {
            return Ok(false);
        }
    }
    Ok(true)
}
