use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub(super) const CHUNK_BYTES: usize = 256 * 1024;
const WINDOW_BYTES: u64 = 1024 * 1024;
const MAX_READERS: usize = 4;

#[derive(Clone, Copy)]
pub(super) struct Limits {
    pub total: Duration,
    pub idle: Duration,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            total: Duration::from_secs(120),
            idle: Duration::from_secs(15),
        }
    }
}

struct Flow {
    sent: u64,
    acknowledged: u64,
    last_progress: Instant,
    cancelled: bool,
}

pub(super) struct Control {
    flow: Mutex<Flow>,
    wake: Condvar,
    started: Instant,
    limits: Limits,
}

impl Control {
    fn new(limits: Limits) -> Self {
        let now = Instant::now();
        Self {
            flow: Mutex::new(Flow {
                sent: 0,
                acknowledged: 0,
                last_progress: now,
                cancelled: false,
            }),
            wake: Condvar::new(),
            started: now,
            limits,
        }
    }
    fn remaining_locked(&self, flow: &Flow) -> Result<Duration, String> {
        if flow.cancelled {
            return Err("文件读取已取消。".into());
        }
        let total = self
            .limits
            .total
            .checked_sub(self.started.elapsed())
            .filter(|left| !left.is_zero())
            .ok_or("文件读取超过总期限。")?;
        let idle = self
            .limits
            .idle
            .checked_sub(flow.last_progress.elapsed())
            .filter(|left| !left.is_zero())
            .ok_or("文件读取长时间没有进展，已停止。")?;
        Ok(total.min(idle))
    }
    pub fn remaining(&self) -> Result<Duration, String> {
        let flow = self.flow.lock().map_err(|_| "文件读取状态不可用")?;
        self.remaining_locked(&flow)
    }
    pub fn progress(&self) -> Result<(), String> {
        let mut flow = self.flow.lock().map_err(|_| "文件读取状态不可用")?;
        self.remaining_locked(&flow)?;
        flow.last_progress = Instant::now();
        Ok(())
    }
    pub fn reserve(&self, bytes: usize) -> Result<(), String> {
        let mut flow = self.flow.lock().map_err(|_| "文件读取状态不可用")?;
        loop {
            let remaining = self.remaining_locked(&flow)?;
            if flow.sent + bytes as u64 - flow.acknowledged <= WINDOW_BYTES {
                flow.sent += bytes as u64;
                flow.last_progress = Instant::now();
                return Ok(());
            }
            (flow, _) = self
                .wake
                .wait_timeout(flow, remaining)
                .map_err(|_| "文件读取等待失败")?;
        }
    }
    fn acknowledge(&self, received: u64) -> Result<(), String> {
        let mut flow = self.flow.lock().map_err(|_| "文件读取状态不可用")?;
        if received > flow.sent {
            return Err("确认位置超出已发送文件内容。".into());
        }
        if received > flow.acknowledged {
            flow.acknowledged = received;
            flow.last_progress = Instant::now();
            self.wake.notify_all();
        }
        Ok(())
    }
    pub fn cancel(&self) {
        if let Ok(mut flow) = self.flow.lock() {
            flow.cancelled = true;
            self.wake.notify_all();
        }
    }
}

#[derive(Default)]
struct Registry {
    active: HashMap<String, Arc<Control>>,
    cancelled_before_start: VecDeque<(String, Instant)>,
}
static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(Registry::default()));
static PERMITS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(MAX_READERS)));

pub(super) struct Lease {
    id: String,
    pub control: Arc<Control>,
    // 即使OS文件I/O未能被取消，也保留槽位，避免超时重试创建无界原生线程。
    _permit: OwnedSemaphorePermit,
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut registry) = REGISTRY.lock() {
            if registry
                .active
                .get(&self.id)
                .is_some_and(|control| Arc::ptr_eq(control, &self.control))
            {
                registry.active.remove(&self.id);
            }
        }
    }
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("文件读取requestId无效。".into());
    }
    Ok(())
}

pub(super) fn register(id: String, limits: Limits) -> Result<Lease, String> {
    valid_id(&id)?;
    let permit = PERMITS
        .clone()
        .try_acquire_owned()
        .map_err(|_| "文件读取正在忙，请稍后重试。")?;
    let mut registry = REGISTRY.lock().map_err(|_| "文件读取注册表不可用")?;
    registry
        .cancelled_before_start
        .retain(|(_, when)| when.elapsed() < Duration::from_secs(120));
    if let Some(index) = registry
        .cancelled_before_start
        .iter()
        .position(|(cancelled, _)| cancelled == &id)
    {
        registry.cancelled_before_start.remove(index);
        return Err("文件读取已取消。".into());
    }
    if registry.active.contains_key(&id) {
        return Err("文件读取requestId已在使用。".into());
    }
    let control = Arc::new(Control::new(limits));
    registry.active.insert(id.clone(), control.clone());
    Ok(Lease {
        id,
        control,
        _permit: permit,
    })
}

pub(super) fn acknowledge(id: &str, received: u64) -> Result<(), String> {
    valid_id(id)?;
    let control = REGISTRY
        .lock()
        .map_err(|_| "文件读取注册表不可用")?
        .active
        .get(id)
        .cloned();
    if let Some(control) = control {
        control.acknowledge(received)?;
    }
    Ok(()) // 完成后的迟到确认无副作用。
}

pub(super) fn cancel(id: String) -> Result<(), String> {
    valid_id(&id)?;
    let control = {
        let mut registry = REGISTRY.lock().map_err(|_| "文件读取注册表不可用")?;
        if let Some(control) = registry.active.get(&id) {
            Some(control.clone())
        } else {
            registry.cancelled_before_start.retain(|(existing, when)| {
                existing != &id && when.elapsed() < Duration::from_secs(120)
            });
            if registry.cancelled_before_start.len() >= 64 {
                registry.cancelled_before_start.pop_front();
            }
            registry
                .cancelled_before_start
                .push_back((id, Instant::now()));
            None
        }
    };
    if let Some(control) = control {
        control.cancel();
    }
    Ok(())
}
