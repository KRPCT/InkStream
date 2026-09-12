use super::bbt_search_at;
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

fn search_reply(status: u16, body: serde_json::Value) -> Result<Vec<serde_json::Value>, String> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                Err(error) => panic!("fixture accept failed: {error}"),
            }
        };
        socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        socket.set_write_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut buffer = [0; 2048];
            let size = socket.read(&mut buffer).unwrap();
            assert!(size > 0, "request ended before its complete body");
            bytes.extend_from_slice(&buffer[..size]);
            assert!(bytes.len() < 16_384);
            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&bytes[..end]);
                let length: usize = head.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|value| value.trim().parse().unwrap())).unwrap();
                if bytes.len() >= end + 4 + length { break; }
            }
        }
        let request = String::from_utf8(bytes).unwrap();
        assert!(request.starts_with("POST /better-bibtex/json-rpc HTTP/1.1"));
        let payload: serde_json::Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(payload, json!({"jsonrpc":"2.0","method":"item.search","params":[""],"id":1}));
        let body = body.to_string();
        write!(socket, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
    });
    let result = tauri::async_runtime::block_on(bbt_search_at(&format!("http://{address}/better-bibtex/json-rpc")));
    server.join().unwrap();
    result
}

#[test]
fn bbt_failures_are_errors_so_the_caller_can_preserve_or_restore_its_library() {
    assert!(search_reply(503, json!({"result":[]})).is_err(), "HTTP failure must not be an empty library");
    assert!(search_reply(200, json!({"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Library unavailable"}})).is_err());
    for response in [json!({}), json!({"result":null}), json!({"result":{}}), json!({"result":[null]})] {
        assert!(search_reply(200, response).is_err(), "malformed results must not be an empty library");
    }
}

#[test]
fn a_valid_empty_library_is_distinct_from_failure_and_unicode_items_survive() {
    assert_eq!(search_reply(200, json!({"jsonrpc":"2.0","id":1,"result":[]})).unwrap(), Vec::<serde_json::Value>::new());
    let item = json!({"id":12,"type":"article-journal","citekey":"研究2026","title":"中文研究"});
    assert_eq!(search_reply(200, json!({"jsonrpc":"2.0","id":1,"result":[item.clone()]})).unwrap(), vec![item]);
}
