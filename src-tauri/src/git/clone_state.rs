use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::time::{Duration, Instant};

static REGISTRY: LazyLock<Arc<Registry>> = LazyLock::new(|| Arc::new(Registry::default()));
const MAX_ACTIVE: usize = 4;
const TOMBSTONE_LIMIT: usize = 256;
const TOMBSTONE_TTL: Duration = Duration::from_secs(600);

#[derive(PartialEq)]
enum Phase {
    Running,
    Cancelled,
    Published,
}
pub(super) struct Control {
    pub cancelled: AtomicBool,
    pub started: Instant,
    pub owner: String,
    phase: Mutex<Phase>,
}
impl Control {
    fn cancel(&self) -> bool {
        let mut phase = self.phase.lock().unwrap();
        if *phase == Phase::Published {
            return false;
        }
        *phase = Phase::Cancelled;
        self.cancelled.store(true, Ordering::Release);
        true
    }
    pub(super) fn publish<T>(
        &self,
        timeout: Duration,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut phase = self.phase.lock().unwrap();
        if *phase != Phase::Running || self.cancelled.load(Ordering::Acquire) {
            return Err("克隆已取消，目标目录未创建。".into());
        }
        if self.started.elapsed() >= timeout {
            return Err("克隆超过执行期限，目标目录未创建。".into());
        }
        let result = operation()?;
        *phase = Phase::Published;
        Ok(result)
    }
}

#[derive(Default)]
struct Inner {
    active: HashMap<String, Arc<Control>>,
    cancelled: HashMap<(String, String), Instant>,
}
#[derive(Default)]
pub(super) struct Registry {
    inner: Mutex<Inner>,
}
pub(super) struct Lease {
    pub control: Arc<Control>,
    id: String,
    registry: Weak<Registry>,
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(registry) = self.registry.upgrade() {
            let mut inner = registry.inner.lock().unwrap();
            if inner
                .active
                .get(&self.id)
                .is_some_and(|control| Arc::ptr_eq(control, &self.control))
            {
                inner.active.remove(&self.id);
            }
        }
    }
}

pub(super) fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

impl Registry {
    pub(super) fn acquire(self: &Arc<Self>, owner: &str, id: String) -> Result<Lease, String> {
        if !valid_id(&id) {
            return Err("克隆请求标识无效。".into());
        }
        let mut inner = self.inner.lock().unwrap();
        inner
            .cancelled
            .retain(|_, time| time.elapsed() < TOMBSTONE_TTL);
        if inner.active.contains_key(&id) {
            return Err("克隆请求已在执行。".into());
        }
        if inner.active.len() >= MAX_ACTIVE {
            return Err("克隆任务已达并发上限。".into());
        }
        let cancelled = inner
            .cancelled
            .remove(&(owner.to_string(), id.clone()))
            .is_some();
        let control = Arc::new(Control {
            cancelled: AtomicBool::new(cancelled),
            started: Instant::now(),
            owner: owner.into(),
            phase: Mutex::new(if cancelled {
                Phase::Cancelled
            } else {
                Phase::Running
            }),
        });
        inner.active.insert(id.clone(), control.clone());
        Ok(Lease {
            control,
            id,
            registry: Arc::downgrade(self),
        })
    }
    pub(super) fn cancel(&self, owner: &str, id: &str) -> bool {
        if !valid_id(id) {
            return false;
        }
        let mut inner = self.inner.lock().unwrap();
        if let Some(control) = inner.active.get(id) {
            return control.owner == owner && control.cancel();
        }
        inner
            .cancelled
            .retain(|_, time| time.elapsed() < TOMBSTONE_TTL);
        if inner.cancelled.len() >= TOMBSTONE_LIMIT {
            return false;
        }
        inner
            .cancelled
            .insert((owner.into(), id.into()), Instant::now());
        true
    }
    pub(super) fn close_owner(&self, owner: &str) {
        for control in self
            .inner
            .lock()
            .unwrap()
            .active
            .values()
            .filter(|control| control.owner == owner)
        {
            control.cancel();
        }
    }
}

pub(super) fn acquire(owner: &str, id: String) -> Result<Lease, String> {
    REGISTRY.acquire(owner, id)
}
pub(super) fn cancel(owner: &str, id: &str) -> bool {
    REGISTRY.cancel(owner, id)
}
pub(super) fn close_owner(owner: &str) {
    REGISTRY.close_owner(owner);
}
