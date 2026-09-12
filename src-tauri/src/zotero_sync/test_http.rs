use serde_json::Value;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub struct Reply {
    pub status: u16,
    pub version: i64,
    pub total: usize,
    pub body: Value,
    item_response: bool,
}

impl Reply {
    pub fn items(version: i64, total: usize, items: Vec<Value>) -> Self {
        let envelopes = items
            .into_iter()
            .map(|csl| {
                serde_json::json!({
                    "key": csl["id"], "version": version,
                    "data": { "citationKey": csl["citation-key"] }, "csljson": csl,
                })
            })
            .collect();
        Self::library_items(version, total, envelopes)
    }

    pub fn library_items(version: i64, total: usize, items: Vec<Value>) -> Self {
        Self {
            status: 200,
            version,
            total,
            body: Value::Array(items),
            item_response: true,
        }
    }

    pub fn deleted(version: i64, keys: &[&str]) -> Self {
        Self {
            status: 200,
            version,
            total: 0,
            body: serde_json::json!({ "items": keys }),
            item_response: false,
        }
    }

    pub fn failure() -> Self {
        Self {
            status: 503,
            version: 0,
            total: 0,
            body: serde_json::json!({ "error": "fixture unavailable" }),
            item_response: false,
        }
    }
}

/// Loopback-only scripted Zotero API. No credentials or traffic leave this process's host.
/// Each socket has a one-second deadline; the listener has a ten-second lifetime and joins on drop.
pub struct Api {
    pub base: String,
    requests: Arc<Mutex<Vec<String>>>,
    diagnostics: Arc<Mutex<Vec<String>>>,
    stopped: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Api {
    pub fn new(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let captured = requests.clone();
        let events = diagnostics.clone();
        let stop = stopped.clone();
        let worker = thread::spawn(move || {
            let mut replies: VecDeque<_> = replies.into();
            let deadline = Instant::now() + Duration::from_secs(10);
            while !stop.load(Ordering::Acquire) && Instant::now() < deadline {
                let (mut socket, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => {
                        events
                            .lock()
                            .unwrap()
                            .push(format!("accept failed: {error:?}"));
                        break;
                    }
                };
                // On Windows accept() inherits the listener's nonblocking mode.
                // Timeouts do not change that mode: an early read would otherwise return
                // WouldBlock and consume a scripted reply before any HTTP headers arrive.
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                socket
                    .set_write_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut request = Vec::new();
                let mut chunk = [0u8; 1024];
                while request.len() < 16_384 && !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match socket.read(&mut chunk) {
                        Ok(0) => {
                            events
                                .lock()
                                .unwrap()
                                .push(format!("request EOF after {} bytes", request.len()));
                            break;
                        }
                        Err(error) => {
                            events.lock().unwrap().push(format!(
                                "request read failed after {} bytes: {error:?}",
                                request.len()
                            ));
                            break;
                        }
                        Ok(count) => request.extend_from_slice(&chunk[..count]),
                    }
                }
                if !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    events.lock().unwrap().push(format!(
                        "incomplete HTTP headers after {} bytes; reply preserved",
                        request.len()
                    ));
                    continue;
                }
                let first = String::from_utf8_lossy(&request)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .to_owned();
                let csl_export = first.contains("format=csljson");
                captured.lock().unwrap().push(first);
                let reply = replies.pop_front().unwrap_or_else(Reply::failure);
                // Respond in the requested official format. Export IDs need not be Zotero item keys.
                let body = if reply.item_response && csl_export {
                    let items: Vec<_> = reply
                        .body
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|item| item["csljson"].clone())
                        .collect();
                    serde_json::json!({ "items": items }).to_string()
                } else {
                    reply.body.to_string()
                };
                let response = format!(
                    "HTTP/1.1 {} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nLast-Modified-Version: {}\r\nTotal-Results: {}\r\nConnection: close\r\n\r\n{}",
                    reply.status, body.len(), reply.version, reply.total, body,
                );
                if let Err(error) = socket.write_all(response.as_bytes()) {
                    events
                        .lock()
                        .unwrap()
                        .push(format!("response write failed: {error:?}"));
                }
            }
        });
        Self {
            base,
            requests,
            diagnostics,
            stopped,
            worker: Some(worker),
        }
    }

    pub fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }

    pub fn diagnostics(&self) -> Vec<String> {
        self.diagnostics.lock().unwrap().clone()
    }
}

#[test]
fn accepted_connection_waits_for_the_complete_request_before_consuming_a_reply() {
    let api = Api::new(vec![Reply::deleted(7, &[])]);
    let mut stream = std::net::TcpStream::connect(api.base.trim_start_matches("http://")).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    // A connected client may be scheduled later than accept(). It has not sent an HTTP request yet.
    thread::sleep(Duration::from_millis(50));
    let requests_before_headers = api.requests();
    let write =
        stream.write_all(b"GET /fixture HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut response = String::new();
    let read = stream.read_to_string(&mut response);
    assert!(requests_before_headers.is_empty(), "fixture consumed a response before headers: requests={requests_before_headers:?}; diagnostics={:?}", api.diagnostics());
    assert!(
        write.is_ok() && read.is_ok(),
        "client write={write:?}; read={read:?}; diagnostics={:?}",
        api.diagnostics()
    );
    assert!(response.starts_with("HTTP/1.1 200 "));
    assert_eq!(api.requests(), vec!["GET /fixture HTTP/1.1"]);
    assert!(api.diagnostics().is_empty(), "{:?}", api.diagnostics());
}

impl Drop for Api {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            worker.join().unwrap();
        }
    }
}
