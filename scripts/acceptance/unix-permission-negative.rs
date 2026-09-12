// Isolated reproduction of the former File::create -> sync -> rename strategy.
// This is NOT an old InkStream binary and does not replace the production Rust tests.
// Only freshly created temporary files are touched; ordinary application data is never opened.
#[cfg(unix)]
fn probe() -> Result<bool, Box<dyn std::error::Error>> {
    use std::fs::{self, File};
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    let base = PathBuf::from(std::env::args_os().nth(1).ok_or("missing owned scratch directory")?).canonicalize()?;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
    let directory = base.join(format!("inkstream-mode-negative-{}-{nonce}", std::process::id()));
    fs::create_dir(&directory)?;
    let scratch = Scratch(directory);
    let mut violated = false;

    for (name, expected_mode) in [("private.md", 0o600), ("run.sh", 0o751)] {
        let target = scratch.0.join(name);
        let temporary = scratch.0.join(format!(".legacy-temp-{name}"));
        fs::write(&target, b"original")?;
        fs::set_permissions(&target, fs::Permissions::from_mode(expected_mode))?;

        // Former successful-write strategy, intentionally without mode preservation.
        let mut file = File::create(&temporary)?;
        file.write_all(b"updated")?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, &target)?;
        if let Ok(parent) = File::open(&scratch.0) { let _ = parent.sync_all(); }

        if fs::read(&target)? != b"updated" { return Err("content write did not complete".into()); }
        let actual_mode = fs::metadata(&target)?.permissions().mode() & 0o7777;
        let preserved = actual_mode == expected_mode;
        println!("{{\"case\":\"{name}\",\"expectedMode\":\"{expected_mode:04o}\",\"actualMode\":\"{actual_mode:04o}\",\"permissionAssertionPassed\":{preserved}}}");
        violated |= !preserved;
    }
    // Scratch drops before main chooses its expected-negative exit status.
    Ok(violated)
}

#[cfg(unix)]
fn main() {
    match probe() {
        Ok(true) => {
            println!("NEGATIVE_CONTROL_CONFIRMED: legacy replacement violated permission preservation");
            std::process::exit(42);
        }
        Ok(false) => {
            eprintln!("No permission violation observed; this negative control is inconclusive");
            std::process::exit(0);
        }
        Err(error) => {
            eprintln!("Fixture setup/execution failed: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(unix))]
fn main() {
    eprintln!("Unix-only fixture; Windows exclusion is not permission verification");
    std::process::exit(64);
}
