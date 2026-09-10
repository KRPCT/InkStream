use super::credentials::{valid_secret, Credential, CredentialStore, REAUTH};
use super::http::{GithubHttp, HttpError, TokenReply, VERIFY_URI};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;

pub(super) trait Clock: Send + Sync { fn now_ms(&self) -> u64; }
pub(super) struct MonotonicClock { epoch_ms: u64, start: Instant }
impl MonotonicClock {
    pub fn new() -> Self {
        Self { epoch_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64, start: Instant::now() }
    }
}
impl Clock for MonotonicClock { fn now_ms(&self) -> u64 { self.epoch_ms.saturating_add(self.start.elapsed().as_millis() as u64) } }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    pub request_id: String, pub user_code: String, pub verification_uri: String,
    pub expires_at: u64, pub interval_ms: u64,
}
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum DevicePoll {
    Pending { #[serde(rename = "retryAfterMs")] retry_after_ms: u64 },
    Authorized { login: String }, Denied, Expired, Cancelled,
}

struct DeviceSession {
    owner: String, request_id: String, client_id: String, code: Option<String>,
    expires_at: u64, interval_ms: u64, next_poll_at: u64, in_flight: bool,
}
const MAX_RETIRED_REQUESTS: usize = 4096;
fn valid_request_id(id: &str) -> bool {
    (8..=128).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
struct AuthState {
    revision: u64, cancel: watch::Sender<bool>, device: Option<DeviceSession>, changing: bool,
    retired: HashSet<(String, String)>,
}
impl Default for AuthState {
    fn default() -> Self { Self { revision: 0, cancel: watch::channel(false).0, device: None, changing: false, retired: HashSet::new() } }
}
#[derive(Clone)]
pub(super) struct Ticket { revision: u64, cancel: watch::Receiver<bool> }

pub(super) struct AuthManager {
    state: Mutex<AuthState>, refresh_gate: tokio::sync::Mutex<()>,
    store: Arc<dyn CredentialStore>, http: GithubHttp, clock: Arc<dyn Clock>,
}
impl AuthManager {
    pub fn new(store: Arc<dyn CredentialStore>, http: GithubHttp, clock: Arc<dyn Clock>) -> Arc<Self> {
        Arc::new(Self { state: Mutex::new(AuthState::default()), refresh_gate: tokio::sync::Mutex::new(()), store, http, clock })
    }
    fn advance(state: &mut AuthState) -> Ticket {
        let _ = state.cancel.send(true);
        state.cancel = watch::channel(false).0;
        if let Some(device) = state.device.take() {
            if state.retired.len() < MAX_RETIRED_REQUESTS { state.retired.insert((device.owner, device.request_id)); }
        }
        state.changing = false;
        state.revision = state.revision.wrapping_add(1);
        Ticket { revision: state.revision, cancel: state.cancel.subscribe() }
    }
    /// Called at the beginning of a PAT/gh/logout intent, before any await or process start.
    pub fn begin_change(&self) -> Result<Ticket, String> {
        let mut state = self.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
        let ticket = Self::advance(&mut state);
        state.changing = true;
        Ok(ticket)
    }
    pub fn abort_change(&self, ticket: &Ticket) {
        if let Ok(mut state) = self.state.lock() {
            if state.revision == ticket.revision { Self::advance(&mut state); }
        }
    }
    pub fn cancel(&self, owner: &str, id: &str) -> bool {
        if !valid_request_id(id) { return false; }
        let Ok(mut state) = self.state.lock() else { return false; };
        // IPC cancellation may arrive before the async start command begins execution.
        if state.retired.len() < MAX_RETIRED_REQUESTS { state.retired.insert((owner.into(), id.into())); }
        if !state.device.as_ref().is_some_and(|s| s.owner == owner && s.request_id == id) { return false; }
        Self::advance(&mut state);
        true
    }
    pub fn close_owner(&self, owner: &str) {
        if let Ok(mut state) = self.state.lock() {
            if state.device.as_ref().is_some_and(|s| s.owner == owner) { Self::advance(&mut state); }
        }
    }
    fn current(state: &AuthState, ticket: &Ticket, owner: &str, id: &str) -> bool {
        state.revision == ticket.revision && state.device.as_ref().is_some_and(|s| s.owner == owner && s.request_id == id)
    }
    async fn store_at(self: &Arc<Self>, ticket: Ticket, credential: Option<Credential>) -> Result<(), String> {
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            let mut state = manager.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
            if state.revision != ticket.revision || *ticket.cancel.borrow() { return Err("GitHub 账户操作已取消或被新的登录替代。".into()); }
            let result = match credential {
                Some(value) => value.encode().and_then(|encoded| manager.store.write(&encoded)),
                None => manager.store.delete(),
            };
            // Commit is another revision boundary; a concurrent refresh cannot undo it.
            Self::advance(&mut state);
            result
        }).await.map_err(|_| "无法调度 GitHub 凭据存储。".to_string())?
    }
    pub async fn save_pat_at(self: &Arc<Self>, ticket: Ticket, token: String) -> Result<(), String> {
        let token = token.trim();
        if !valid_secret(token) { self.abort_change(&ticket); return Err("GitHub token 不能为空或包含控制字符。".into()); }
        self.store_at(ticket, Some(Credential::Pat { token: token.to_owned() })).await
    }
    pub async fn save_pat(self: &Arc<Self>, token: String) -> Result<(), String> {
        let ticket = self.begin_change()?;
        self.save_pat_at(ticket, token).await
    }
    pub async fn logout(self: &Arc<Self>) -> Result<(), String> {
        let ticket = self.begin_change()?;
        self.store_at(ticket, None).await
    }
    async fn snapshot(self: &Arc<Self>) -> Result<(Ticket, Option<Credential>), String> {
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || {
            let mut state = manager.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
            if state.device.as_ref().is_some_and(|session| manager.clock.now_ms() >= session.expires_at) {
                Self::advance(&mut state);
            }
            if state.changing { return Err("GitHub 账户正在登录或切换，请完成后重试。".into()); }
            let credential = manager.store.read()?.map(|value| Credential::decode(&value)).transpose()?;
            Ok((Ticket { revision: state.revision, cancel: state.cancel.subscribe() }, credential))
        }).await.map_err(|_| "无法调度 GitHub 凭据读取。".to_string())?
    }

    pub async fn start(self: &Arc<Self>, owner: &str, id: &str, client_id: &str) -> Result<DeviceStart, String> {
        if !valid_request_id(id) {
            return Err("设备登录请求编号无效。".into());
        }
        let client_id = client_id.trim();
        if client_id.is_empty() || client_id.len() > 128 || !client_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
            return Err("请配置有效的 GitHub OAuth App Client ID，并启用 Device Flow。".into());
        }
        // Registration precedes HTTP, so a pending start can always be cancelled by its owner.
        let ticket = {
            let mut state = self.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
            if state.retired.contains(&(owner.to_owned(), id.to_owned()))
                || state.device.as_ref().is_some_and(|session| session.owner == owner && session.request_id == id) {
                return Err("设备登录请求已使用，请重新获取验证码。".into());
            }
            // Never evict a cancellation and thereby revive its delayed start command.
            if state.retired.len() >= MAX_RETIRED_REQUESTS { return Err("设备登录请求过多，请重启应用后重试。".into()); }
            let ticket = Self::advance(&mut state);
            state.changing = true;
            state.device = Some(DeviceSession { owner: owner.into(), request_id: id.into(), client_id: client_id.into(),
                code: None, expires_at: self.clock.now_ms() + 20_000, interval_ms: 5_000, next_poll_at: 0, in_flight: false });
            ticket
        };
        let response = self.http.start(client_id, ticket.cancel.clone()).await;
        let mut state = self.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
        if !Self::current(&state, &ticket, owner, id) { return Err(HttpError::Cancelled.message()); }
        let response = match response { Ok(value) => value, Err(error) => { Self::advance(&mut state); return Err(error.message()); } };
        if !valid_secret(&response.device_code) || response.user_code.is_empty() || response.user_code.len() > 32
            || !response.user_code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || response.verification_uri != VERIFY_URI || !(1..=3600).contains(&response.expires_in)
            || response.interval.is_some_and(|value| value > 300) {
            Self::advance(&mut state);
            return Err(HttpError::Invalid.message());
        }
        let now = self.clock.now_ms();
        let interval_ms = response.interval.unwrap_or(5).max(5) * 1_000;
        let expires_at = now.saturating_add(response.expires_in * 1_000);
        let session = state.device.as_mut().ok_or_else(|| HttpError::Cancelled.message())?;
        session.code = Some(response.device_code);
        session.expires_at = expires_at;
        session.interval_ms = interval_ms;
        session.next_poll_at = now.saturating_add(interval_ms);
        Ok(DeviceStart { request_id: id.into(), user_code: response.user_code,
            verification_uri: VERIFY_URI.into(), expires_at, interval_ms })
    }

    pub async fn poll(self: &Arc<Self>, owner: &str, id: &str) -> Result<DevicePoll, String> {
        let (ticket, client_id, code) = {
            let mut state = self.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
            let ticket = Ticket { revision: state.revision, cancel: state.cancel.subscribe() };
            let Some(session) = state.device.as_mut().filter(|s| s.owner == owner && s.request_id == id) else { return Ok(DevicePoll::Cancelled); };
            let now = self.clock.now_ms();
            if now >= session.expires_at { Self::advance(&mut state); return Ok(DevicePoll::Expired); }
            if session.in_flight || session.code.is_none() || now < session.next_poll_at {
                return Ok(DevicePoll::Pending { retry_after_ms: session.next_poll_at.saturating_sub(now).max(1).max(if session.in_flight { session.interval_ms } else { 0 }) });
            }
            session.in_flight = true;
            session.next_poll_at = now.saturating_add(session.interval_ms);
            (ticket, session.client_id.clone(), session.code.clone().unwrap_or_default())
        };
        let response = self.http.poll(&client_id, &code, ticket.cancel.clone()).await;
        {
            let mut state = self.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
            if !Self::current(&state, &ticket, owner, id) { return Ok(DevicePoll::Cancelled); }
            if self.clock.now_ms() >= state.device.as_ref().unwrap().expires_at { Self::advance(&mut state); return Ok(DevicePoll::Expired); }
            if let Err(error) = response { Self::advance(&mut state); return Err(error.message()); }
        }
        let reply = response.map_err(HttpError::message)?;
        if let Some(error) = reply.error.as_deref() {
            let mut state = self.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
            if !Self::current(&state, &ticket, owner, id) { return Ok(DevicePoll::Cancelled); }
            match error {
                "authorization_pending" | "slow_down" => {
                    let session = state.device.as_mut().unwrap();
                    if error == "slow_down" {
                        session.interval_ms = session.interval_ms.saturating_add(5_000)
                            .max(reply.interval.unwrap_or(0).saturating_mul(1_000)).min(900_000);
                    }
                    session.in_flight = false;
                    session.next_poll_at = self.clock.now_ms().saturating_add(session.interval_ms);
                    return Ok(DevicePoll::Pending { retry_after_ms: session.interval_ms });
                }
                "access_denied" => { Self::advance(&mut state); return Ok(DevicePoll::Denied); }
                "expired_token" => { Self::advance(&mut state); return Ok(DevicePoll::Expired); }
                _ => { Self::advance(&mut state); return Err("GitHub 未能完成设备授权，请重新登录并检查 OAuth App 的 Device Flow 设置。".into()); }
            }
        }
        let authorized = self.authorized_credential(&client_id, reply, &ticket, None).await;
        // Identity validation is another asynchronous boundary, protected by the same ticket.
        {
            let mut state = self.state.lock().map_err(|_| "GitHub 账户状态不可用。")?;
            if !Self::current(&state, &ticket, owner, id) { return Ok(DevicePoll::Cancelled); }
            if self.clock.now_ms() >= state.device.as_ref().unwrap().expires_at { Self::advance(&mut state); return Ok(DevicePoll::Expired); }
            if authorized.is_err() { Self::advance(&mut state); }
        }
        let (credential, login) = authorized?;
        self.store_at(ticket, Some(credential)).await?;
        Ok(DevicePoll::Authorized { login })
    }

    async fn authorized_credential(&self, client_id: &str, reply: TokenReply, ticket: &Ticket, expected_user: Option<u64>) -> Result<(Credential, String), String> {
        let issued_at = self.clock.now_ms();
        let token = reply.access_token.filter(|token| valid_secret(token)).ok_or_else(|| HttpError::Invalid.message())?;
        if !reply.token_type.as_deref().is_some_and(|kind| kind.eq_ignore_ascii_case("bearer")) { return Err(HttpError::Invalid.message()); }
        if reply.refresh_token.as_ref().is_some_and(|value| !valid_secret(value))
            || reply.refresh_token.is_some() != reply.refresh_token_expires_in.is_some()
            || (reply.refresh_token.is_some() && reply.expires_in.is_none())
            || reply.expires_in.is_some_and(|value| value == 0 || value > 366 * 86400)
            || reply.refresh_token_expires_in.is_some_and(|value| value == 0 || value > 366 * 86400)
            || (expected_user.is_some() && (reply.expires_in.is_none() || reply.refresh_token.is_none())) {
            return Err(HttpError::Invalid.message());
        }
        let identity = self.http.identity(&token, ticket.cancel.clone()).await.map_err(HttpError::message)?;
        if expected_user.is_some_and(|id| id != identity.id) { return Err("GitHub 刷新后的账户不匹配，请重新登录。".into()); }
        Ok((Credential::Oauth { client_id: client_id.into(), access_token: token,
            expires_at: reply.expires_in.map(|seconds| issued_at.saturating_add(seconds * 1_000)),
            refresh_token: reply.refresh_token, refresh_expires_at: reply.refresh_token_expires_in.map(|seconds| issued_at.saturating_add(seconds * 1_000)),
            user_id: identity.id, login: identity.login.clone() }, identity.login))
    }

    /// All Git and GitHub REST callers obtain a usable token here; refresh never enters the webview.
    pub async fn token(self: &Arc<Self>) -> Result<Option<String>, String> {
        let _guard = tokio::time::timeout(Duration::from_secs(45), self.refresh_gate.lock()).await
            .map_err(|_| "GitHub 凭据正在更新，请稍后重试。".to_string())?;
        let (ticket, credential) = self.snapshot().await?;
        let Some(credential) = credential else { return Ok(None); };
        match credential {
            Credential::Pat { token } => Ok(Some(token)),
            Credential::Oauth { client_id, access_token, expires_at, refresh_token, refresh_expires_at, user_id, .. } => {
                let now = self.clock.now_ms();
                if expires_at.is_none_or(|expiry| expiry > now.saturating_add(60_000)) { return Ok(Some(access_token)); }
                if refresh_token.is_none() && expires_at.is_some_and(|expiry| expiry > now) { return Ok(Some(access_token)); }
                let Some(refresh_token) = refresh_token.filter(|_| refresh_expires_at.is_some_and(|expiry| expiry > now)) else {
                    self.store_at(ticket, None).await?;
                    return Err(REAUTH.into());
                };
                let reply = self.http.refresh(&client_id, &refresh_token, ticket.cancel.clone()).await.map_err(HttpError::message)?;
                if let Some(error) = reply.error.as_deref() {
                    if matches!(error, "bad_refresh_token" | "invalid_grant" | "expired_token" | "invalid_refresh_token") {
                        self.store_at(ticket, None).await?;
                        return Err(REAUTH.into());
                    }
                    return Err("GitHub 凭据刷新失败，请稍后重试或重新登录。".into());
                }
                let (credential, _) = self.authorized_credential(&client_id, reply, &ticket, Some(user_id)).await?;
                let result = match &credential { Credential::Oauth { access_token, .. } => access_token.clone(), _ => unreachable!() };
                self.store_at(ticket, Some(credential)).await?;
                Ok(Some(result))
            }
        }
    }
}
