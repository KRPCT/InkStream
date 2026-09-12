use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RebaseAction {
    Start { upstream: String }, Continue, Skip, Abort,
    #[serde(rename = "commit-continue")]
    CommitContinue { commit: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RebaseOutcome { Completed, Paused, Aborted, Failed, Cancelled }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RebaseSource { Application, Existing }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStatus {
    pub in_progress: bool,
    pub head_oid: Option<String>,
    pub branch: Option<String>,
    pub original_head: Option<String>,
    pub onto: Option<String>,
    pub current_commit: Option<String>,
    pub step: Option<u32>,
    pub total: Option<u32>,
    pub conflicts: Vec<String>,
    pub needs_commit: bool,
    /// Existing includes operations started outside this process or in an earlier application session.
    pub source: Option<RebaseSource>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseResult {
    pub outcome: RebaseOutcome,
    pub status: RebaseStatus,
    pub error: Option<String>,
}
