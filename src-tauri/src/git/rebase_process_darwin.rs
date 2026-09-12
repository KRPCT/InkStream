//! Verify Darwin's zombie-only process-group EPERM without hiding permission failures.
use std::mem::{size_of, zeroed};
use std::time::{Duration, Instant};

/// The caller retains its exited, unreaped group leader, so this group ID cannot be reused.
pub(super) fn group_has_no_live_members(leader: u32) -> Result<bool, String> {
    let deadline = Instant::now() + Duration::from_millis(250);
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
        let mut info: libc::proc_bsdinfo = unsafe { zeroed() };
        let size = size_of::<libc::proc_bsdinfo>() as i32;
        // arg=1 includes zombies, allowing an explicit state check rather than
        // treating an unreadable process as proof of successful termination.
        let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 1, (&mut info as *mut libc::proc_bsdinfo).cast(), size) };
        if read != size {
            if read == 0 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) && pid != leader as i32 {
                continue;
            }
            return Err("无法确认自有 Git 进程组成员的退出状态".into());
        }
        if info.pbi_pid != pid as u32 || (pid == leader as i32 && info.pbi_pgid != leader) {
            return Err("自有 Git 进程组成员身份发生变化".into());
        }
        if info.pbi_pgid == leader && info.pbi_status != libc::SZOMB {
            return Ok(false);
        }
    }
    Ok(true)
}
