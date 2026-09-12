use super::{client, repo_target, with_headers};
use std::path::PathBuf;

struct Fixture {
    path: PathBuf,
}

impl Fixture {
    fn new(origin: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("inkstream-gh-scope-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        let repo = git2::Repository::init(&path).unwrap();
        repo.remote("origin", origin).unwrap();
        drop(repo);
        Self { path }
    }

    fn root(&self) -> &str {
        self.path.to_str().unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Only this test-created unique directory; no user repository/config is modified.
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn non_github_origin_is_rejected_before_a_token_can_be_assigned() {
    for origin in [
        "https://git.example.test/team/book.git",
        "https://github.com.example.test/team/book.git",
        "https://github.com@evil.example.test/team/book.git",
        "git@git.example.test:team/book.git",
    ] {
        let fixture = Fixture::new(origin);
        assert!(repo_target(fixture.root()).is_err(), "accepted foreign origin: {origin}");
    }
}

#[test]
fn github_origins_build_requests_only_for_github_with_synthetic_credentials() {
    for origin in [
        "https://github.com/team/book.git",
        "git@github.com:team/book.git",
        "ssh://git@github.com/team/book.git",
    ] {
        let fixture = Fixture::new(origin);
        let (api, owner, repo) = repo_target(fixture.root()).unwrap();
        let request = with_headers(
            client().unwrap().get(format!("{api}/repos/{owner}/{repo}/pulls")),
            "fixture-only-not-a-real-token",
        ).build().unwrap();
        assert_eq!(request.url().as_str(), "https://api.github.com/repos/team/book/pulls");
        assert_eq!(request.headers().get("authorization").unwrap(), "Bearer fixture-only-not-a-real-token");
    }
}
