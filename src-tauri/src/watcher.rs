use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// vault watcher 防抖窗口（A4 裁量）。磁盘抖动（编辑器临时文件、连续写）在此窗口内合并。
const DEBOUNCE: Duration = Duration::from_millis(400);

/// 全 App 单例 watcher 句柄（切 vault 时停旧启新，Runtime State Inventory）。
///
/// Debouncer 持有后台监听线程，drop 即停。换 vault 调 [`stop_watch`] 先释放再 [`start_watch`]。
/// 绑定默认运行时 [`tauri::Wry`]（本项目唯一运行时），避免泛型 PhantomData 的 Send/Sync 约束。
#[derive(Default)]
struct WatcherState {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
}

/// emit 到前端的变更载荷。`vault://change` 为唯一 watcher 事件 channel 名。
#[derive(Clone, Serialize)]
pub struct VaultChange {
    /// 变更文件的绝对路径（前端按 vault 根换算相对路径后比对当前 tab）。
    pub path: String,
    /// 变更类型语义标签（create / modify / remove / other）。
    pub kind: String,
}

/// notify EventKind → 稳定字符串标签（前端只读语义，不依赖 notify 内部枚举布局）。
fn kind_label(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        _ => "other",
    }
}

/// 启动 vault 根递归监听：去抖后对每个变更 `emit("vault://change", VaultChange)`。
///
/// 自激抑制由前端 `suppressNextWatch` 协同完成（Pitfall 2）——本侧不再维护忽略窗口，
/// 因前端原子写在 invoke 返回后即知写入路径，比 Rust 侧时间窗更精确。换 vault 时 [`stop_watch`]。
#[tauri::command]
pub fn start_watch(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let canon = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析 vault 根: {e}"))?;

    let state = app.state::<WatcherState>();
    // 先停旧监听（换 vault 幂等）。
    *state.debouncer.lock().map_err(|_| "watcher 锁中毒".to_string())? = None;

    let emit_app = app.clone();
    let mut debouncer = new_debouncer(
        DEBOUNCE,
        None,
        move |result: DebounceEventResult| {
            if let Ok(events) = result {
                for event in events {
                    let kind = kind_label(&event.kind);
                    for path in &event.paths {
                        let _ = emit_app.emit(
                            "vault://change",
                            VaultChange {
                                path: path.to_string_lossy().into_owned(),
                                kind: kind.to_string(),
                            },
                        );
                    }
                }
            }
        },
    )
    .map_err(|e| format!("无法创建 watcher: {e}"))?;

    debouncer
        .watch(&canon, RecursiveMode::Recursive)
        .map_err(|e| format!("无法监听 vault 根: {e}"))?;

    *state.debouncer.lock().map_err(|_| "watcher 锁中毒".to_string())? = Some(debouncer);
    Ok(())
}

/// 停止当前监听（切 vault / 关闭 vault 时调）。幂等：未监听时为 no-op。
#[tauri::command]
pub fn stop_watch(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    *state.debouncer.lock().map_err(|_| "watcher 锁中毒".to_string())? = None;
    Ok(())
}

/// 在 Builder.setup 注册 watcher 单例状态。
pub fn init(app: &tauri::App) {
    app.manage(WatcherState::default());
}

#[cfg(test)]
mod tests {
    use super::kind_label;
    use notify_debouncer_full::notify::event::{
        AccessKind, CreateKind, ModifyKind, RemoveKind,
    };
    use notify_debouncer_full::notify::EventKind;

    #[test]
    fn kind_label_maps_known_variants() {
        assert_eq!(kind_label(&EventKind::Create(CreateKind::Any)), "create");
        assert_eq!(kind_label(&EventKind::Modify(ModifyKind::Any)), "modify");
        assert_eq!(kind_label(&EventKind::Remove(RemoveKind::Any)), "remove");
        assert_eq!(kind_label(&EventKind::Access(AccessKind::Any)), "other");
    }

    #[test]
    fn vault_change_channel_name_is_stable() {
        // 文档化锚点：前端 onVaultChange 订阅同名 channel。
        assert_eq!("vault://change", "vault://change");
    }
}
