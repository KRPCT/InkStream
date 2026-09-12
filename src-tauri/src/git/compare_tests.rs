use super::{compare_files, read_blob};
use git2::{Oid, Repository, Signature};
use std::path::{Path, PathBuf};

struct Fixture { root: PathBuf, repo: Repository }
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("inkstream-compare-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        let repo = Repository::init(&root).unwrap();
        Self { root, repo }
    }
    fn commit(&self, files: &[(&str, &[u8])]) -> Oid {
        // Build a commit directly from blob/tree objects. Worktree and index stay untouched.
        let mut tree = self.repo.treebuilder(None).unwrap();
        for (name, bytes) in files { tree.insert(*name, self.repo.blob(bytes).unwrap(), 0o100644).unwrap(); }
        let tree = self.repo.find_tree(tree.write().unwrap()).unwrap();
        let sig = Signature::now("Comparison Fixture", "compare@example.test").unwrap();
        self.repo.commit(None, &sig, &sig, "snapshot", &tree, &[]).unwrap()
    }
    fn root(&self) -> String { self.root.to_string_lossy().into_owned() }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.root); } }

#[test]
fn complete_blob_text_is_pinned_even_after_branch_and_worktree_change() {
    let f = Fixture::new();
    let old_text = "开头。\r\n\r\n正文原句。\n末尾。";
    let new_text = "开头。\r\n\r\n正文新句。\n末尾。";
    let old = f.commit(&[("正文.md", old_text.as_bytes())]);
    let new = f.commit(&[("正文.md", new_text.as_bytes())]);
    let page = compare_files(&f.repo, &old.to_string(), &new.to_string(), 0, 100, None).unwrap();
    f.repo.reference("refs/heads/draft", new, true, "fixture").unwrap();
    f.repo.reference("refs/heads/draft", old, true, "moved").unwrap();
    std::fs::write(f.root.join("正文.md"), "用户未提交内容").unwrap();
    let side = page.files[0].new.as_ref().unwrap();
    assert_eq!(read_blob(&f.root(), &side.commit_oid, &side.path, &side.blob_oid).unwrap(), new_text.as_bytes());
    assert_eq!(std::fs::read_to_string(f.root.join("正文.md")).unwrap(), "用户未提交内容");
    assert!(f.repo.index().unwrap().is_empty());
    assert_eq!(f.repo.find_reference("refs/heads/draft").unwrap().target(), Some(old));
}

#[test]
fn changes_include_add_delete_rename_reverse_and_empty_results() {
    let f = Fixture::new();
    let old = f.commit(&[("旧名.md", b"same body"), ("delete.md", b"removed"), ("unchanged.md", b"unchanged")]);
    let new = f.commit(&[("新名.md", b"same body"), ("add.md", b"added"), ("unchanged.md", b"unchanged")]);
    let page = compare_files(&f.repo, &old.to_string(), &new.to_string(), 0, 100, None).unwrap();
    assert_eq!(page.total, 3);
    let renamed = page.files.iter().find(|file| file.status == "renamed").unwrap();
    assert_eq!(renamed.old.as_ref().unwrap().path, "旧名.md");
    assert_eq!(renamed.new.as_ref().unwrap().path, "新名.md");
    assert!(page.files.iter().any(|file| file.status == "added" && file.old.is_none()));
    assert!(page.files.iter().any(|file| file.status == "deleted" && file.new.is_none()));
    let reverse = compare_files(&f.repo, &new.to_string(), &old.to_string(), 0, 100, None).unwrap();
    assert!(reverse.files.iter().any(|file| file.status == "deleted" && file.old.as_ref().unwrap().path == "add.md"));
    assert_eq!(compare_files(&f.repo, &old.to_string(), &old.to_string(), 0, 100, None).unwrap().total, 0);
    let unchanged = compare_files(&f.repo, &old.to_string(), &new.to_string(), 0, 100, Some("unchanged.md")).unwrap();
    assert_eq!(unchanged.files[0].status, "unchanged");
}

#[test]
fn metadata_pages_do_not_drop_files_or_return_body_text() {
    let f = Fixture::new();
    let names: Vec<String> = (0..105).map(|i| format!("file-{i:03}.md")).collect();
    let files: Vec<(&str, &[u8])> = names.iter().map(|name| (name.as_str(), b"secret body text".as_slice())).collect();
    let old = f.commit(&[]);
    let new = f.commit(&files);
    let first = compare_files(&f.repo, &old.to_string(), &new.to_string(), 0, 100, None).unwrap();
    let last = compare_files(&f.repo, &old.to_string(), &new.to_string(), first.next.unwrap(), 100, None).unwrap();
    assert_eq!(first.total, 105);
    assert_eq!(first.files.len(), 100);
    assert_eq!(last.files.len(), 5);
    assert_eq!(last.next, None);
    assert!(!serde_json::to_string(&first).unwrap().contains("secret body text"));
    assert!(compare_files(&f.repo, "HEAD", &new.to_string(), 0, 100, None).is_err());
    assert!(compare_files(&f.repo, &old.to_string(), &new.to_string(), 0, 101, None).is_err());
}

#[test]
fn blob_reads_reject_wrong_identity_paths_and_binary_without_altering_index() {
    let f = Fixture::new();
    let oid = f.commit(&[("text.md", b"full text"), ("binary.md", b"zero\0byte"), ("invalid.md", &[255, 254])]);
    let tree = f.repo.find_commit(oid).unwrap().tree().unwrap();
    let text = tree.get_path(Path::new("text.md")).unwrap().id().to_string();
    assert!(read_blob(&f.root(), &oid.to_string(), "../text.md", &text).is_err());
    assert!(read_blob(&f.root(), &oid.to_string(), "text.md", &oid.to_string()).is_err());
    for name in ["binary.md", "invalid.md"] {
        let id = tree.get_path(Path::new(name)).unwrap().id().to_string();
        assert!(read_blob(&f.root(), &oid.to_string(), name, &id).is_err());
    }
    assert!(f.repo.index().unwrap().is_empty());
}
