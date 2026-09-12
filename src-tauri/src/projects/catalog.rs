use super::{io, types::ProjectCatalog, types::ProjectRecord, ProjectRepository};
use std::collections::HashSet;
use std::path::Path;

impl ProjectRepository {
    pub(super) fn validate_catalog(&self, value: &ProjectCatalog) -> Result<(), String> {
        if value.version != 1 { return Err("项目档案版本不受支持，原件已保留。".into()); }
        let mut ids = HashSet::new();
        let mut roots = HashSet::new();
        for record in &value.projects {
            io::uuid(&record.id)?;
            io::text(&record.name, 256, "项目名称")?;
            if !Path::new(&record.root).is_absolute() || record.root.contains('\0') || record.created_at > io::SAFE_INTEGER || record.last_opened_at > io::SAFE_INTEGER {
                return Err("项目档案含无效路径或时间，原件已保留。".into());
            }
            if !ids.insert(&record.id) || !roots.insert(io::identity(&record.root)) { return Err("项目档案有重复身份或目录，原件已保留。".into()); }
            if let Some(cover) = &record.cover {
                let cover = Path::new(cover);
                if cover.parent() != Some(self.root.join("covers").join(&record.id).as_path()) { return Err("封面路径不属于当前项目。".into()); }
            }
        }
        if value.active_id.as_ref().is_some_and(|id| !value.projects.iter().any(|record| &record.id == id && !record.removed)) {
            return Err("上次活动项目身份无效，原件已保留。".into());
        }
        io::encoded(value)?;
        Ok(())
    }
    pub(super) fn load_catalog(&self) -> Result<ProjectCatalog, String> {
        self.ensure()?;
        let path = self.root.join("catalog.json");
        match io::json::<ProjectCatalog>(&path)? {
            Some(value) => { self.validate_catalog(&value)?; Ok(value) },
            None if self.root.join("catalog.backup.json").exists() => Err("项目档案主文件缺失，备份仍保留；请显式恢复备份。".into()),
            None => Ok(ProjectCatalog::default()),
        }
    }
    fn save_catalog(&self, before: &ProjectCatalog, next: &ProjectCatalog) -> Result<(), String> {
        self.validate_catalog(next)?;
        let backup = self.root.join("catalog.backup.json");
        if io::plain(&backup, false)? && io::json::<ProjectCatalog>(&backup).and_then(|value| value.ok_or_else(|| "备份缺失".into())).and_then(|value| self.validate_catalog(&value)).is_err() {
            io::preserve(&backup)?;
        }
        let initial = !self.root.join("catalog.json").exists();
        io::atomic(&backup, if initial { next } else { before })?;
        io::atomic(&self.root.join("catalog.json"), next)
    }
    pub fn catalog_get(&self) -> Result<ProjectCatalog, String> { let _state = self.lock()?; self.load_catalog() }
    pub fn register(&self, id: String, root: String, name: String) -> Result<ProjectRecord, String> {
        io::uuid(&id)?; io::text(&name, 256, "项目名称")?;
        let canonical = io::canonical_directory(&root)?;
        let _state = self.lock()?;
        let before = self.load_catalog()?;
        let mut next = before.clone();
        let record = if let Some(record) = next.projects.iter_mut().find(|record| io::identity(&record.root) == io::identity(&canonical)) {
            record.removed = false;
            record.clone()
        } else {
            if next.projects.iter().any(|record| record.id == id) { return Err("项目身份已登记到其它目录，请使用重新定位。".into()); }
            let record = ProjectRecord { id, root: canonical, name: name.trim().into(), favorite: false, cover: None, created_at: io::now(), last_opened_at: 0, removed: false };
            next.projects.push(record.clone()); record
        };
        if before != next { self.save_catalog(&before, &next)?; }
        Ok(record)
    }
    pub fn update(&self, id: String, name: Option<String>, favorite: Option<bool>) -> Result<ProjectRecord, String> {
        io::uuid(&id)?;
        if let Some(name) = &name { io::text(name, 256, "项目名称")?; }
        let _state = self.lock()?;
        let before = self.load_catalog()?; let mut next = before.clone();
        let record = next.projects.iter_mut().find(|record| record.id == id).ok_or("项目未登记。")?;
        if let Some(name) = name { record.name = name.trim().into(); }
        if let Some(favorite) = favorite { record.favorite = favorite; }
        let result = record.clone();
        self.save_catalog(&before, &next)?; Ok(result)
    }
    pub fn relocate(&self, id: String, root: String) -> Result<ProjectRecord, String> {
        io::uuid(&id)?; let root = io::canonical_directory(&root)?;
        let _state = self.lock()?;
        let before = self.load_catalog()?; let mut next = before.clone();
        if next.projects.iter().any(|record| record.id != id && io::identity(&record.root) == io::identity(&root)) { return Err("此目录已经属于另一个已登记项目。".into()); }
        let record = next.projects.iter_mut().find(|record| record.id == id).ok_or("项目未登记。")?;
        record.root = root; let result = record.clone();
        self.save_catalog(&before, &next)?; Ok(result)
    }
    pub fn remove(&self, id: String) -> Result<ProjectCatalog, String> {
        io::uuid(&id)?; let _state = self.lock()?;
        let before = self.load_catalog()?; let mut next = before.clone();
        if next.active_id.as_deref() == Some(id.as_str()) { return Err("请先保存并切离活动项目，再从档案中移除。".into()); }
        next.projects.iter_mut().find(|record| record.id == id).ok_or("项目未登记。")?.removed = true;
        self.save_catalog(&before, &next)?; Ok(next)
    }
    pub fn activate(&self, id: Option<String>) -> Result<ProjectCatalog, String> {
        if let Some(id) = &id { io::uuid(id)?; }
        let _state = self.lock()?;
        let before = self.load_catalog()?; let mut next = before.clone();
        if let Some(id) = &id {
            let record = next.projects.iter_mut().find(|record| &record.id == id && !record.removed).ok_or("项目未登记或已移除。")?;
            record.last_opened_at = io::now();
        }
        next.active_id = id; self.save_catalog(&before, &next)?; Ok(next)
    }
    pub fn import_cover(&self, id: String, path: String) -> Result<ProjectRecord, String> {
        io::uuid(&id)?;
        let source = Path::new(&path);
        if !source.is_absolute() { return Err("封面必须来自绝对文件路径。".into()); }
        let extension = source.extension().and_then(|extension| extension.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") { return Err("封面仅支持 PNG、JPEG、WebP。".into()); }
        let resolved = source.canonicalize().map_err(|e| format!("无法读取封面：{e}"))?;
        let bytes = io::read(&resolved, 8 * 1024 * 1024)?.ok_or("封面文件不存在。")?;
        let valid = match extension.as_str() {
            "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
            _ => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WEBP"[..]),
        };
        if !valid { return Err("封面内容与声明的图像格式不符。".into()); }
        let _state = self.lock()?;
        let before = self.load_catalog()?; let mut next = before.clone();
        let record = next.projects.iter_mut().find(|record| record.id == id).ok_or("项目未登记。")?;
        let directory = io::directory_chain(&self.root, &["covers", &id])?;
        let destination = directory.join(format!("cover-{}.{}", io::nonce(), extension));
        io::write_new(&destination, &bytes)?;
        record.cover = Some(io::display(&destination)?);
        let result = record.clone();
        if let Err(error) = self.save_catalog(&before, &next) { let _ = std::fs::remove_file(&destination); return Err(error); }
        Ok(result)
    }
    pub(crate) fn project_id_for_root(&self, root: &str) -> Result<Option<String>, String> {
        let canonical = io::canonical_directory(root)?; let _state = self.lock()?;
        Ok(self.load_catalog()?.projects.into_iter().find(|record| !record.removed && io::identity(&record.root) == io::identity(&canonical)).map(|record| record.id))
    }
    pub(crate) fn index_directory(&self, root: &str) -> Result<std::path::PathBuf, String> {
        let id = self.project_id_for_root(root)?.ok_or("项目尚未登记，索引未写入内容目录。")?;
        let _state = self.lock()?;
        io::directory_chain(&self.app_data, &["indexes", &id])
    }
}
