use super::write::{execute_file_write, write_body};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::InvokeBody;

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "inkstream-raw-write-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn absolute(&self, name: &str) -> Value {
        json!({"kind":"absolute", "path":self.0.join(name).to_string_lossy()})
    }
    fn vault(&self, path: &str) -> Value {
        json!({"kind":"vault", "root":self.0.to_string_lossy(), "path":path})
    }
    fn untouched(&self) {
        assert_eq!(
            std::fs::read(self.0.join("existing.md")).unwrap(),
            b"original"
        );
        assert!(!std::fs::read_dir(&self.0).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".inkstream-tmp-")));
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn frame(metadata: Value, bytes: &[u8]) -> Vec<u8> {
    let metadata = serde_json::to_vec(&metadata).unwrap();
    let mut result = (metadata.len() as u32).to_le_bytes().to_vec();
    result.extend_from_slice(&metadata);
    result.extend_from_slice(bytes);
    result
}
fn metadata(target: Value, encoding: &str, length: usize) -> Value {
    json!({"version":1,"target":target,"encoding":encoding,"byteLength":length})
}

#[test]
fn raw_text_and_binary_round_trip_with_vault_and_absolute_targets() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let text = format!("\u{feff}{}TAIL", "墨🙂\n".repeat(150_000));
        write_body(InvokeBody::Raw(frame(
            metadata(sandbox.vault("中文.md"), "utf8", text.len()),
            text.as_bytes(),
        )))
        .await
        .unwrap();
        assert!(std::fs::read(sandbox.0.join("中文.md")).unwrap() == text.as_bytes());
        let binary: Vec<u8> = (0..1024 * 1024 + 17)
            .map(|index| (index % 251) as u8)
            .collect();
        write_body(InvokeBody::Raw(frame(
            metadata(sandbox.absolute("bytes.docx"), "bytes", binary.len()),
            &binary,
        )))
        .await
        .unwrap();
        assert!(std::fs::read(sandbox.0.join("bytes.docx")).unwrap() == binary);
    });
}

#[test]
fn unsupported_raw_write_version_cannot_replace_the_original() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.0.join("existing.md"), b"original").unwrap();
        let mut spec = metadata(sandbox.absolute("existing.md"), "utf8", 3);
        spec["version"] = json!(2);
        let result = write_body(InvokeBody::Raw(frame(spec, b"new"))).await;
        assert!(
            result.is_err(),
            "unsupported protocol version was committed"
        );
        sandbox.untouched();
    });
}

#[test]
fn declared_write_length_must_match_the_entire_raw_payload() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.0.join("existing.md"), b"original").unwrap();
        let result = write_body(InvokeBody::Raw(frame(
            metadata(sandbox.absolute("existing.md"), "utf8", 8),
            b"new",
        )))
        .await;
        assert!(result.is_err(), "truncated payload was committed");
        sandbox.untouched();
    });
}

#[test]
fn raw_write_metadata_has_a_finite_budget_before_any_file_is_opened() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.0.join("existing.md"), b"original").unwrap();
        let mut spec = metadata(sandbox.absolute("existing.md"), "utf8", 3);
        spec["padding"] = json!("x".repeat(256 * 1024));
        let result = write_body(InvokeBody::Raw(frame(spec, b"new"))).await;
        assert!(result.is_err(), "oversized metadata was accepted");
        sandbox.untouched();
    });
}

#[test]
fn malformed_frames_invalid_utf8_and_json_bodies_leave_existing_files_untouched() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.0.join("existing.md"), b"original").unwrap();
        let bodies = [
            InvokeBody::Json(json!({"content":"new"})),
            InvokeBody::Raw(vec![1, 2, 3]),
            InvokeBody::Raw(u32::MAX.to_le_bytes().to_vec()),
            InvokeBody::Raw(vec![1, 0, 0, 0, 255]),
            InvokeBody::Raw(frame(
                metadata(sandbox.absolute("existing.md"), "utf8", 1),
                &[255],
            )),
        ];
        for body in bodies {
            assert!(write_body(body).await.is_err());
            sandbox.untouched();
        }
    });
}

