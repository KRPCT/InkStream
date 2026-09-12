use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Instant;

fn comment(id: u64, parent: Option<u64>) -> serde_json::Value {
    serde_json::json!({ "id": id, "in_reply_to_id": parent, "body": "实际回复", "user": {"login":"fixture"},
        "path":"paper.md", "line":null, "original_line":4, "diff_hunk":"@@ -1 +1 @@", "created_at":"2026-09-11T00:00:00Z", "html_url":"https://github.com/o/r/pull/7#discussion_r10" })
}

fn server(responses: Vec<(u16, String)>) -> (String, mpsc::Receiver<String>, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let (send, receive) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        for (status, body) in responses {
            let deadline = Instant::now() + Duration::from_secs(4);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                    Err(error) => panic!("fixture accept: {error}"),
                }
            };
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            stream.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 { break; }
                request.extend_from_slice(&buffer[..count]);
                if let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let length = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").and_then(|value| value.trim().parse::<usize>().ok())).unwrap_or(0);
                    if request.len() >= header_end + 4 + length { break; }
                }
                assert!(request.len() < 100_000);
            }
            send.send(String::from_utf8(request).unwrap()).unwrap();
            write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
    });
    (address, receive, handle)
}

#[test]
fn inline_reply_uses_the_selected_pr_and_root_comment_endpoint() {
    let (base, requests, server) = server(vec![(201, comment(11, Some(10)).to_string())]);
    let result = tauri::async_runtime::block_on(reply(&client().unwrap(), &format!("{base}/repos/o/r/pulls/7/comments/10/replies"), "fixture-token", "正文 **保留**")).unwrap();
    let request = requests.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(request.starts_with("POST /repos/o/r/pulls/7/comments/10/replies HTTP/1.1"));
    assert!(request.to_ascii_lowercase().contains("authorization: bearer fixture-token"));
    let body: serde_json::Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body, serde_json::json!({"body":"正文 **保留**"}));
    assert_eq!(result.in_reply_to_id, Some(10));
    assert_eq!(result.original_line, Some(4));
    server.join().unwrap();
}

#[test]
fn pagination_keeps_parent_relationships_and_permission_errors_are_explicit() {
    let first: Vec<_> = (1..=100).map(|id| comment(id, None)).collect();
    let (base, requests, server) = server(vec![(200, serde_json::to_string(&first).unwrap()), (200, serde_json::json!([comment(101, Some(1))]).to_string()), (403, r#"{"message":"permission denied"}"#.into())]);
    let endpoint = format!("{base}/repos/o/r/pulls/7/comments");
    let result = tauri::async_runtime::block_on(list(&client().unwrap(), &endpoint, "fixture-token")).unwrap();
    assert_eq!(result.len(), 101);
    assert_eq!(result[100].in_reply_to_id, Some(1));
    assert!(requests.recv_timeout(Duration::from_secs(3)).unwrap().contains("page=1&"));
    assert!(requests.recv_timeout(Duration::from_secs(3)).unwrap().contains("page=2&"));
    let error = tauri::async_runtime::block_on(reply(&client().unwrap(), &endpoint, "fixture-token", "body")).unwrap_err();
    assert!(error.contains("403") && error.contains("permission denied"));
    server.join().unwrap();
}

#[test]
fn invalid_reply_does_not_open_a_repository_or_request_credentials() {
    assert!(tauri::async_runtime::block_on(gh_pr_reply("missing".into(), 7, 10, " ".into())).unwrap_err().contains("不能为空"));
    assert!(tauri::async_runtime::block_on(gh_pr_reply("missing".into(), 0, 10, "body".into())).unwrap_err().contains("编号无效"));
}
