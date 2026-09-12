//! Real filesystem regression for MSIX/DOS target aliases, without changing process CWD.
use std::fs;
use std::path::{Path, PathBuf};

struct Probe(PathBuf);
impl Probe {
    fn new(parent: &Path) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = parent.join(format!(
            "inkstream-atomic-probe-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Probe {
    fn drop(&mut self) {
        // Remove only our known files, including after an assertion fails. Keep unknown data.
        for name in [
            "manifest.json",
            "staging/body.txt",
            "published/body.txt",
            "another/different.txt",
        ] {
            let path = self.0.join(name);
            if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_file()) {
                let _ = fs::remove_file(path);
            }
        }
        for name in ["staging", "published", "another"] {
            let path = self.0.join(name);
            if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_dir()) {
                let _ = fs::remove_dir(path);
            }
        }
        let _ = fs::remove_dir(&self.0);
    }
}
fn exercise(parent: &Path) {
    let probe = Probe::new(parent); // Keep the supplied DOS spelling, without canonicalize.
    let target = probe.0.join("manifest.json");
    super::write_atomic(&target, "第一份完整正文🙂\n").unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "第一份完整正文🙂\n");
    super::write_atomic(&target, "第二份完整正文\r\n").unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "第二份完整正文\r\n");
    assert!(!fs::read_dir(&probe.0).unwrap().flatten().any(|entry| entry
        .file_name()
        .to_string_lossy()
        .starts_with(".inkstream-tmp-")));
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&target)
            .unwrap();
        assert!(super::write_atomic(&target, "must not overwrite a locked target").is_err());
        drop(held);
        assert_eq!(fs::read_to_string(&target).unwrap(), "第二份完整正文\r\n");
        assert!(!fs::read_dir(&probe.0).unwrap().flatten().any(|entry| entry
            .file_name()
            .to_string_lossy()
            .starts_with(".inkstream-tmp-")));
    }
    let staging = probe.0.join("staging");
    fs::create_dir(&staging).unwrap();
    fs::write(staging.join("body.txt"), b"complete version").unwrap();
    let published = probe.0.join("published");
    super::exclusive_move::rename_new(&staging, &published).unwrap();
    assert!(!staging.exists());
    assert_eq!(
        fs::read(published.join("body.txt")).unwrap(),
        b"complete version"
    );
    let another = probe.0.join("another");
    fs::create_dir(&another).unwrap();
    fs::write(another.join("different.txt"), b"preserve source").unwrap();
    assert!(super::exclusive_move::rename_new(&another, &published).is_err());
    assert_eq!(
        fs::read(published.join("body.txt")).unwrap(),
        b"complete version"
    );
    assert_eq!(
        fs::read(another.join("different.txt")).unwrap(),
        b"preserve source"
    );
    fs::remove_file(published.join("body.txt")).unwrap();
    fs::remove_dir(published).unwrap();
    fs::remove_file(another.join("different.txt")).unwrap();
    fs::remove_dir(another).unwrap();
}

#[test]
fn atomic_file_and_version_publication_accept_a_noncanonical_temporary_root() {
    exercise(&std::env::temp_dir());
}

#[cfg(windows)]
#[test]
#[ignore = "explicit acceptance probe: requires the owned redirected profile on another DOS drive"]
fn atomic_publish_into_redirected_profile_from_another_drive() {
    use std::path::{Component, Prefix};
    fn drive(path: &Path) -> u8 {
        match path.components().next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive.to_ascii_uppercase(),
                _ => panic!("probe requires a drive-letter path"),
            },
            _ => panic!("probe requires an absolute drive-letter path"),
        }
    }
    let root = PathBuf::from(
        std::env::var_os("INKSTREAM_ATOMIC_WRITE_PROBE_ROOT")
            .expect("set owned profile projects directory"),
    );
    assert!(root.is_absolute());
    assert_eq!(root.file_name().unwrap(), "projects");
    let profile = root.parent().unwrap();
    assert_eq!(
        profile.file_name().unwrap(),
        "com.krpct.inkstream.originalcheck20260912"
    );
    let owner: serde_json::Value =
        serde_json::from_slice(&fs::read(profile.join(".original-native-owner.json")).unwrap())
            .unwrap();
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    assert_eq!(
        Path::new(owner["workspace"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        workspace.canonicalize().unwrap()
    );
    let cwd = std::env::current_dir().unwrap();
    assert_ne!(
        drive(&root),
        drive(&cwd),
        "acceptance must actually use another DOS drive"
    );
    eprintln!(
        "atomic publication cwd={cwd:?}, supplied={root:?}, physical={:?}",
        root.canonicalize().unwrap()
    );
    exercise(&root);
}