#[test]
fn raw_writes_keep_path_guards_and_remove_temps_when_atomic_rename_fails() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let outside = Sandbox::new();
        std::fs::write(outside.0.join("outside.md"), b"original outside").unwrap();
        let targets = [
            json!({"kind":"absolute", "path":"relative.md"}),
            json!({"kind":"vault", "root":sandbox.0.to_string_lossy(), "path":outside.0.join("outside.md").to_string_lossy()}),
            sandbox.vault("../escape.md"),
        ];
        for target in targets {
            assert!(
                write_body(InvokeBody::Raw(frame(metadata(target, "utf8", 3), b"new")))
                    .await
                    .is_err()
            );
        }
        assert_eq!(
            std::fs::read(outside.0.join("outside.md")).unwrap(),
            b"original outside"
        );
        std::fs::create_dir(sandbox.0.join("blocked.md")).unwrap();
        std::fs::write(
            sandbox.0.join("blocked.md/original"),
            b"original directory contents",
        )
        .unwrap();
        let failed = write_body(InvokeBody::Raw(frame(
            metadata(sandbox.absolute("blocked.md"), "utf8", 3),
            b"new",
        )))
        .await;
        assert!(
            failed.unwrap_err().contains("rename"),
            "fixture must reach the atomic rename failure"
        );
        assert!(sandbox.0.join("blocked.md").is_dir());
        assert_eq!(
            std::fs::read(sandbox.0.join("blocked.md/original")).unwrap(),
            b"original directory contents"
        );
        assert!(!std::fs::read_dir(&sandbox.0).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".inkstream-tmp-")));
    });
}

#[test]
fn atomic_file_io_runs_on_a_worker_instead_of_the_calling_thread() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let target = sandbox.0.join("thread.md");
        let caller = std::thread::current().id();
        let writer = Arc::new(Mutex::new(None));
        let captured = writer.clone();
        execute_file_write(move || {
            *captured.lock().unwrap() = Some(std::thread::current().id());
            super::write_atomic_bytes(&target, b"worker content")
        })
        .await
        .unwrap();
        assert_ne!(
            *writer.lock().unwrap(),
            Some(caller),
            "atomic I/O still blocks its caller"
        );
        assert_eq!(
            std::fs::read(sandbox.0.join("thread.md")).unwrap(),
            b"worker content"
        );
    });
}

#[cfg(unix)]
#[test]
fn raw_writes_preserve_existing_unix_permissions() {
    use std::os::unix::fs::PermissionsExt;
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        for (name, mode) in [
            ("private.md", 0o600),
            ("run.sh", 0o751),
            ("executable.sh", 0o755),
        ] {
            let target = sandbox.0.join(name);
            std::fs::write(&target, b"private").unwrap();
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode)).unwrap();
            write_body(InvokeBody::Raw(frame(
                metadata(sandbox.absolute(name), "utf8", 3),
                b"new",
            )))
            .await
            .unwrap();
            assert_eq!(
                std::fs::metadata(target).unwrap().permissions().mode() & 0o7777,
                mode
            );
        }
    });
}

#[cfg(unix)]
#[test]
fn new_raw_files_match_default_permissions_of_an_ordinary_sibling_write() {
    use std::os::unix::fs::PermissionsExt;
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let control = sandbox.0.join("ordinary.md");
        std::fs::write(&control, b"control").unwrap();
        write_body(InvokeBody::Raw(frame(
            metadata(sandbox.absolute("raw.md"), "utf8", 3),
            b"new",
        )))
        .await
        .unwrap();
        let expected = std::fs::metadata(control).unwrap().permissions().mode() & 0o7777;
        let actual = std::fs::metadata(sandbox.0.join("raw.md"))
            .unwrap()
            .permissions()
            .mode()
            & 0o7777;
        assert_eq!(
            actual, expected,
            "new Raw writes changed the default file mode"
        );
    });
}
