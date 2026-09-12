use reqwest::{Client, RequestBuilder};
use serde::{de::DeserializeOwned, Deserialize};
use std::time::Duration;
use tokio::sync::watch;

pub(super) const VERIFY_URI: &str = "https://github.com/login/device";
const BODY_LIMIT: usize = 32 * 1024;

#[derive(Clone)]
pub(super) struct GithubHttp {
    client: Client,
    oauth_base: String,
    api_base: String,
}

#[derive(Clone, Copy)]
pub(super) enum HttpError { Cancelled, Network, Http(u16), Invalid }
impl HttpError {
    pub fn message(self) -> String {
        match self {
            Self::Cancelled => "设备登录已取消。".into(),
            Self::Network => "连接 GitHub 失败或超时，请检查网络后重试。".into(),
            Self::Http(code) => format!("GitHub 登录服务暂不可用（HTTP {code}），请稍后重试。"),
            Self::Invalid => "GitHub 登录响应无效，请重新登录。".into(),
        }
    }
}

#[derive(Deserialize)]
pub(super) struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: Option<u64>,
}

#[derive(Deserialize)]
pub(super) struct TokenReply {
    pub access_token: Option<String>,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
    pub refresh_token_expires_in: Option<u64>,
    pub error: Option<String>,
    pub interval: Option<u64>,
}

#[derive(Deserialize)]
pub(super) struct Identity { pub id: u64, pub login: String }

impl GithubHttp {
    pub fn production() -> Result<Self, String> {
        Self::new("https://github.com", "https://api.github.com", Duration::from_secs(20))
    }
    fn new(oauth_base: &str, api_base: &str, timeout: Duration) -> Result<Self, String> {
        let client = Client::builder().connect_timeout(timeout.min(Duration::from_secs(10)))
            .timeout(timeout).redirect(reqwest::redirect::Policy::none())
            .user_agent("InkStream-GitHub-Device-Flow")
            .build().map_err(|_| "无法初始化 GitHub 登录连接。".to_string())?;
        Ok(Self { client, oauth_base: oauth_base.into(), api_base: api_base.into() })
    }
    #[cfg(test)]
    pub fn fixture(base: &str, timeout: Duration) -> Self { Self::new(base, base, timeout).unwrap() }

    async fn request<T: DeserializeOwned>(&self, request: RequestBuilder, mut cancelled: watch::Receiver<bool>, oauth_error: bool) -> Result<T, HttpError> {
        if *cancelled.borrow() { return Err(HttpError::Cancelled); }
        let work = async {
            let mut response = request.send().await.map_err(|_| HttpError::Network)?;
            let status = response.status();
            if !status.is_success() && !(oauth_error && matches!(status.as_u16(), 400 | 401)) { return Err(HttpError::Http(status.as_u16())); }
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| HttpError::Network)? {
                if body.len().saturating_add(chunk.len()) > BODY_LIMIT { return Err(HttpError::Invalid); }
                body.extend_from_slice(&chunk);
            }
            if !status.is_success() && !serde_json::from_slice::<serde_json::Value>(&body).ok()
                .is_some_and(|value| value.get("error").is_some_and(|error| error.is_string())) {
                return Err(HttpError::Http(status.as_u16()));
            }
            serde_json::from_slice(&body).map_err(|_| HttpError::Invalid)
        };
        tokio::select! {
            biased;
            _ = cancelled.changed() => Err(HttpError::Cancelled),
            result = work => result,
        }
    }

    pub async fn start(&self, client_id: &str, cancel: watch::Receiver<bool>) -> Result<DeviceCode, HttpError> {
        self.request(self.client.post(format!("{}/login/device/code", self.oauth_base))
            .header("Accept", "application/json")
            .form(&[("client_id", client_id), ("scope", "repo offline_access")]), cancel, false).await
    }
    pub async fn poll(&self, client_id: &str, code: &str, cancel: watch::Receiver<bool>) -> Result<TokenReply, HttpError> {
        self.request(self.client.post(format!("{}/login/oauth/access_token", self.oauth_base))
            .header("Accept", "application/json")
            .form(&[("client_id", client_id), ("device_code", code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")]), cancel, true).await
    }
    pub async fn refresh(&self, client_id: &str, token: &str, cancel: watch::Receiver<bool>) -> Result<TokenReply, HttpError> {
        self.request(self.client.post(format!("{}/login/oauth/access_token", self.oauth_base))
            .header("Accept", "application/json")
            .form(&[("client_id", client_id), ("refresh_token", token), ("grant_type", "refresh_token")]), cancel, true).await
    }
    pub async fn identity(&self, token: &str, cancel: watch::Receiver<bool>) -> Result<Identity, HttpError> {
        let user: Identity = self.request(self.client.get(format!("{}/user", self.api_base))
            .bearer_auth(token).header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28"), cancel, false).await?;
        if user.id == 0 || user.login.is_empty() || user.login.len() > 39
            || !user.login.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            return Err(HttpError::Invalid);
        }
        Ok(user)
    }
}
