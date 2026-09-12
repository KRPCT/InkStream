use super::core::{AuthManager, Clock, DevicePoll};
use super::credentials::{Credential, CredentialStore};
use super::http::GithubHttp;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering}, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const NOW: u64 = 1_700_000_000_000;
const OWNER: &str = "fixture-window";
const REQUEST: &str = "fixture-request-0001";
const CLIENT: &str = "fixture-client-id";
const CODE: &str = "fixture-native-only-device-code";

#[derive(Default)]
struct MemoryStore { value: Mutex<Option<String>>, writes: AtomicUsize, fail: AtomicBool }
impl CredentialStore for MemoryStore {
    fn read(&self) -> Result<Option<String>, String> { Ok(self.value.lock().unwrap().clone()) }
    fn write(&self, value: &str) -> Result<(), String> {
        if self.fail.load(Ordering::SeqCst) { return Err("fixture keyring denied".into()); }
        *self.value.lock().unwrap() = Some(value.into());
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn delete(&self) -> Result<(), String> {
        if self.fail.load(Ordering::SeqCst) { return Err("fixture keyring denied".into()); }
        *self.value.lock().unwrap() = None;
        Ok(())
    }
}
struct TestClock(AtomicU64);
impl Clock for TestClock { fn now_ms(&self) -> u64 { self.0.load(Ordering::SeqCst) } }
impl TestClock { fn advance(&self, ms: u64) { self.0.fetch_add(ms, Ordering::SeqCst); } }

struct Response { status: u16, body: String, delay: Duration, headers: String }
impl Response {
    fn json(body: serde_json::Value) -> Self { Self { status: 200, body: body.to_string(), delay: Duration::ZERO, headers: String::new() } }
    fn delayed(mut self) -> Self { self.delay = Duration::from_millis(120); self }
    fn status(mut self, status: u16) -> Self { self.status = status; self }
}
fn code() -> Response { Response::json(serde_json::json!({
    "device_code": CODE, "user_code": "WDJB-MJHT", "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 5
})) }
fn token(access: &str, refresh: &str) -> Response { Response::json(serde_json::json!({
    "access_token": access, "token_type": "bearer", "expires_in": 28800,
    "refresh_token": refresh, "refresh_token_expires_in": 15811200
})) }
fn identity() -> Response { Response::json(serde_json::json!({ "id": 42, "login": "octocat" })) }

/// Real HTTP boundary on a private loopback port; never talks to GitHub or an OS keyring.
struct Fixture {
    manager: Arc<AuthManager>, store: Arc<MemoryStore>, clock: Arc<TestClock>,
    requests: Arc<Mutex<Vec<String>>>, stop: Arc<AtomicBool>, server: Option<JoinHandle<()>>,
}
impl Fixture {
    fn new(responses: Vec<Response>) -> Self { Self::with_timeout(responses, Duration::from_secs(2)) }
    fn with_timeout(responses: Vec<Response>, timeout: Duration) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let server_requests = Arc::clone(&requests);
        let server_stop = Arc::clone(&stop);
        let server = thread::spawn(move || {
            let mut responses: VecDeque<Response> = responses.into();
            while !server_stop.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => { thread::sleep(Duration::from_millis(2)); continue; }
                    Err(_) => break,
                };
                // Winsock accept inherits nonblocking mode; an early WouldBlock must not close a valid request.
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                stream.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0_u8; 2048];
                loop {
                    let read = match stream.read(&mut chunk) { Ok(0) | Err(_) => break, Ok(read) => read };
                    bytes.extend_from_slice(&chunk[..read]);
                    if bytes.len() > 65_536 { break; }
                    if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let size = headers.lines().find_map(|line| line.split_once(':')
                            .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                            .and_then(|(_, value)| value.trim().parse::<usize>().ok())).unwrap_or(0);
                        if bytes.len() >= end + 4 + size { break; }
                    }
                }
                if bytes.is_empty() { continue; }
                server_requests.lock().unwrap().push(String::from_utf8_lossy(&bytes).into_owned());
                let response = responses.pop_front().unwrap_or_else(|| Response::json(serde_json::json!({"unexpected": true})).status(500));
                thread::sleep(response.delay);
                let head = format!("HTTP/1.1 {} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n", response.status, response.body.len(), response.headers);
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(response.body.as_bytes());
            }
        });
        let store = Arc::new(MemoryStore::default());
        let clock = Arc::new(TestClock(AtomicU64::new(NOW)));
        let manager = AuthManager::new(store.clone(), GithubHttp::fixture(&format!("http://{address}"), timeout), clock.clone());
        Self { manager, store, clock, requests, stop, server: Some(server) }
    }
    async fn start(&self) { self.manager.start(OWNER, REQUEST, CLIENT).await.unwrap(); }
    fn hits(&self) -> usize { self.requests.lock().unwrap().len() }
    async fn wait_hits(&self, target: usize) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while self.hits() < target { tokio::time::sleep(Duration::from_millis(2)).await; }
        }).await.expect("fixture HTTP request did not arrive before its deadline");
    }
    fn seed_expiring_oauth(&self) {
        *self.store.value.lock().unwrap() = Some(Credential::Oauth {
            client_id: CLIENT.into(), access_token: "fixture-old-access".into(), expires_at: Some(NOW - 1),
            refresh_token: Some("fixture-old-refresh".into()), refresh_expires_at: Some(NOW + 3600_000), user_id: 42, login: "octocat".into(),
        }.encode().unwrap());
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(server) = self.server.take() { server.join().unwrap(); }
    }
}

