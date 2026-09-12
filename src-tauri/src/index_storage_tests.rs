use super::{storage::Storage, worker::{IndexState, Operation, Scope}};
use crate::projects::ProjectRepository;
use sqlx::sqlite::SqlitePoolOptions;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const A: &str = "00000000-0000-4000-8000-00000000000a";
const B: &str = "00000000-0000-4000-8000-00000000000b";
struct Fixture { base: PathBuf, data: PathBuf, a: PathBuf, b: PathBuf, repository: Arc<ProjectRepository> }
impl Fixture {
    fn new() -> Self {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("inkstream-index-storage-{}-{nonce}", std::process::id()));
        let data = base.join("application data 中文"); let a = base.join("project A"); let b = base.join("project B");
        std::fs::create_dir_all(&a).unwrap(); std::fs::create_dir_all(&b).unwrap();
        let repository = Arc::new(ProjectRepository::new(data.clone()));
        repository.register(A.into(), a.to_string_lossy().into_owned(), "A".into()).unwrap();
        repository.register(B.into(), b.to_string_lossy().into_owned(), "B".into()).unwrap();
        Self { base, data, a, b, repository }
    }
    fn actor(&self) -> IndexState {
        let repository = self.repository.clone();
        IndexState::start_with_resolver(Arc::new(move |scope| Storage::project(&repository, scope)))
    }
    fn scope(&self, root: &Path, project: &str, session: &str) -> Scope {
        Scope::new(root.to_string_lossy().into_owned(), session.into()).unwrap().with_project(Some(project.into()))
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.base); } }

async fn text(url: &str, path: &str) -> Option<String> {
    // The same authoritative URL consumed by the frontend must open the actual writer database.
    let pool = SqlitePoolOptions::new().max_connections(1).connect(url).await.unwrap();
    let value = sqlx::query_scalar("SELECT content FROM files WHERE path=?").bind(path).fetch_optional(&pool).await.unwrap();
    pool.close().await; value
}

#[test]
fn app_data_indexes_are_project_isolated_and_legacy_unknown_files_are_untouched() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new();
        std::fs::create_dir(fixture.a.join(".inkstream")).unwrap();
        let legacy = fixture.a.join(".inkstream");
        std::fs::write(legacy.join("index.db"), b"unknown old index bytes, deliberately not SQLite").unwrap();
        std::fs::write(legacy.join("notes.md"), "用户未知资料，必须保留").unwrap();
        std::fs::write(legacy.join(".gitignore"), "user-owned rule\n").unwrap();
        std::fs::write(fixture.a.join("same.MD"), "属于 A 的正文").unwrap();
        std::fs::write(fixture.b.join("same.MD"), "属于 B 的正文").unwrap();
        let actor = fixture.actor();
        let sa = fixture.scope(&fixture.a, A, "app-a"); let sb = fixture.scope(&fixture.b, B, "app-b");
        let a = actor.submit(sa.clone(), Operation::Prepare { rebuild: false }).await.unwrap().unwrap();
        let b = actor.submit(sb.clone(), Operation::Prepare { rebuild: false }).await.unwrap().unwrap();
        assert_eq!(a.project_id, A); assert_eq!(b.project_id, B); assert_ne!(a.database_url, b.database_url);
        assert!(fixture.data.join("indexes").join(A).join("index.db").is_file());
        assert!(fixture.data.join("indexes").join(B).join("index.db").is_file());
        assert_eq!(text(&a.database_url, "same.MD").await.as_deref(), Some("属于 A 的正文"));
        assert_eq!(text(&b.database_url, "same.MD").await.as_deref(), Some("属于 B 的正文"));
        assert!(actor.submit(sa, Operation::Upsert { path: "same.MD".into(), content: "迟到 A".into() }).await.is_err());
        actor.submit(sb, Operation::Stop).await.unwrap();
        assert!(!fixture.b.join(".inkstream").exists());
        assert_eq!(std::fs::read(legacy.join("index.db")).unwrap(), b"unknown old index bytes, deliberately not SQLite");
        assert_eq!(std::fs::read_to_string(legacy.join("notes.md")).unwrap(), "用户未知资料，必须保留");
        assert_eq!(std::fs::read_to_string(legacy.join(".gitignore")).unwrap(), "user-owned rule\n");
    });
}

