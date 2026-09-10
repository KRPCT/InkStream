use super::{CachedItem, Creds, Snapshot, PAGE};
use serde_json::Value;
use std::collections::HashSet;

pub(super) enum DownloadError {
    Changed,
    Failed(String),
}

impl From<String> for DownloadError {
    fn from(message: String) -> Self {
        Self::Failed(message)
    }
}

fn header_number(response: &reqwest::Response, name: &str) -> Result<i64, DownloadError> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .ok_or_else(|| {
            DownloadError::Failed(format!("Zotero 响应缺少有效的 {name}，本次同步未提交。"))
        })
}

async fn get(
    client: &reqwest::Client,
    creds: &Creds,
    url: &str,
) -> Result<reqwest::Response, DownloadError> {
    let response = client
        .get(url)
        .header("Zotero-API-Key", &creds.api_key)
        .header("Zotero-API-Version", "3")
        .send()
        .await
        .map_err(|error| {
            #[cfg(test)]
            {
                use std::error::Error;
                eprintln!("Zotero fixture request error: {error:?}");
                let mut source = error.source();
                while let Some(cause) = source {
                    eprintln!("  caused by: {cause:?}");
                    source = cause.source();
                }
            }
            if error.is_timeout() {
                "Zotero 服务器响应超时".to_string()
            } else if error.is_connect() {
                "无法连接 Zotero 服务器".to_string()
            } else {
                format!("Zotero 同步请求失败: {error}")
            }
        })?;
    match response.status().as_u16() {
        200 => Ok(response),
        403 => Err(DownloadError::Failed(
            "API Key 无效或无访问权限（403）".into(),
        )),
        404 => Err(DownloadError::Failed("userID 不存在（404）".into())),
        status => Err(DownloadError::Failed(format!(
            "Zotero 服务器错误: {status}；本次同步未提交。"
        ))),
    }
}

fn same_version(current: i64, expected: Option<i64>, since: i64) -> Result<(), DownloadError> {
    if current < since {
        return Err(DownloadError::Failed(
            "远端版本低于已同步版本，本次同步未提交。".into(),
        ));
    }
    if expected.is_some_and(|version| version != current) {
        return Err(DownloadError::Changed);
    }
    Ok(())
}

fn cached_item(item: &Value) -> Result<CachedItem, DownloadError> {
    let key = item
        .get("key")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
        .ok_or_else(|| {
            DownloadError::Failed("Zotero 条目缺少稳定的 itemKey，本次同步未提交。".into())
        })?;
    let data = item
        .get("data")
        .filter(|value| value.is_object())
        .ok_or_else(|| DownloadError::Failed("Zotero 条目缺少元数据，本次同步未提交。".into()))?;
    let deleted = data
        .get("deleted")
        .is_some_and(|value| value.as_i64() == Some(1) || value.as_bool() == Some(true));
    let non_bibliographic = matches!(
        data.get("itemType").and_then(Value::as_str),
        Some("note" | "attachment" | "annotation")
    );
    let mut csl = if deleted || non_bibliographic {
        // 用不可引用状态替换同 key 的旧记录，避免条目移入回收站或改类型后仍可被引用。
        Value::Null
    } else {
        item.get("csljson")
            .filter(|value| value.is_object())
            .cloned()
            .ok_or_else(|| {
                DownloadError::Failed("Zotero 条目缺少有效 CSL 数据，本次同步未提交。".into())
            })?
    };
    if csl.is_object() && crate::zotero::item_citekey(&csl).is_empty() {
        let citekey = data
            .get("citationKey")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|key| !key.is_empty())
            .or_else(|| {
                data.get("extra")
                    .and_then(Value::as_str)?
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        let value = value.trim();
                        (name.trim().eq_ignore_ascii_case("citation key") && !value.is_empty())
                            .then_some(value)
                    })
            });
        if let Some(citekey) = citekey {
            csl.as_object_mut()
                .unwrap()
                .insert("citation-key".into(), Value::String(citekey.to_string()));
        }
    }
    Ok(CachedItem {
        key: key.to_string(),
        csl,
    })
}

pub(super) async fn snapshot(
    client: &reqwest::Client,
    creds: &Creds,
    since: i64,
    api_base: &str,
) -> Result<Snapshot, DownloadError> {
    let mut items = Vec::new();
    let mut keys = HashSet::new();
    let mut start = 0usize;
    let mut version = None;
    let mut expected_total = None;
    loop {
        // JSON envelope 提供不可变 itemKey；CSL id 可能是 URI 或引用键，不能拿来匹配删除日志。
        // includeTrashed=1 确保移入回收站的变化也能使旧可引用缓存失效。
        let url = format!("{api_base}/users/{}/items?format=json&include=data,csljson&includeTrashed=1&since={since}&start={start}&limit={PAGE}", creds.user_id);
        let response = get(client, creds, &url).await?;
        let page_version = header_number(&response, "Last-Modified-Version")?;
        same_version(page_version, version, since)?;
        version = Some(page_version);
        let total = usize::try_from(header_number(&response, "Total-Results")?)
            .map_err(|_| DownloadError::Failed("Zotero 返回的条目总数无效。".into()))?;
        if expected_total.is_some_and(|previous| previous != total) {
            return Err(DownloadError::Changed);
        }
        expected_total = Some(total);
        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("解析文献响应失败: {e}"))?;
        let page = body.as_array().ok_or_else(|| {
            DownloadError::Failed("Zotero 文献响应格式无效，本次同步未提交。".into())
        })?;
        let expected_count = total.saturating_sub(start).min(PAGE);
        if page.len() != expected_count {
            return Err(DownloadError::Failed(
                "Zotero 分页条目不完整，本次同步未提交。".into(),
            ));
        }
        for item in page {
            let item = cached_item(item)?;
            if !keys.insert(item.key.clone()) {
                return Err(DownloadError::Failed(
                    "Zotero 分页返回重复条目，本次同步未提交。".into(),
                ));
            }
            items.push(item);
        }
        if start + page.len() >= total {
            break;
        }
        start = start
            .checked_add(PAGE)
            .ok_or_else(|| DownloadError::Failed("Zotero 分页范围无效。".into()))?;
    }
    let response = get(
        client,
        creds,
        &format!("{api_base}/users/{}/deleted?since={since}", creds.user_id),
    )
    .await?;
    let deleted_version = header_number(&response, "Last-Modified-Version")?;
    same_version(deleted_version, version, since)?;
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("解析删除记录失败: {e}"))?;
    let deleted = body
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| DownloadError::Failed("Zotero 删除记录格式无效，本次同步未提交。".into()))?
        .iter()
        .map(|key| {
            key.as_str()
                .filter(|key| !key.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    DownloadError::Failed("Zotero 删除记录缺少条目标识，本次同步未提交。".into())
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Snapshot {
        version: deleted_version,
        items,
        deleted,
    })
}