#[test]
fn legacy_pat_is_read_without_migration_or_real_keyring_access() {
    let credential = Credential::decode("fixture-legacy-token").unwrap();
    assert!(matches!(credential, Credential::Pat { token } if token == "fixture-legacy-token"));
}

#[test]
fn malformed_stored_credentials_are_rejected_before_environment_or_http_use() {
    let corrupt = Credential::Pat { token: "fixture-token\npassword=unexpected".into() }.encode().unwrap();
    assert!(Credential::decode(&corrupt).is_err());
    assert!(Credential::decode("inkstream-github-v1:not-json").is_err());
}

#[test]
fn a_pending_gh_intent_is_superseded_by_pat_and_cannot_write_later() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![]);
        let gh_ticket = fixture.manager.begin_change().unwrap();
        assert!(fixture.manager.token().await.is_err());
        fixture.manager.save_pat("fixture-current-pat".into()).await.unwrap();
        assert!(fixture.manager.save_pat_at(gh_ticket, "fixture-late-gh-token".into()).await.is_err());
        assert_eq!(fixture.manager.token().await.unwrap().as_deref(), Some("fixture-current-pat"));
        assert_eq!(fixture.hits(), 0);
    });
}

#[test]
fn cancellation_before_async_start_registration_is_remembered_per_window() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code()]);
        assert!(!fixture.manager.cancel(OWNER, REQUEST));
        assert!(fixture.manager.start(OWNER, REQUEST, CLIENT).await.is_err());
        assert_eq!(fixture.hits(), 0);
        fixture.manager.start("different-window", REQUEST, CLIENT).await.unwrap();
        assert_eq!(fixture.hits(), 1);
        assert!(!fixture.manager.cancel(OWNER, REQUEST));
        assert!(matches!(fixture.manager.poll("different-window", REQUEST).await.unwrap(), DevicePoll::Pending { .. }));
    });
}

#[test]
fn device_start_exposes_only_public_code_and_native_interval_is_enforced() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code(), Response::json(serde_json::json!({"error":"authorization_pending"}))]);
        let info = fixture.manager.start(OWNER, REQUEST, CLIENT).await.unwrap();
        let public = serde_json::to_string(&info).unwrap();
        assert!(public.contains("WDJB-MJHT"));
        assert!(!public.contains(CODE));
        assert!(!public.contains("access_token"));
        assert_eq!(info.expires_at, NOW + 900_000);
        assert_eq!(info.interval_ms, 5_000);
        assert!(matches!(fixture.manager.poll(OWNER, REQUEST).await.unwrap(), DevicePoll::Pending { retry_after_ms: 5_000 }));
        assert_eq!(fixture.hits(), 1);
        fixture.clock.advance(5_000);
        assert!(matches!(fixture.manager.poll(OWNER, REQUEST).await.unwrap(), DevicePoll::Pending { retry_after_ms: 5_000 }));
        let requests = fixture.requests.lock().unwrap();
        assert!(requests[0].contains("POST /login/device/code"));
        assert!(requests[0].contains("scope=repo+offline_access"));
        assert!(requests[1].contains("device_code=fixture-native-only-device-code"));
    });
}

