use super::{io, types::{Ownership, Snapshot, StoredSession, Ticket, TicketEntry}, Lease, ProjectRepository, State};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

const MARKER: &str = ".ticket.json";
const LEASE_LIMIT: Duration = Duration::from_secs(120);
fn key(id: Option<&str>) -> Result<String, String> { match id { Some(id) => { io::uuid(id)?; Ok(id.into()) }, None => Ok("scratch".into()) } }
fn content_file(value: &str) -> Result<(&str, &str), String> {
    let fields: Vec<_> = value.split('/').collect();
    if fields.len() != 3 || fields[0] != "versions" { return Err("快照正文引用不属于不可变版本目录。".into()); }
    let document = fields[2].strip_suffix(".txt").ok_or("快照正文扩展名无效。")?;
    io::uuid(fields[1])?; io::uuid(document)?;
    Ok((fields[1], document))
}
fn shape(snapshot: &Snapshot) -> Result<(), String> {
    if snapshot.version != 1 { return Err("项目会话版本不受支持，原件已保留。".into()); }
    if snapshot.revision > io::SAFE_INTEGER || snapshot.documents.len() > 128 { return Err("项目会话修订或文档数量超出支持范围。".into()); }
    if !["standard", "academic", "creative"].contains(&snapshot.mode.as_str()) { return Err("项目写作模式无效。".into()); }
    io::text(&snapshot.active_tool, 64, "项目活动工具")?;
    if snapshot.layouts.len() != 3 { return Err("项目布局缺少写作模式。".into()); }
    for mode in ["standard", "academic", "creative"] {
        let layout = snapshot.layouts.get(mode).ok_or("项目布局缺少写作模式。")?;
        if !layout.sidebar_width.is_finite() || !layout.right_panel_width.is_finite()
            || !(0.0..=4096.0).contains(&layout.sidebar_width) || !(0.0..=4096.0).contains(&layout.right_panel_width) {
            return Err("项目布局宽度无效。".into());
        }
    }
    let (mut keys, mut paths) = (HashSet::new(), HashSet::new());
    for document in &snapshot.documents {
        io::uuid(&document.key)?;
        io::text(&document.name, 1024, "文档名称")?;
        io::text(&document.path, 32768, "文档路径")?;
        let (_, file_key) = content_file(&document.content_file)?;
        if file_key != document.key || !keys.insert(&document.key) || !paths.insert(&document.path) { return Err("快照存在重复文档身份/路径或错配的正文引用。".into()); }
        if document.draft {
            if document.external || !document.path.starts_with("draft://") || document.path.len() <= 8 { return Err("草稿路径或类型无效。".into()); }
        } else if document.external {
            if !Path::new(&document.path).is_absolute() { return Err("外部文档路径必须为绝对路径。".into()); }
        } else if document.path.contains('\\') || Path::new(&document.path).components().any(|part| !matches!(part, Component::Normal(_))) {
            return Err("项目文档路径必须位于内容目录内。".into());
        }
        if document.anchor > io::SAFE_INTEGER || document.head > io::SAFE_INTEGER || !document.scroll_top.is_finite() || document.scroll_top < 0.0 {
            return Err("文档选区或滚动位置无效。".into());
        }
        if document.render_mode.as_deref().is_some_and(|mode| !["source", "live"].contains(&mode)) { return Err("文档渲染模式无效。".into()); }
    }
    if snapshot.active_path.as_ref().is_some_and(|path| !snapshot.documents.iter().any(|document| &document.path == path)) { return Err("活动文档不在快照内。".into()); }
    io::encoded(snapshot)?;
    Ok(())
}
fn references(snapshot: Option<&Snapshot>) -> HashSet<String> {
    snapshot.map(|snapshot| snapshot.documents.iter().map(|document| document.content_file.clone()).collect()).unwrap_or_default()
}
/// Preserved originals are recovery inputs too. An unreadable/unknown original
/// prevents confident reference discovery, so retain this session's old versions.
fn preserved_references(root: &Path) -> Option<HashSet<String>> {
    let deadline = Instant::now() + Duration::from_millis(250);
    let entries = fs::read_dir(root).ok()?;
    let mut kept = HashSet::new();
    for (index, entry) in entries.enumerate() {
        if index >= 1024 || Instant::now() >= deadline { return None; }
        let entry = entry.ok()?;
        let name = entry.file_name();
        let name = name.to_str()?;
        if !name.starts_with("session.json.preserved-") && !name.starts_with("session.backup.json.preserved-") { continue; }
        let snapshot = io::json::<Snapshot>(&entry.path()).ok()??;
        shape(&snapshot).ok()?;
        kept.extend(references(Some(&snapshot)));
    }
    Some(kept)
}
fn validate_bodies(repository: &ProjectRepository, root: &Path, snapshot: &Snapshot, deadline: Option<Instant>) -> Result<(), String> {
    shape(snapshot)?;
    for document in &snapshot.documents {
        let path = version_reference(root, &document.content_file)?;
        let units = repository.body_length(&path, deadline, false)?;
        if document.anchor > units || document.head > units { return Err("文档选区超出其完整正文，快照未接受。".into()); }
    }
    Ok(())
}

