use super::worker::Scope;
use crate::projects::ProjectRepository;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexLocation { pub project_id: String, pub database_url: String }

#[derive(Clone, Debug)]
pub(super) struct Storage { pub project_id: String, pub directory: PathBuf }
pub(super) type Resolver = Arc<dyn Fn(&Scope) -> Result<Storage, String> + Send + Sync>;

impl Storage {
    pub(super) fn project(repository: &ProjectRepository, scope: &Scope) -> Result<Self, String> {
        let root = scope.root.to_str().ok_or("项目目录不是有效 UTF-8 路径。")?;
        let project_id = repository.project_id_for_root(root)?.ok_or("项目尚未登记；索引不会写入用户目录。")?;
        if scope.project_id.as_ref().is_some_and(|expected| expected != &project_id) {
            return Err("项目身份与当前目录不一致，索引未打开。".into());
        }
        let directory = repository.index_directory(root)?;
        // The catalog can change between the two repository calls; never combine two identities.
        if directory.file_name().and_then(|value| value.to_str()) != Some(project_id.as_str()) {
            return Err("项目目录绑定在解析期间发生变化，请重试。".into());
        }
        Ok(Self { project_id, directory })
    }
    pub(super) fn location(&self) -> Result<IndexLocation, String> {
        Ok(IndexLocation { project_id: self.project_id.clone(), database_url: database_url(&self.directory.join("index.db"))? })
    }
}

fn database_url(path: &Path) -> Result<String, String> {
    if !path.is_absolute() { return Err("索引数据库必须位于原生解析的应用数据目录。".into()); }
    let path = path.to_str().ok_or("索引路径不是有效 UTF-8。")?;
    let path = if let Some(unc) = path.strip_prefix("\\\\?\\UNC\\") { format!("//{unc}") }
        else { path.strip_prefix("\\\\?\\").unwrap_or(path).to_owned() };
    Ok(format!("sqlite:{}", path.replace('\\', "/")))
}

#[cfg(test)]
pub(super) fn fixture(scope: &Scope) -> Result<Storage, String> {
    // Existing actor tests inject a private fixture app-data sibling, never a production fallback.
    let base = scope.root.parent().ok_or("fixture has no owner directory")?;
    Ok(Storage { project_id: "fixture-project".into(), directory: base.join("app-data/indexes/fixture-project") })
}