#[test]
fn slow_down_increases_the_server_enforced_interval() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code(), Response::json(serde_json::json!({"error":"slow_down","interval":12}))]);
        fixture.start().await;
        fixture.clock.advance(5_000);
        assert!(matches!(fixture.manager.poll(OWNER, REQUEST).await.unwrap(), DevicePoll::Pending { retry_after_ms: 12_000 }));
        fixture.clock.advance(11_999);
        assert!(matches!(fixture.manager.poll(OWNER, REQUEST).await.unwrap(), DevicePoll::Pending { retry_after_ms: 1 }));
        assert_eq!(fixture.hits(), 2);
    });
}

#[test]
fn authorization_checks_identity_before_atomic_store_and_refreshes_before_api_use() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code(), token("fixture-access", "fixture-refresh"), identity(), token("fixture-new-access", "fixture-new-refresh"), identity()]);
        fixture.start().await;
        fixture.clock.advance(5_000);
        let result = fixture.manager.poll(OWNER, REQUEST).await.unwrap();
        let public = serde_json::to_string(&result).unwrap();
        assert!(public.contains("octocat"));
        assert!(!public.contains("fixture-access"));
        assert_eq!(fixture.store.writes.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.manager.token().await.unwrap().as_deref(), Some("fixture-access"));
        fixture.clock.advance(28_800_000);
        assert_eq!(fixture.manager.token().await.unwrap().as_deref(), Some("fixture-new-access"));
        assert_eq!(fixture.store.writes.load(Ordering::SeqCst), 2);
        let saved = fixture.store.value.lock().unwrap().clone().unwrap();
        assert!(saved.contains("fixture-new-refresh"));
        assert!(!saved.contains("fixture-old-access"));
        let requests = fixture.requests.lock().unwrap();
        assert!(requests[2].starts_with("GET /user"));
        assert!(requests[2].to_ascii_lowercase().contains("authorization: bearer fixture-access"));
        assert!(requests[3].contains("grant_type=refresh_token"));
    });
}

#[test]
fn denied_and_expired_grants_stop_polling_without_storing_tokens() {
    tauri::async_runtime::block_on(async {
        for error in ["access_denied", "expired_token"] {
            let fixture = Fixture::new(vec![code(), Response::json(serde_json::json!({"error":error}))]);
            fixture.start().await;
            fixture.clock.advance(5_000);
            let result = fixture.manager.poll(OWNER, REQUEST).await.unwrap();
            assert!(matches!((error, result), ("access_denied", DevicePoll::Denied) | ("expired_token", DevicePoll::Expired)));
            assert!(matches!(fixture.manager.poll(OWNER, REQUEST).await.unwrap(), DevicePoll::Cancelled));
            assert_eq!(fixture.hits(), 2);
            assert!(fixture.store.value.lock().unwrap().is_none());
        }
    });
}

#[test]
fn expired_device_session_is_rejected_without_a_network_poll() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code()]);
        fixture.start().await;
        fixture.clock.advance(900_001);
        assert!(matches!(fixture.manager.poll(OWNER, REQUEST).await.unwrap(), DevicePoll::Expired));
        assert_eq!(fixture.hits(), 1);
        assert_eq!(fixture.manager.token().await.unwrap(), None);
    });
}

