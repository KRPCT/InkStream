use serde::{Deserialize, Serialize};

const PREFIX: &str = "inkstream-github-v1:";
pub(super) const REAUTH: &str = "GitHub 授权已失效，请在账户设置重新登录。";

/// One atomic keyring value carries tokens and their refresh metadata together.
/// Deliberately no Debug implementation: this value must never reach logs or IPC.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(super) enum Credential {
    Pat { token: String },
    Oauth {
        client_id: String,
        access_token: String,
        expires_at: Option<u64>,
        refresh_token: Option<String>,
        refresh_expires_at: Option<u64>,
        user_id: u64,
        login: String,
    },
}

pub(super) trait CredentialStore: Send + Sync {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

pub(super) fn valid_secret(value: &str) -> bool {
    !value.is_empty() && value.len() <= 16_384 && !value.chars().any(char::is_control)
}

impl Credential {
    pub fn decode(value: &str) -> Result<Self, String> {
        if let Some(json) = value.strip_prefix(PREFIX) {
            let credential: Self = serde_json::from_str(json).map_err(|_| "GitHub 凭据格式无效，请重新登录。".to_string())?;
            let valid = match &credential {
                Self::Pat { token } => valid_secret(token),
                Self::Oauth { client_id, access_token, refresh_token, refresh_expires_at, user_id, login, .. } => {
                    !client_id.is_empty() && client_id.len() <= 128
                        && client_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                        && valid_secret(access_token) && refresh_token.as_ref().is_none_or(|token| valid_secret(token))
                        && refresh_token.is_some() == refresh_expires_at.is_some() && *user_id > 0
                        && !login.is_empty() && login.len() <= 39 && login.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                }
            };
            if valid { Ok(credential) } else { Err("GitHub 凭据格式无效，请重新登录。".into()) }
        } else if valid_secret(value.trim()) {
            // Existing installations store a plain PAT/gh token in this same entry.
            Ok(Self::Pat { token: value.trim().to_owned() })
        } else { Err("GitHub 凭据为空或无效，请重新登录。".into()) }
    }
    pub fn encode(&self) -> Result<String, String> {
        serde_json::to_string(self).map(|json| format!("{PREFIX}{json}"))
            .map_err(|_| "无法编码 GitHub 凭据。".into())
    }
}