#[test]
fn restart_and_relocate_reuse_project_identity_and_rebuild_from_current_content() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new();
        std::fs::write(fixture.a.join("note.md"), "第一版").unwrap();
        let actor = fixture.actor(); let first_scope = fixture.scope(&fixture.a, A, "first");
        let first = actor.submit(first_scope.clone(), Operation::Prepare { rebuild: true }).await.unwrap().unwrap();
        actor.submit(first_scope, Operation::Stop).await.unwrap(); drop(actor);
        let moved = fixture.base.join("relocated project");
        std::fs::rename(&fixture.a, &moved).unwrap();
        fixture.repository.relocate(A.into(), moved.to_string_lossy().into_owned()).unwrap();
        std::fs::write(moved.join("note.md"), "关闭期间修改的第二版").unwrap();
        // Fresh repository instance reads the persisted catalog; there is no second ID registry.
        let reloaded = Arc::new(ProjectRepository::new(fixture.data.clone()));
        let actor = IndexState::start_with_resolver(Arc::new(move |scope| Storage::project(&reloaded, scope)));
        let second_scope = fixture.scope(&moved, A, "restart");
        let second = actor.submit(second_scope.clone(), Operation::Prepare { rebuild: false }).await.unwrap().unwrap();
        assert_eq!(first.database_url, second.database_url);
        assert_eq!(text(&second.database_url, "note.md").await.as_deref(), Some("关闭期间修改的第二版"));
        assert!(!moved.join(".inkstream").exists());
        actor.submit(second_scope, Operation::Stop).await.unwrap();
    });
}

#[test]
fn wrong_project_binding_and_unregistered_roots_never_create_user_folder_metadata() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(); let actor = fixture.actor();
        let wrong = fixture.scope(&fixture.a, B, "wrong-binding");
        assert!(actor.submit(wrong.clone(), Operation::Prepare { rebuild: true }).await.unwrap_err().contains("身份"));
        actor.submit(wrong, Operation::Stop).await.unwrap();
        let unknown = fixture.base.join("unregistered"); std::fs::create_dir(&unknown).unwrap();
        let scope = fixture.scope(&unknown, A, "unregistered");
        assert!(actor.submit(scope.clone(), Operation::Prepare { rebuild: true }).await.unwrap_err().contains("尚未登记"));
        actor.submit(scope, Operation::Stop).await.unwrap();
        assert!(!fixture.a.join(".inkstream").exists()); assert!(!unknown.join(".inkstream").exists());
    });
}

#[test]
fn failed_rebuild_does_not_mark_a_partial_index_ready_and_can_be_retried_after_restart() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(); let actor = fixture.actor();
        std::fs::write(fixture.a.join("good.md"), "完整正文").unwrap();
        std::fs::write(fixture.a.join("bad.md"), [255, 254]).unwrap();
        let scope = fixture.scope(&fixture.a, A, "failed-initial");
        assert!(actor.submit(scope.clone(), Operation::Prepare { rebuild: false }).await.is_err());
        actor.submit(scope, Operation::Stop).await.unwrap(); drop(actor);
        std::fs::write(fixture.a.join("bad.md"), "修复的正文").unwrap();
        let actor = fixture.actor(); let scope = fixture.scope(&fixture.a, A, "retry");
        let ready = actor.submit(scope.clone(), Operation::Prepare { rebuild: false }).await.unwrap().unwrap();
        assert_eq!(text(&ready.database_url, "bad.md").await.as_deref(), Some("修复的正文"));
        assert_eq!(text(&ready.database_url, "good.md").await.as_deref(), Some("完整正文"));
        actor.submit(scope, Operation::Stop).await.unwrap();
    });
}
