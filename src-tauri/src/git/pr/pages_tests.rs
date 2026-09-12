use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Instant;

fn server(responses: Vec<(u16, String, String)>) -> (String, mpsc::Receiver<String>, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let (send, receive) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        for (status, headers, body) in responses {
            let deadline = Instant::now() + Duration::from_secs(4);
            let mut stream = loop { match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                Err(error) => panic!("fixture accept: {error}"),
            } };
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            stream.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut request = Vec::new(); let mut buffer = [0; 4096];
            loop { let count = stream.read(&mut buffer).unwrap(); request.extend_from_slice(&buffer[..count]);
                if count == 0 || request.windows(4).any(|part| part == b"\r\n\r\n") { break; }
                assert!(request.len() < 100_000);
            }
            send.send(String::from_utf8(request).unwrap()).unwrap();
            let _ = write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len());
        }
    });
    (address, receive, handle)
}
fn pull(head: &str) -> String {
    serde_json::json!({ "number":7, "title":"fixture", "body":"", "state":"open", "draft":false,
        "html_url":"https://github.com/fixture/book/pull/7", "user":{"login":"fixture"},
        "head":{"ref":"topic","sha":head}, "base":{"ref":"main","sha":"base"}, "changed_files":3001 }).to_string()
}

#[test]
fn subsequent_pages_use_the_owned_endpoint_and_preserve_next_even_when_items_are_filtered() {
    let (base, requests, worker) = server(vec![
        (200, "Link: <https://evil.example.test/steal>; rel=\"next\"\r\n".into(), "[]".into()),
        (200, String::new(), "[{\"id\":101}]".into()),
    ]);
    tauri::async_runtime::block_on(async {
        let client = client().unwrap();
        let first: Page<serde_json::Value> = page(&client, &format!("{base}/issues?state=open"), "fixture-only", 10, 10).await.unwrap();
        assert_eq!(first.next_page, Some(11));
        let next: Page<serde_json::Value> = page(&client, &format!("{base}/issues?state=open"), "fixture-only", first.next_page.unwrap(), 10).await.unwrap();
        assert_eq!(next.items[0]["id"], 101); assert_eq!(next.next_page, None);
    });
    assert!(requests.recv_timeout(Duration::from_secs(2)).unwrap().starts_with("GET /issues?state=open&per_page=10&page=10 "));
    assert!(requests.recv_timeout(Duration::from_secs(2)).unwrap().starts_with("GET /issues?state=open&per_page=10&page=11 "));
    worker.join().unwrap();
}

#[test]
fn patch_absence_truncation_and_budget_are_not_classified_as_binary() {
    let make = |patch: Option<&str>| file(GhPrFile { filename: "paper.md".into(), status: "modified".into(), patch: patch.map(str::to_owned), previous_filename: None });
    assert_eq!(make(None).patch_status, "unavailable");
    assert_eq!(make(Some("@@ -1,2 +1,2 @@\n-old\n+new\n")).patch_status, "incomplete");
    let complete = make(Some("@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n"));
    assert_eq!(complete.patch_status, "available"); assert_eq!(complete.hunks.len(), 1);
    let oversized = "x".repeat(65_537);
    assert_eq!(make(Some(&oversized)).patch_status, "overBudget");
    assert!(make(None).hunks.is_empty());
}

#[test]
fn pr_diff_rejects_mixed_head_versions_and_keeps_api_limit_explicit() {
    let files = r#"[{"filename":"paper.md","status":"modified","patch":null}]"#;
    let (base, _requests, worker) = server(vec![
        (200, String::new(), pull("old")), (200, String::new(), files.into()), (200, String::new(), pull("new")),
        (200, String::new(), pull("new")), (200, String::new(), files.into()), (200, String::new(), pull("new")),
    ]);
    tauri::async_runtime::block_on(async {
        let client = client().unwrap(); let endpoint = format!("{base}/pulls/7");
        let stale = diff_page(&client, &endpoint, "fixture", 1, Some("old"), Some("base")).await.unwrap_err();
        assert!(stale.contains("PR 已更新"));
        let fresh = diff_page(&client, &endpoint, "fixture", 1, Some("new"), Some("base")).await.unwrap();
        assert!(fresh.limited); assert_eq!(fresh.head_oid, "new"); assert_eq!(fresh.items[0].patch_status, "unavailable");
    });
    worker.join().unwrap();
}

#[test]
fn http_error_and_oversized_body_fail_without_returning_partial_items() {
    let (base, _requests, worker) = server(vec![(403, String::new(), r#"{"message":"permission denied"}"#.into()), (200, String::new(), "[1234567890]".into())]);
    tauri::async_runtime::block_on(async {
        let client = client().unwrap();
        let response = client.get(&base).send().await.unwrap();
        assert!(read::<serde_json::Value>(response).await.unwrap_err().contains("permission denied"));
        let response = client.get(&base).send().await.unwrap();
        assert!(super::super::http::read_with_limit::<serde_json::Value>(response, 8).await.unwrap_err().contains("预算"));
    });
    worker.join().unwrap();
}

#[test]
fn stalled_http_response_has_a_total_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop { match listener.accept() {
            Ok((_stream, _)) => { std::thread::sleep(Duration::from_millis(150)); break; },
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(2)),
            Err(error) => panic!("fixture accept: {error}"),
        } }
    });
    tauri::async_runtime::block_on(async {
        let client = super::super::http::client_with_timeout(Duration::from_millis(50)).unwrap();
        assert!(client.get(url).send().await.unwrap_err().is_timeout());
    });
    worker.join().unwrap();
}

#[test]
fn local_full_pr_comparison_uses_common_ancestor_and_never_changes_head_or_files() {
    let root = std::env::temp_dir().join(format!("inkstream-pr-base-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&root).unwrap();
    let repo = git2::Repository::init(&root).unwrap();
    let tree_id = repo.treebuilder(None).unwrap().write().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let signature = git2::Signature::now("fixture", "fixture@example.test").unwrap();
    let common = repo.commit(None, &signature, &signature, "common", &tree, &[]).unwrap();
    let parent = repo.find_commit(common).unwrap();
    let base = repo.commit(None, &signature, &signature, "base advanced", &tree, &[&parent]).unwrap();
    let head = repo.commit(None, &signature, &signature, "PR head", &tree, &[&parent]).unwrap();
    repo.reference("refs/heads/main", base, true, "fixture").unwrap(); repo.set_head("refs/heads/main").unwrap();
    std::fs::write(root.join("draft.md"), "未提交正文").unwrap();
    let actual = tauri::async_runtime::block_on(gh_pr_local_base(root.to_string_lossy().into_owned(), base.to_string(), head.to_string())).unwrap();
    assert_eq!(actual, common.to_string());
    assert_eq!(repo.head().unwrap().target(), Some(base));
    assert_eq!(std::fs::read_to_string(root.join("draft.md")).unwrap(), "未提交正文");
    drop(parent); drop(tree); drop(repo); std::fs::remove_dir_all(&root).unwrap();
}
