use super::{RemoteMode, RemoteOptions};

fn options(mode: RemoteMode, custom: &str) -> RemoteOptions {
    RemoteOptions { mode, custom_server: custom.to_string() }
}

#[test]
fn local_denies_named_and_explicit_targets() {
    let opts = options(RemoteMode::Local, "https://git.example.test/book.git");
    assert!(opts.for_remote("origin", &["git@github.com:owner/book.git".into()]).is_err());
    assert!(opts.for_clone("https://github.com/owner/book.git").is_err());
}

#[test]
fn ssh_never_requests_github_token_and_rejects_https() {
    let opts = options(RemoteMode::Ssh, "");
    for url in ["git@github.com:owner/book.git", "ssh://git@git.example.test:2222/owner/book.git", "my-host:book.git"] {
        let target = opts.for_url(url).unwrap();
        assert_eq!(target.protocol, "ssh");
        assert!(!target.github_auth);
    }
    assert!(opts.for_url("https://github.com/owner/book.git").is_err());
}

#[test]
fn github_mode_checks_host_scheme_port_and_userinfo() {
    let opts = options(RemoteMode::Oauth, "");
    assert!(opts.for_url("https://GITHUB.com:443/owner/book.git").unwrap().github_auth);
    for url in [
        "https://github.com.example.test/owner/book.git",
        "https://github.com@evil.example.test/owner/book.git",
        "https://github.com:8443/owner/book.git",
        "http://github.com/owner/book.git",
        "git@github.com:owner/book.git",
        "https://password@github.com/owner/book.git",
    ] {
        assert!(opts.for_url(url).is_err(), "accepted {url}");
    }
}

#[test]
fn all_push_urls_must_match_the_selected_policy() {
    let opts = options(RemoteMode::Oauth, "");
    let urls = vec!["https://github.com/owner/book.git".into(), "https://other.example.test/book.git".into()];
    assert!(opts.for_remote("origin", &urls).is_err());
}

#[test]
fn custom_target_overrides_named_remote_without_github_credentials() {
    let url = "https://git.example.test/team/book.git";
    let opts = options(RemoteMode::Custom, url);
    let target = opts.for_remote("origin", &["https://github.com/other/repo.git".into()]).unwrap();
    assert_eq!(target.argument, url);
    assert!(!target.github_auth);
    assert!(opts.for_clone("https://github.com/other/repo.git").is_err());
    assert_eq!(opts.for_clone(url).unwrap().argument, url);
}

#[test]
fn invalid_custom_target_does_not_fall_back_to_origin() {
    for url in ["", "git.example.test", "C:/book", "https://git.example.test/", "http://git.example.test/book.git", "https://user:secret@git.example.test/book.git", "ext::command", "https://git.example.test/book.git?token=secret"] {
        let opts = options(RemoteMode::Custom, url);
        assert!(opts.for_remote("origin", &["git@github.com:owner/book.git".into()]).is_err(), "accepted {url}");
    }
}
