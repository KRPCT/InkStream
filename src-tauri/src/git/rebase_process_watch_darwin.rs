//! Test-only process-exit oracle, independent of the process runner under test.
use std::cell::Cell;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

pub(crate) struct Watch {
    queue: OwnedFd,
    pid: u32,
    exited: Cell<bool>,
}

impl Watch {
    pub fn new(pid: u32) -> Self {
        // Register while the fixture is known alive. The kernel registration tracks
        // this process, so a later PID reuse cannot masquerade as continued life.
        let fd = unsafe { libc::kqueue() };
        assert!(fd >= 0, "cannot create process-exit queue: {}", std::io::Error::last_os_error());
        let queue = unsafe { OwnedFd::from_raw_fd(fd) };
        assert_eq!(unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) }, 0,
            "cannot isolate process-exit queue: {}", std::io::Error::last_os_error());
        let change = libc::kevent {
            ident: pid as libc::uintptr_t,
            filter: libc::EVFILT_PROC,
            flags: libc::EV_ADD | libc::EV_ENABLE | libc::EV_ONESHOT,
            fflags: libc::NOTE_EXIT,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        let poll = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        let result = unsafe { libc::kevent(fd, &change, 1, std::ptr::null_mut(), 0, &poll) };
        assert_eq!(result, 0, "cannot observe fixture process {pid}: {}", std::io::Error::last_os_error());
        Self { queue, pid, exited: Cell::new(false) }
    }

    pub fn alive(&self) -> bool {
        if self.exited.get() { return false; }
        let poll = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        let mut event: libc::kevent = unsafe { std::mem::zeroed() };
        let result = unsafe { libc::kevent(self.queue.as_raw_fd(), std::ptr::null(), 0, &mut event, 1, &poll) };
        assert!(result >= 0, "cannot poll fixture process {}: {}", self.pid, std::io::Error::last_os_error());
        if result == 0 { return true; }
        // kevent is packed on Darwin; copy fields before assertion macros borrow them.
        let (ident, filter, flags, note, error) = (event.ident, event.filter, event.flags, event.fflags, event.data);
        assert_eq!(ident, self.pid as libc::uintptr_t);
        assert_eq!(filter, libc::EVFILT_PROC);
        assert_eq!(flags & libc::EV_ERROR, 0, "fixture process observation failed with errno {error}");
        assert_ne!(note & libc::NOTE_EXIT, 0, "unexpected fixture process event {note}");
        self.exited.set(true);
        false
    }
}