#[test]
fn cancel_before_start_returns_retires_native_http_and_cannot_overwrite_pat() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code().delayed()]);
        let manager = fixture.manager.clone();
        let pending = tokio::spawn(async move { manager.start(OWNER, REQUEST, CLIENT).await });
        fixture.wait_hits(1).await;
        assert!(!fixture.manager.cancel("another-window", REQUEST));
        assert!(fixture.manager.cancel(OWNER, REQUEST));
        fixture.manager.save_pat("fixture-new-pat".into()).await.unwrap();
        assert!(pending.await.unwrap().is_err());
        assert_eq!(fixture.manager.token().await.unwrap().as_deref(), Some("fixture-new-pat"));
        assert_eq!(fixture.store.writes.load(Ordering::SeqCst), 1);
    });
}

#[test]
fn a_new_start_supersedes_a_pending_old_start_and_old_cancel_is_harmless() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code().delayed(), code()]);
        let manager = fixture.manager.clone();
        let old = tokio::spawn(async move { manager.start(OWNER, REQUEST, CLIENT).await });
        fixture.wait_hits(1).await;
        let new_id = "fixture-request-0002";
        let info = fixture.manager.start(OWNER, new_id, CLIENT).await.unwrap();
        assert_eq!(info.request_id, new_id);
        assert!(old.await.unwrap().is_err());
        assert!(!fixture.manager.cancel(OWNER, REQUEST));
        assert!(matches!(fixture.manager.poll(OWNER, new_id).await.unwrap(), DevicePoll::Pending { .. }));
        fixture.manager.close_owner(OWNER);
        assert!(matches!(fixture.manager.poll(OWNER, new_id).await.unwrap(), DevicePoll::Cancelled));
    });
}

#[test]
fn poll_in_flight_is_single_and_late_authorization_cannot_replace_pat() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code(), token("fixture-old-device", "fixture-refresh").delayed()]);
        fixture.start().await;
        fixture.clock.advance(5_000);
        let manager = fixture.manager.clone();
        let pending = tokio::spawn(async move { manager.poll(OWNER, REQUEST).await });
        fixture.wait_hits(2).await;
        assert!(matches!(fixture.manager.poll(OWNER, REQUEST).await.unwrap(), DevicePoll::Pending { .. }));
        assert_eq!(fixture.hits(), 2);
        fixture.manager.save_pat("fixture-selected-pat".into()).await.unwrap();
        assert!(matches!(pending.await.unwrap().unwrap(), DevicePoll::Cancelled));
        assert_eq!(fixture.manager.token().await.unwrap().as_deref(), Some("fixture-selected-pat"));
        assert_eq!(fixture.store.writes.load(Ordering::SeqCst), 1);
    });
}

#[test]
fn cancellation_during_user_identity_check_prevents_credential_commit() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![code(), token("fixture-device", "fixture-refresh"), identity().delayed()]);
        fixture.start().await;
        fixture.clock.advance(5_000);
        let manager = fixture.manager.clone();
        let pending = tokio::spawn(async move { manager.poll(OWNER, REQUEST).await });
        fixture.wait_hits(3).await;
        fixture.manager.logout().await.unwrap();
        assert!(matches!(pending.await.unwrap().unwrap(), DevicePoll::Cancelled));
        assert!(fixture.store.value.lock().unwrap().is_none());
        assert_eq!(fixture.store.writes.load(Ordering::SeqCst), 0);
    });
}

#[test]
fn concurrent_api_requests_share_one_refresh_and_one_identity_check() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![token("fixture-new-access", "fixture-new-refresh").delayed(), identity()]);
        fixture.seed_expiring_oauth();
        let left = fixture.manager.clone();
        let right = fixture.manager.clone();
        let (left, right) = tokio::join!(left.token(), right.token());
        assert_eq!(left.unwrap().as_deref(), Some("fixture-new-access"));
        assert_eq!(right.unwrap().as_deref(), Some("fixture-new-access"));
        assert_eq!(fixture.hits(), 2);
        assert_eq!(fixture.store.writes.load(Ordering::SeqCst), 1);
    });
}

