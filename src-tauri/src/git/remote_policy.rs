use reqwest::Url;
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RemoteMode {
    Local,
    Ssh,
    Oauth,
    Custom,
}

/// Required on every remote command: omission must not fall back to unrestricted access.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteOptions {
    pub mode: RemoteMode,
    pub custom_server: String,
}

pub struct RemoteTarget {
    /// Named remote for normal operations, explicit URL for a custom target or clone.
    pub argument: String,
    pub display: String,
    pub protocol: &'static str,
    pub github_auth: bool,
}

struct ParsedTarget {
    protocol: &'static str,
    github: bool,
}

fn invalid_target() -> String {
    "请使用完整的 HTTPS 或 SSH 仓库地址；不支持主机名、文件路径或含密码的 URL".into()
}

fn parse_target(value: &str) -> Result<ParsedTarget, String> {
    if value.is_empty() || value.chars().any(char::is_whitespace) || value.contains('\\') {
        return Err(invalid_target());
    }
    if value.contains("://") {
        let url = Url::parse(value).map_err(|_| invalid_target())?;
        if url.host_str().is_none()
            || url.path().trim_matches('/').is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid_target());
        }
        return match url.scheme() {
            "https" if url.username().is_empty() => Ok(ParsedTarget {
                protocol: "https",
                github: url.host_str() == Some("github.com")
                    && url.port_or_known_default() == Some(443),
            }),
            "ssh" => Ok(ParsedTarget { protocol: "ssh", github: false }),
            _ => Err(invalid_target()),
        };
    }
    // Git scp form, including an explicit SSH alias; never interpret a Windows drive as a host.
    let host_start = value.rfind('@').map_or(0, |n| n + 1);
    let tail = &value[host_start..];
    let split = if tail.starts_with('[') {
        tail.find("]:").map(|n| n + 1)
    } else {
        tail.find(':')
    }.ok_or_else(invalid_target)?;
    let host = &tail[..split];
    let path = &tail[split + 1..];
    let user_ok = host_start == 0 || value[..host_start - 1].chars().all(|c| {
        c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')
    });
    let host_ok = if host.starts_with('[') && host.ends_with(']') {
        host[1..host.len() - 1].parse::<std::net::Ipv6Addr>().is_ok()
    } else {
        host.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
            && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    };
    if !user_ok || !host_ok || path.is_empty() || path.starts_with(':') || path.contains(['?', '#'])
        || (host_start == 0 && host.len() == 1 && host.as_bytes()[0].is_ascii_alphabetic())
    {
        return Err(invalid_target());
    }
    Ok(ParsedTarget { protocol: "ssh", github: false })
}

impl RemoteOptions {
    pub fn ensure_enabled(&self) -> Result<(), String> {
        if self.mode == RemoteMode::Local {
            Err("当前为仅本地模式；请在设置中选择远程方式后再同步。".into())
        } else {
            Ok(())
        }
    }

    pub fn is_custom(&self) -> bool {
        self.mode == RemoteMode::Custom
    }

    /// urls are Git's resolved URLs, including every pushurl for a push.
    pub fn for_remote(&self, remote: &str, urls: &[String]) -> Result<RemoteTarget, String> {
        self.ensure_enabled()?;
        if self.is_custom() {
            return self.for_url(self.custom_server.trim());
        }
        if urls.is_empty() {
            return Err("远程没有可用的仓库地址".into());
        }
        let mut target = self.for_url(&urls[0])?;
        for url in &urls[1..] {
            self.for_url(url)?;
        }
        target.argument = remote.to_string();
        target.display = urls.join(", ");
        Ok(target)
    }

    pub fn for_clone(&self, url: &str) -> Result<RemoteTarget, String> {
        self.ensure_enabled()?;
        if self.is_custom() && url.trim() != self.custom_server.trim() {
            return Err("克隆地址与自定义仓库设置不同；请先确认并统一目标地址。".into());
        }
        self.for_url(url.trim())
    }

    pub fn for_url(&self, url: &str) -> Result<RemoteTarget, String> {
        self.ensure_enabled()?;
        let parsed = parse_target(url)?;
        match self.mode {
            RemoteMode::Ssh if parsed.protocol != "ssh" => {
                return Err("当前为 SSH 模式，但目标不是 SSH 地址；请选择匹配的远程方式或明确配置 SSH 仓库地址。".into());
            }
            RemoteMode::Oauth if !parsed.github => {
                return Err("GitHub 登录模式仅用于 https://github.com 的仓库；其他主机请选择 SSH 或自定义服务器。".into());
            }
            _ => {}
        }
        Ok(RemoteTarget {
            argument: url.to_string(),
            display: url.to_string(),
            protocol: parsed.protocol,
            github_auth: self.mode == RemoteMode::Oauth,
        })
    }
}

#[cfg(test)]
#[path = "remote_policy_tests.rs"]
mod tests;
