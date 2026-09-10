use super::stream::{
    ack_file_read, cancel_file_read, read_file_stream, read_with_limits, FileReadTarget,
};
use super::stream_control::Limits;
use super::{read_file, read_file_bytes, read_image_bytes};
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

// All cases share the production admission registry, including under parallel cargo test.
static STREAM_TEST: Mutex<()> = Mutex::new(());

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "inkstream-file-stream-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn path(&self, name: &str) -> String {
        self.0.join(name).to_string_lossy().into_owned()
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct Received {
    raw_lengths: Vec<usize>,
    offsets: Vec<u64>,
    bytes: Vec<u8>,
    largest_json: usize,
    controls: Vec<String>,
}

fn channel(disconnect_on_data: bool) -> (Channel<InvokeResponseBody>, Arc<Mutex<Received>>) {
    let received = Arc::new(Mutex::new(Received::default()));
    let captured = received.clone();
    let channel = Channel::new(move |message| {
        let mut captured = captured.lock().unwrap();
        let data = match message {
            InvokeResponseBody::Raw(frame) => {
                captured.raw_lengths.push(frame.len());
                if frame.len() >= 8 {
                    captured
                        .offsets
                        .push(u64::from_le_bytes(frame[..8].try_into().unwrap()));
                    captured.bytes.extend_from_slice(&frame[8..]);
                }
                true
            }
            InvokeResponseBody::Json(json) => {
                captured.largest_json = captured.largest_json.max(json.len());
                if json.starts_with('{') {
                    let control: serde_json::Value = serde_json::from_str(&json).unwrap();
                    captured
                        .controls
                        .push(control["type"].as_str().unwrap_or("").to_string());
                }
                json.starts_with('[')
            }
        };
        if disconnect_on_data && data {
            return Err(std::io::Error::new(
                ErrorKind::BrokenPipe,
                "fixture receiver disconnected",
            )
            .into());
        }
        Ok(())
    });
    (channel, received)
}

#[test]
fn large_reads_emit_a_bounded_raw_frame_and_stop_when_the_receiver_disconnects() {
    let _serial = STREAM_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.0.join("book.pdf"), vec![42u8; 1024 * 1024 + 17]).unwrap();
        let (channel, received) = channel(true);
        let result = read_file_stream(
            "large-disconnect".into(),
            FileReadTarget::Reading {
                path: sandbox.path("book.pdf"),
            },
            channel,
        )
        .await;
        let received = received.lock().unwrap();
        assert!(result.is_err());
        assert_eq!(
            received.raw_lengths.len(),
            1,
            "data must travel as Raw, not a giant JSON array"
        );
        assert!(received.raw_lengths[0] <= 256 * 1024 + 8);
        assert!(
            received.largest_json < 4096,
            "JSON is reserved for small control messages"
        );
    });
}

#[test]
fn text_frames_preserve_exact_utf8_bytes_with_ordered_offsets_and_completion() {
    let _serial = STREAM_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let text = "墨🙂".repeat(85_000);
        std::fs::write(sandbox.0.join("text.md"), &text).unwrap();
        let (channel, received) = channel(false);
        let result = read_file_stream(
            "text-roundtrip".into(),
            FileReadTarget::Text {
                root: sandbox.0.to_string_lossy().into_owned(),
                path: "text.md".into(),
            },
            channel,
        )
        .await;
        let received = received.lock().unwrap();
        assert!(result.is_ok());
        assert_eq!(received.bytes.len(), text.len());
        assert!(received.bytes == text.as_bytes());
        assert_eq!(received.offsets, vec![0, 262_144, 524_288]);
        assert_eq!(received.controls, vec!["start", "end"]);
        assert!(received.raw_lengths.iter().all(|length| *length <= 262_152));
    });
}

