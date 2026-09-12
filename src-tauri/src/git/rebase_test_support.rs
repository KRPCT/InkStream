use super::{rebase::{execute, git_executable, local_spec, RebaseAction, RebaseResult}, rebase_process::{run_process, ProcessSpec}, rebase_registry};
use git2::{Oid, Repository, Signature};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

pub(crate) struct Fixture { pub root: PathBuf, pub signer: PathBuf }
pub(super) fn git_path(path: &Path) -> String {
    let slash = path.to_string_lossy().replace('\\', "/");
    if let Some(unc) = slash.strip_prefix("//?/UNC/") { format!("//{unc}") }
    else { slash.strip_prefix("//?/").unwrap_or(&slash).to_string() }
}
impl Fixture {
    pub fn new(tag: &str) -> Self {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("inkstream-rebase-{tag}-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let repo = Repository::init(&root).unwrap();
        repo.set_head("refs/heads/topic").unwrap();
        let hooks = repo.path().join("fixture-hooks");
        std::fs::create_dir(&hooks).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Rebase Fixture").unwrap();
        config.set_str("user.email", "fixture@example.invalid").unwrap();
        config.set_bool("core.autocrlf", false).unwrap();
        config.set_bool("commit.gpgsign", false).unwrap();
        config.set_str("core.hooksPath", &git_path(&hooks)).unwrap();
        config.set_i64("gc.auto", 0).unwrap();
        let git = git_executable().unwrap();
        let filename = if cfg!(windows) { "ssh-keygen.exe" } else { "ssh-keygen" };
        let mut candidates = vec![git.parent().unwrap().join("../usr/bin").join(filename), git.parent().unwrap().join("../../usr/bin").join(filename)];
        if let Some(path) = std::env::var_os("PATH") { candidates.extend(std::env::split_paths(&path).filter(|p| p.is_absolute()).map(|p| p.join(filename))); }
        let signer = candidates.into_iter().find(|p| p.is_file()).expect("fixture requires the installed Git/OpenSSH signer").canonicalize().unwrap();
        Self { root, signer }
    }
    pub fn repo(&self) -> Repository { Repository::open(&self.root).unwrap() }
    pub fn path(&self) -> String { self.root.to_string_lossy().into_owned() }
    pub fn commit(&self, path: &str, content: &str, message: &str) -> Oid {
        std::fs::write(self.root.join(path), content).unwrap();
        let repo = self.repo();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(path)).unwrap(); index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let signature = Signature::now("Author", "author@example.invalid").unwrap();
        let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
        repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &parent.iter().collect::<Vec<_>>()).unwrap()
    }
    pub fn checkout(&self, name: &str) {
        let repo = self.repo();
        repo.set_head(&format!("refs/heads/{name}")).unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force())).unwrap();
    }
    pub fn divergent(&self, conflict: bool, later: bool) -> Oid {
        let base = self.commit("note.md", "共同稿\n", "base");
        let repo = self.repo();
        repo.branch("upstream", &repo.find_commit(base).unwrap(), false).unwrap();
        let mut original = self.commit("note.md", "主题稿\n", "topic change");
        if later { original = self.commit("later.md", "后续独立内容\n", "later change"); }
        self.checkout("upstream");
        if conflict { self.commit("note.md", "基线稿\n", "upstream change"); }
        else { self.commit("upstream.md", "基线新增\n", "upstream addition"); }
        self.checkout("topic");
        original
    }
    pub fn enable_signing(&self) {
        let private_key = self.root.join(".git/fixture-signing-key");
        let spec = ProcessSpec {
            program: self.signer.clone(), cwd: self.root.clone(),
            args: ["-q", "-t", "ed25519", "-N", "", "-C", "fixture@example.invalid", "-f"].map(std::ffi::OsString::from).into_iter().chain([std::ffi::OsString::from(git_path(&private_key))]).collect(),
            env_remove: vec![], env_set: vec![],
        };
        let generated = run_process(&spec, &AtomicBool::new(false), Duration::from_secs(10)).unwrap();
        assert_eq!(generated.exit_code, Some(0), "{}", generated.stderr);
        let allowed = self.root.join(".git/fixture-allowed-signers");
        std::fs::write(&allowed, format!("fixture@example.invalid {}", std::fs::read_to_string(private_key.with_extension("pub")).unwrap())).unwrap();
        let repo = self.repo();
        let mut config = repo.config().unwrap();
        config.set_str("gpg.format", "ssh").unwrap();
        config.set_str("gpg.ssh.program", &git_path(&self.signer)).unwrap();
        config.set_str("gpg.ssh.allowedSignersFile", &git_path(&allowed)).unwrap();
        config.set_str("user.signingkey", &git_path(&private_key)).unwrap();
    }
    pub fn git(&self, args: &[&str]) -> super::rebase_process::ProcessOutput {
        let spec = local_spec(&self.repo(), args.iter().map(|argument| std::ffi::OsString::from(*argument)).collect()).unwrap();
        run_process(&spec, &AtomicBool::new(false), Duration::from_secs(15)).unwrap()
    }
    pub fn action(&self, action: RebaseAction) -> RebaseResult { execute(&self.path(), rebase_registry::request_id(), action).unwrap() }
    pub fn head(&self) -> Oid { self.repo().head().unwrap().target().unwrap() }
    pub fn body(&self, path: &str) -> String { std::fs::read_to_string(self.root.join(path)).unwrap() }
    pub fn resolve(&self, content: &str) {
        let expected = self.body("note.md");
        tauri::async_runtime::block_on(super::conflict::git_resolve_conflict(self.path(), "note.md".into(), content.into(), Some(expected))).unwrap();
    }
    pub fn verify_signed(&self) {
        let output = self.git(&["verify-commit", "HEAD"]);
        assert_eq!(output.exit_code, Some(0), "{}", output.stderr);
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.root); } }