#[test]
fn old_refresh_cannot_resurrect_logout_or_replace_a_new_pat() {
    tauri::async_runtime::block_on(async {
        for logout in [true, false] {
            let fixture = Fixture::new(vec![token("fixture-old-result", "fixture-old-result-refresh").delayed()]);
            fixture.seed_expiring_oauth();
            let manager = fixture.manager.clone();
            let refreshing = tokio::spawn(async move { manager.token().await });
            fixture.wait_hits(1).await;
            if logout { fixture.manager.logout().await.unwrap(); }
            else { fixture.manager.save_pat("fixture-chosen-pat".into()).await.unwrap(); }
            assert!(refreshing.await.unwrap().is_err());
            assert_eq!(fixture.manager.token().await.unwrap().as_deref(), if logout { None } else { Some("fixture-chosen-pat") });
        }
    });
}

#[test]
fn refresh_revocation_on_http_400_requires_reauthentication_and_removes_expired_credential() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![Response::json(serde_json::json!({"error":"bad_refresh_token","error_description":"fixture-old-refresh"})).status(400)]);
        fixture.seed_expiring_oauth();
        let error = fixture.manager.token().await.unwrap_err();
        assert!(error.contains("重新登录"));
        assert!(!error.contains("fixture-old-refresh"));
        assert!(fixture.store.value.lock().unwrap().is_none());
    });
}

#[test]
fn transient_refresh_failure_retains_metadata_and_never_returns_the_expired_access_token() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![Response::json(serde_json::json!({"secret":"fixture-old-access"})).status(503), token("fixture-recovered", "fixture-recovered-refresh"), identity()]);
        fixture.seed_expiring_oauth();
        let before = fixture.store.value.lock().unwrap().clone();
        let error = fixture.manager.token().await.unwrap_err();
        assert!(!error.contains("fixture-old-access"));
        assert_eq!(*fixture.store.value.lock().unwrap(), before);
        assert_eq!(fixture.manager.token().await.unwrap().as_deref(), Some("fixture-recovered"));
    });
}

#[test]
fn changed_identity_or_denied_keyring_cannot_report_success() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new(vec![token("fixture-new-access", "fixture-new-refresh"), Response::json(serde_json::json!({"id":99,"login":"different-user"}))]);
        fixture.seed_expiring_oauth();
        assert!(fixture.manager.token().await.unwrap_err().contains("账户不匹配"));
        assert_eq!(fixture.store.writes.load(Ordering::SeqCst), 0);
        let fixture = Fixture::new(vec![code(), token("fixture-device", "fixture-refresh"), identity()]);
        fixture.start().await;
        fixture.clock.advance(5_000);
        fixture.store.fail.store(true, Ordering::SeqCst);
        assert!(fixture.manager.poll(OWNER, REQUEST).await.is_err());
        assert!(fixture.store.value.lock().unwrap().is_none());
        fixture.store.fail.store(false, Ordering::SeqCst);
        fixture.manager.save_pat("fixture-retry-pat".into()).await.unwrap();
        assert_eq!(fixture.manager.token().await.unwrap().as_deref(), Some("fixture-retry-pat"));
    });
}

#[test]
fn http_redirect_oversized_response_timeout_and_invalid_verification_uri_are_rejected() {
    tauri::async_runtime::block_on(async {
        let mut redirect = code().status(302);
        redirect.headers = "Location: https://example.invalid/collect\r\n".into();
        let mut oversized = code(); oversized.body = "x".repeat(32 * 1024 + 1);
        let wrong_uri = Response::json(serde_json::json!({"device_code":CODE,"user_code":"GOOD-CODE","verification_uri":"https://example.invalid/collect","expires_in":900,"interval":5}));
        for response in [redirect, oversized, wrong_uri] {
            let fixture = Fixture::new(vec![response]);
            assert!(fixture.manager.start(OWNER, REQUEST, CLIENT).await.is_err());
            assert_eq!(fixture.hits(), 1);
            assert!(fixture.store.value.lock().unwrap().is_none());
        }
        let fixture = Fixture::with_timeout(vec![code().delayed()], Duration::from_millis(30));
        assert!(fixture.manager.start(OWNER, REQUEST, CLIENT).await.is_err());
        assert_eq!(fixture.manager.token().await.unwrap(), None);
    });
}