#[test]
fn streaming_keeps_existing_path_extension_size_and_utf8_guards() {
    let _serial = STREAM_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::create_dir_all(sandbox.0.join("vault")).unwrap();
        std::fs::write(sandbox.0.join("outside.md"), "outside").unwrap();
        std::fs::write(sandbox.0.join("secret.bin"), "not an allowed reader format").unwrap();
        std::fs::write(sandbox.0.join("invalid.md"), [255, 254]).unwrap();
        let large = std::fs::File::create(sandbox.0.join("too-large.png")).unwrap();
        large.set_len(25 * 1024 * 1024 + 1).unwrap();
        drop(large);
        let large_text = std::fs::File::create(sandbox.0.join("too-large.md")).unwrap();
        large_text.set_len(100 * 1024 * 1024 + 1).unwrap();
        drop(large_text);
        let targets = vec![
            FileReadTarget::Text {
                root: sandbox.path("vault"),
                path: "../outside.md".into(),
            },
            FileReadTarget::Text {
                root: sandbox.0.to_string_lossy().into_owned(),
                path: "invalid.md".into(),
            },
            FileReadTarget::Reading {
                path: sandbox.path("secret.bin"),
            },
            FileReadTarget::Image {
                path: sandbox.path("outside.md"),
            },
            FileReadTarget::Image {
                path: "relative.png".into(),
            },
            FileReadTarget::Image {
                path: sandbox.path("too-large.png"),
            },
            FileReadTarget::Text {
                root: sandbox.0.to_string_lossy().into_owned(),
                path: "too-large.md".into(),
            },
            FileReadTarget::Reading {
                path: sandbox.path("too-large.md"),
            },
        ];
        for (index, target) in targets.into_iter().enumerate() {
            let (channel, received) = channel(false);
            let result = read_file_stream(format!("guard-{index}"), target, channel).await;
            assert!(result.is_err());
            assert!(received.lock().unwrap().raw_lengths.is_empty());
        }
    });
}

#[test]
fn legacy_json_commands_reject_payloads_over_the_inline_limit() {
    let _serial = STREAM_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let sandbox = Sandbox::new();
    let bytes = vec![b'x'; 1024 * 1024 + 1];
    for name in ["text.md", "book.pdf", "image.png"] {
        std::fs::write(sandbox.0.join(name), &bytes).unwrap();
    }
    let text_rejected =
        read_file(sandbox.0.to_string_lossy().into_owned(), "text.md".into()).is_err();
    let reading_rejected = read_file_bytes(sandbox.path("book.pdf")).is_err();
    let image_rejected = read_image_bytes(sandbox.path("image.png")).is_err();
    assert!(
        text_rejected && reading_rejected && image_rejected,
        "legacy invoke must not remain a giant JSON bypass"
    );
    std::fs::write(sandbox.0.join("expanded.pdf"), vec![255u8; 300 * 1024]).unwrap();
    assert!(
        read_file_bytes(sandbox.path("expanded.pdf")).is_err(),
        "the cap applies to encoded JSON, not only raw file bytes"
    );
}

#[test]
fn acknowledged_large_transfer_preserves_every_byte_across_multiple_windows() {
    let _serial = STREAM_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let expected: Vec<u8> = (0..10 * 1024 * 1024 + 17)
            .map(|index| (index % 251) as u8)
            .collect();
        std::fs::write(sandbox.0.join("large.pdf"), &expected).unwrap();
        let received = Arc::new(Mutex::new(Received::default()));
        let captured = received.clone();
        let channel = Channel::new(move |message| {
            let mut captured = captured.lock().unwrap();
            match message {
                InvokeResponseBody::Raw(frame) => {
                    let offset = u64::from_le_bytes(frame[..8].try_into().unwrap());
                    assert_eq!(offset as usize, captured.bytes.len());
                    captured.raw_lengths.push(frame.len());
                    captured.bytes.extend_from_slice(&frame[8..]);
                    ack_file_read("large-ack".into(), captured.bytes.len() as u64).unwrap();
                }
                InvokeResponseBody::Json(json) => {
                    captured.largest_json = captured.largest_json.max(json.len());
                    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
                    captured
                        .controls
                        .push(value["type"].as_str().unwrap().to_string());
                }
            }
            Ok(())
        });
        let result = read_file_stream(
            "large-ack".into(),
            FileReadTarget::Reading {
                path: sandbox.path("large.pdf"),
            },
            channel,
        )
        .await;
        assert!(result.is_ok(), "{result:?}");
        let received = received.lock().unwrap();
        assert_eq!(received.bytes, expected);
        assert_eq!(received.raw_lengths.len(), 41);
        assert!(received.raw_lengths.iter().all(|length| *length <= 262_152));
        assert!(received.largest_json < 4096);
        assert_eq!(received.controls, vec!["start", "end"]);
    });
}

