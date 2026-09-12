use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRecord {
    pub id: String, pub root: String, pub name: String, pub favorite: bool,
    pub cover: Option<String>, pub created_at: u64, pub last_opened_at: u64, pub removed: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectCatalog { pub version: u32, pub active_id: Option<String>, pub projects: Vec<ProjectRecord> }
impl Default for ProjectCatalog {
    fn default() -> Self { Self { version: 1, active_id: None, projects: Vec::new() } }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub key: String, pub path: String, pub name: String, pub external: bool, pub draft: bool,
    pub dirty: bool, pub content_file: String, pub anchor: u64, pub head: u64,
    pub scroll_top: f64, pub render_mode: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    pub sidebar_width: f64, pub right_panel_width: f64,
    pub sidebar_collapsed: bool, pub right_panel_collapsed: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub version: u32, pub revision: u64, pub documents: Vec<Document>,
    pub active_path: Option<String>, pub mode: String, pub layouts: BTreeMap<String, Layout>, pub active_tool: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession { pub root: String, pub snapshot: Option<Snapshot> }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket { pub token: String, pub root: String, pub entries: Vec<TicketEntry> }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketEntry { pub key: String, pub path: String, pub content_file: String }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Ownership {
    pub version: u32, pub project: String, pub token: String, pub keys: Vec<String>,
    pub owner: String, pub created_at: u64, pub expected_revision: u64,
}