fn version_reference(root: &Path, value: &str) -> Result<PathBuf, String> {
    let (token, key) = content_file(value)?;
    let path = io::relative(root, value)?;
    let marker_path = io::relative(root, &format!("versions/{token}/{MARKER}"))?;
    let marker = io::json::<Ownership>(&marker_path)?.ok_or("正文版本缺少归属标记，未接受未知文件。")?;
    if !valid_ownership(&marker) || marker.token != token || !root.file_name().is_some_and(|name| name == marker.project.as_str()) || !marker.keys.iter().any(|candidate| candidate == key) {
        return Err("正文版本归属与当前项目不一致。".into());
    }
    Ok(path)
}
fn valid_ownership(value: &Ownership) -> bool {
    value.version == 1 && key(if value.project == "scratch" { None } else { Some(&value.project) }).is_ok()
        && io::uuid(&value.token).is_ok() && value.keys.len() <= 128 && value.keys.iter().all(|key| io::uuid(key).is_ok())
        && value.keys.iter().collect::<HashSet<_>>().len() == value.keys.len()
        && value.expected_revision <= io::SAFE_INTEGER && value.created_at <= io::SAFE_INTEGER
}

impl ProjectRepository {
    fn session_root(&self, id: Option<&str>, allow_removed: bool) -> Result<PathBuf, String> {
        self.ensure()?;
        let key = key(id)?;
        if let Some(id) = id {
            if !self.load_catalog()?.projects.iter().any(|record| record.id == id && (allow_removed || !record.removed)) {
                return Err("项目未登记或已移除。".into());
            }
        }
        io::directory_chain(&self.root, &["sessions", &key])
    }
    fn load_session(&self, root: &Path, bodies: bool) -> Result<Option<Snapshot>, String> {
        let value = io::json::<Snapshot>(&root.join("session.json"))?;
        if value.is_none() && root.join("session.backup.json").exists() { return Err("会话主文件缺失，备份仍保留；请显式恢复备份。".into()); }
        if let Some(snapshot) = &value {
            shape(snapshot)?;
            if bodies { validate_bodies(self, root, snapshot, Some(Instant::now() + LEASE_LIMIT))?; }
        }
        Ok(value)
    }
    pub fn session_read(&self, id: Option<String>) -> Result<StoredSession, String> {
        let _state = self.lock()?;
        let root = self.session_root(id.as_deref(), true)?;
        let snapshot = self.load_session(&root, true)?;
        Ok(StoredSession { root: io::display(&root)?, snapshot })
    }
    fn cleanup_owned(&self, directory: &Path, ownership: &Ownership) -> Result<(), String> {
        if !io::existing_directory(&self.root, directory)? { return Ok(()); }
        let marker = io::json::<Ownership>(&directory.join(MARKER))?.ok_or("快照归属标记缺失，保留全部文件。")?;
        if &marker != ownership || !valid_ownership(&marker) { return Err("快照归属不一致，保留全部文件。".into()); }
        for key in &ownership.keys {
            let file = directory.join(format!("{key}.txt"));
            if io::plain(&file, false).unwrap_or(false) { fs::remove_file(&file).map_err(|e| format!("快照临时正文清理失败：{e}"))?; }
        }
        let entries: Vec<_> = fs::read_dir(directory).map_err(|e| e.to_string())?.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
        if entries.iter().all(|entry| entry.file_name() == MARKER) {
            fs::remove_file(directory.join(MARKER)).map_err(|e| e.to_string())?;
            fs::remove_dir(directory).map_err(|e| e.to_string())?;
        }
        Ok(()) // Unknown files remain, along with their ownership marker for a later inspection.
    }
    fn expire(&self, state: &mut State, root: &Path, project: &str) {
        let scan_deadline = Instant::now() + Duration::from_millis(250);
        if state.leases.get(project).is_some_and(|lease| lease.started.elapsed() >= LEASE_LIMIT) {
            if let Some(lease) = state.leases.remove(project) { let _ = self.cleanup_owned(&root.join(".staging").join(&lease.ownership.token), &lease.ownership); }
        }
        let stage = root.join(".staging");
        if !io::plain(&stage, true).unwrap_or(false) { return; }
        let Ok(entries) = fs::read_dir(stage) else { return; };
        for entry in entries.take(1024).flatten() {
            if Instant::now() >= scan_deadline { break; }
            let directory = entry.path();
            if !io::plain(&directory, true).unwrap_or(false) { continue; }
            let Ok(Some(marker)) = io::json::<Ownership>(&directory.join(MARKER)) else { continue; };
            if valid_ownership(&marker) && marker.project == project && directory.file_name().is_some_and(|name| name == marker.token.as_str())
                && !state.leases.get(project).is_some_and(|lease| lease.ownership.token == marker.token)
                && io::now().saturating_sub(marker.created_at) >= LEASE_LIMIT.as_millis() as u64 {
                let _ = self.cleanup_owned(&directory, &marker);
            }
        }
    }
    pub fn session_begin(&self, id: Option<String>, token: String, expected_revision: u64, keys: Vec<String>, owner: String) -> Result<Ticket, String> {
        io::uuid(&token)?;
        if keys.len() > 128 || keys.iter().collect::<HashSet<_>>().len() != keys.len() || expected_revision >= io::SAFE_INTEGER { return Err("快照文档数量、重复身份或修订无效。".into()); }
        for key in &keys { io::uuid(key)?; }
        io::text(&owner, 256, "窗口身份")?;
        let project = key(id.as_deref())?;
        let mut state = self.lock()?;
        let root = self.session_root(id.as_deref(), false)?;
        self.expire(&mut state, &root, &project);
        if state.leases.contains_key(&project) { return Err("当前项目已有快照正在写入。".into()); }
        let previous = self.load_session(&root, false)?;
        if previous.as_ref().map_or(0, |snapshot| snapshot.revision) != expected_revision { return Err("项目会话修订已变化，请重新读取后保存。".into()); }
        let staging = io::directory_chain(&root, &[".staging"])?;
        let versions = io::directory_chain(&root, &["versions"])?;
        if versions.join(&token).exists() { return Err("快照 token 已发布，不能改写不可变版本。".into()); }
        let stage = staging.join(&token);
        if stage.exists() { return Err("快照 token 目录已存在，未覆盖任何文件。".into()); }
        fs::create_dir(&stage).map_err(|e| e.to_string())?;
        let ownership = Ownership { version: 1, project: project.clone(), token: token.clone(), keys: keys.clone(), owner, created_at: io::now(), expected_revision };
        io::write_new(&stage.join(MARKER), &io::encoded(&ownership)?)?;
        state.leases.insert(project, Lease { ownership, started: Instant::now() });
        Ok(Ticket { token: token.clone(), root: io::display(&stage)?, entries: keys.into_iter().map(|key| TicketEntry { path: format!("{key}.txt"), content_file: format!("versions/{token}/{key}.txt"), key }).collect() })
    }
    pub fn session_abort(&self, id: Option<String>, token: String, owner: &str) -> Result<(), String> {
        io::uuid(&token)?; let project = key(id.as_deref())?;
        let mut state = self.lock()?;
        let Some(lease) = state.leases.get(&project) else { return Ok(()); };
        if lease.ownership.token != token || lease.ownership.owner != owner { return Err("不能取消其它窗口或其它 token 的快照。".into()); }
        let lease = state.leases.remove(&project).unwrap();
        self.cleanup_owned(&self.root.join("sessions").join(&project).join(".staging").join(&token), &lease.ownership)
    }
    pub fn close_owner(&self, owner: &str) {
        let Ok(mut state) = self.lock() else { return; };
        let projects: Vec<_> = state.leases.iter().filter(|(_, lease)| lease.ownership.owner == owner).map(|(project, _)| project.clone()).collect();
        for project in projects {
            if let Some(lease) = state.leases.remove(&project) {
                let _ = self.cleanup_owned(&self.root.join("sessions").join(&project).join(".staging").join(&lease.ownership.token), &lease.ownership);
            }
        }
    }
    pub fn session_commit(&self, id: Option<String>, token: String, mut snapshot: Snapshot, owner: &str) -> Result<StoredSession, String> {
        io::uuid(&token)?; let project = key(id.as_deref())?;
        let mut state = self.lock()?;
        let lease = state.leases.get(&project).ok_or("快照租约不存在或已结束。")?;
        if lease.ownership.token != token || lease.ownership.owner != owner { return Err("不能提交其它窗口或其它 token 的快照。".into()); }
        let lease = state.leases.remove(&project).unwrap(); // An owned commit attempt consumes its ticket.
        let root = self.root.join("sessions").join(&project);
        let stage = root.join(".staging").join(&token);
        let version = root.join("versions").join(&token);
        let mut published = false;
        let result = (|| {
            let root_display = io::display(&root)?;
            self.session_root(id.as_deref(), true)?;
            if !io::existing_directory(&root, &stage)? || !io::existing_directory(&root, &root.join("versions"))? { return Err("快照目录缺失，旧会话保留。".into()); }
            let deadline = lease.started + LEASE_LIMIT;
            if Instant::now() >= deadline { return Err("快照超过 120 秒期限，旧会话保留。".into()); }
            if id.as_ref().is_some_and(|id| !self.load_catalog().is_ok_and(|catalog| catalog.projects.iter().any(|record| &record.id == id && !record.removed))) {
                return Err("项目档案已变化或不可读取，旧会话保留。".into());
            }
            let previous = self.load_session(&root, false)?;
            let expected = lease.ownership.expected_revision;
            if previous.as_ref().map_or(0, |snapshot| snapshot.revision) != expected { return Err("项目会话修订已变化，旧会话保留。".into()); }
            if snapshot.revision != expected && snapshot.revision != expected + 1 { return Err("提交快照的修订与租约不符。".into()); }
            snapshot.revision = expected + 1;
            shape(&snapshot)?;
            let marker = io::json::<Ownership>(&stage.join(MARKER))?.ok_or("快照归属标记缺失。")?;
            if marker != lease.ownership { return Err("快照归属标记已变化。".into()); }
            let keys: HashSet<_> = lease.ownership.keys.iter().map(String::as_str).collect();
            let old = references(previous.as_ref());
            let mut used = HashSet::new();
            let mut lengths = HashMap::new();
            for document in &snapshot.documents {
                let (version_token, file_key) = content_file(&document.content_file)?;
                let path = if version_token == token && keys.contains(file_key) {
                    used.insert(file_key.to_string()); io::relative(&stage, &format!("{file_key}.txt"))?
                } else if old.contains(&document.content_file) { version_reference(&root, &document.content_file)? }
                else { return Err("正文引用不属于本次 ticket 或此前会话，旧会话保留。".into()); };
                let units = self.body_length(&path, Some(deadline), version_token == token)?;
                if document.anchor > units || document.head > units { return Err("文档选区超出正文，旧会话保留。".into()); }
                lengths.insert(document.content_file.clone(), units);
            }
            if let Some(previous) = &previous {
                for document in &previous.documents {
                    let units = match lengths.get(&document.content_file) {
                        Some(units) => *units,
                        None => self.body_length(&version_reference(&root, &document.content_file)?, Some(deadline), false)?,
                    };
                    if document.anchor > units || document.head > units { return Err("此前会话的正文或选区已损坏，旧原件保留。".into()); }
                }
            }
            if used.len() != keys.len() { return Err("ticket 中有未使用或未完整登记的新正文，旧会话保留。".into()); }
            for entry in fs::read_dir(&stage).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name();
                if name == MARKER { continue; }
                let name = name.to_str().ok_or("staging 含未知文件，未发布。")?;
                if !name.strip_suffix(".txt").is_some_and(|key| keys.contains(key)) { return Err("staging 含未登记文件或仍在写入的 Raw 临时文件，未发布。".into()); }
            }
            let backup_path = root.join("session.backup.json");
            let old_backup = match io::json::<Snapshot>(&backup_path) {
                Ok(Some(backup)) if validate_bodies(self, &root, &backup, Some(deadline)).is_ok() => Some(backup),
                Ok(None) => None,
                _ => { io::preserve(&backup_path)?; None },
            };
            if Instant::now() >= deadline { return Err("快照超过 120 秒期限，旧会话保留。".into()); }
            crate::files::exclusive_move::rename_new(&stage, &version)?;
            published = true;
            if let Ok(mut cache) = self.body_cache.lock() { cache.publish(&stage, &version); }
            if Instant::now() >= deadline { return Err("快照超过 120 秒期限，旧会话保留。".into()); }
            // Every body is immutable and complete before either manifest may name it.
            io::atomic(&backup_path, previous.as_ref().unwrap_or(&snapshot))?;
            io::atomic(&root.join("session.json"), &snapshot)?;
            // Nothing after the manifest's publish point may turn success into a fake failure.
            if let Some(mut keep) = preserved_references(&root) {
                keep.extend(references(Some(&snapshot)));
                keep.extend(references(previous.as_ref().or(Some(&snapshot))));
                for candidate in references(old_backup.as_ref()).difference(&keep) {
                    if let Ok(path) = version_reference(&root, candidate) { let _ = fs::remove_file(path); }
                }
                self.remove_empty_version(&version);
                if let Some(backup) = old_backup { for file in references(Some(&backup)) { if let Ok((token, _)) = content_file(&file) { self.remove_empty_version(&root.join("versions").join(token)); } } }
            }
            Ok(StoredSession { root: root_display, snapshot: Some(snapshot.clone()) })
        })();
        if result.is_err() {
            // A first-save backup may already reference the complete new version.
            // Never remove bodies referenced by either readable manifest after an error.
            let referenced = ["session.json", "session.backup.json"].iter().any(|name| {
                io::json::<Snapshot>(&root.join(name)).ok().flatten().is_some_and(|snapshot| snapshot.documents.iter().any(|document| document.content_file.starts_with(&format!("versions/{token}/"))))
            });
            let protected = preserved_references(&root).is_none_or(|references| references.iter().any(|reference| reference.starts_with(&format!("versions/{token}/"))));
            if !published || (!referenced && !protected) { let _ = self.cleanup_owned(if published { &version } else { &stage }, &lease.ownership); }
        }
        result
    }
    fn remove_empty_version(&self, directory: &Path) {
        if !io::existing_directory(&self.root, directory).unwrap_or(false) { return; }
        let Ok(Some(marker)) = io::json::<Ownership>(&directory.join(MARKER)) else { return; };
        if !valid_ownership(&marker) || !directory.file_name().is_some_and(|name| name == marker.token.as_str()) { return; }
        let Ok(entries) = fs::read_dir(directory) else { return; };
        if entries.into_iter().all(|entry| entry.is_ok_and(|entry| entry.file_name() == MARKER)) {
            let _ = fs::remove_file(directory.join(MARKER)); let _ = fs::remove_dir(directory);
        }
    }
    pub fn restore_backup(&self, id: Option<String>, kind: &str) -> Result<(), String> {
        let state = self.lock()?;
        let project = key(id.as_deref())?;
        if state.leases.contains_key(&project) || (kind == "catalog" && !state.leases.is_empty()) { return Err("项目仍有快照写入，请先等待或取消。".into()); }
        self.ensure()?;
        match kind {
            "catalog" => {
                let backup = io::json::<super::ProjectCatalog>(&self.root.join("catalog.backup.json"))?.ok_or("没有可恢复的项目档案备份。")?;
                self.validate_catalog(&backup)?;
                let target = self.root.join("catalog.json"); io::preserve(&target)?; io::atomic(&target, &backup)
            }
            "session" => {
                let root = self.session_root(id.as_deref(), true)?;
                let backup = io::json::<Snapshot>(&root.join("session.backup.json"))?.ok_or("没有可恢复的会话备份。")?;
                validate_bodies(self, &root, &backup, Some(Instant::now() + LEASE_LIMIT))?;
                let target = root.join("session.json"); io::preserve(&target)?; io::atomic(&target, &backup)
            }
            _ => Err("备份类型必须是 catalog 或 session。".into()),
        }
    }
}