#[test]
fn a_receiver_without_ack_is_bounded_to_one_window_then_times_out() {
    let _serial = STREAM_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.0.join("stalled.pdf"), vec![42u8; 2 * 1024 * 1024]).unwrap();
        let (channel, received) = channel(false);
        let result = read_with_limits(
            "no-ack".into(),
            FileReadTarget::Reading {
                path: sandbox.path("stalled.pdf"),
            },
            channel,
            Limits {
                total: std::time::Duration::from_secs(4),
                idle: std::time::Duration::from_secs(1),
            },
        )
        .await;
        assert!(result.is_err());
        let received = received.lock().unwrap();
        assert_eq!(received.bytes.len(), 1024 * 1024);
        assert_eq!(received.raw_lengths.len(), 4);
        assert_eq!(received.controls, vec!["start"]);
    });
}

#[test]
fn cancellation_before_registration_and_after_first_frame_never_completes() {
    let _serial = STREAM_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.0.join("cancel.pdf"), vec![42u8; 2 * 1024 * 1024]).unwrap();
        cancel_file_read("cancel-before".into()).unwrap();
        let (first_channel, first_received) = channel(false);
        let before = read_file_stream(
            "cancel-before".into(),
            FileReadTarget::Reading {
                path: sandbox.path("cancel.pdf"),
            },
            first_channel,
        )
        .await;
        assert!(before.is_err());
        assert!(first_received.lock().unwrap().controls.is_empty());
        let counts = Arc::new(Mutex::new((0, false)));
        let captured = counts.clone();
        let active_channel = Channel::new(move |message| {
            let mut captured = captured.lock().unwrap();
            match message {
                InvokeResponseBody::Raw(_) => {
                    captured.0 += 1;
                    assert!(ack_file_read("cancel-active".into(), u64::MAX).is_err());
                    cancel_file_read("cancel-active".into()).unwrap();
                }
                InvokeResponseBody::Json(json) => captured.1 |= json.contains("\"end\""),
            }
            Ok(())
        });
        let active = read_file_stream(
            "cancel-active".into(),
            FileReadTarget::Reading {
                path: sandbox.path("cancel.pdf"),
            },
            active_channel,
        )
        .await;
        assert!(active.is_err());
        assert_eq!(*counts.lock().unwrap(), (1, false));
    });
}

#[test]
fn only_four_native_transfers_are_admitted_and_cancellation_releases_them() {
    let _serial = STREAM_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        std::fs::write(sandbox.0.join("parallel.pdf"), vec![42u8; 2 * 1024 * 1024]).unwrap();
        let (started, mut starts) = tokio::sync::mpsc::unbounded_channel();
        let mut workers = Vec::new();
        for index in 0..4 {
            let started = started.clone();
            let native_channel = Channel::new(move |message| {
                if let InvokeResponseBody::Json(json) = message {
                    if json.contains("\"start\"") {
                        let _ = started.send(index);
                    }
                }
                Ok(())
            });
            workers.push(tauri::async_runtime::spawn(read_with_limits(
                format!("admission-{index}"),
                FileReadTarget::Reading {
                    path: sandbox.path("parallel.pdf"),
                },
                native_channel,
                Limits {
                    total: std::time::Duration::from_secs(10),
                    idle: std::time::Duration::from_secs(5),
                },
            )));
        }
        let mut started_count = 0;
        for _ in 0..4 {
            if matches!(
                tokio::time::timeout(std::time::Duration::from_secs(3), starts.recv()).await,
                Ok(Some(_))
            ) {
                started_count += 1;
            } else {
                break;
            }
        }
        let (fifth_channel, _) = channel(false);
        let fifth = read_file_stream(
            "admission-fifth".into(),
            FileReadTarget::Reading {
                path: sandbox.path("parallel.pdf"),
            },
            fifth_channel,
        )
        .await;
        // Always release and join our workers before asserting, including a failed admission setup.
        for index in 0..4 {
            let _ = cancel_file_read(format!("admission-{index}"));
        }
        let mut stopped_count = 0;
        for worker in workers {
            if matches!(
                tokio::time::timeout(std::time::Duration::from_secs(3), worker).await,
                Ok(Ok(Err(_)))
            ) {
                stopped_count += 1;
            }
        }
        assert_eq!(started_count, 4);
        assert!(fifth.is_err());
        assert_eq!(stopped_count, 4);
        let (last_channel, _) = channel(true);
        let last = read_file_stream(
            "admission-released".into(),
            FileReadTarget::Reading {
                path: sandbox.path("parallel.pdf"),
            },
            last_channel,
        )
        .await;
        assert!(
            last.unwrap_err().contains("通道已关闭"),
            "a released slot must admit the next reader"
        );
    });
}
