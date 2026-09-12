use crate::path_guard::resolve_new_target_in_root;
use std::io::Write;
use std::path::Path;

/// Small text templates use exclusive creation, never the replace-existing save path.
#[tauri::command]
pub async fn create_text_file(root: String, path: String, content: String) -> Result<(), String> {
    if content.len() > 65_536 {
        return Err("新建条目内容超过 64 KiB，请在编辑器中追加正文".into());
    }
    tauri::async_runtime::spawn_blocking(move || create(&root, &path, &content))
        .await.map_err(|error| format!("创建任务失败: {error}"))?
}

fn create(root: &str, path: &str, content: &str) -> Result<(), String> {
    let root = Path::new(root).canonicalize().map_err(|error| format!("无法解析工作区: {error}"))?;
    let target = resolve_new_target_in_root(&root, path)?;
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&target)
        .map_err(|error| format!("无法创建条目: {error}"))?;
    let result = file.write_all(content.as_bytes()).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let cleanup = std::fs::remove_file(&target);
        return Err(format!("条目未能写入: {error}{}", if cleanup.is_err() { "；请检查未完成的新文件" } else { "" }));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_unicode_entry_is_exclusive_and_stays_inside_its_workspace() {
        let root = std::env::temp_dir().join(format!("inkstream-codex-create-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(root.join("Codex")).unwrap();
        let path = root.to_string_lossy().into_owned();
        let text = "---\ntype: character\nname: 林深\n---\n\n原始正文 😀\n";
        tauri::async_runtime::block_on(create_text_file(path.clone(), "Codex/林深.md".into(), text.into())).unwrap();
        assert!(tauri::async_runtime::block_on(create_text_file(path.clone(), "Codex/林深.md".into(), "替换".into())).is_err());
        assert_eq!(std::fs::read_to_string(root.join("Codex/林深.md")).unwrap(), text);
        assert!(tauri::async_runtime::block_on(create_text_file(path.clone(), "../outside.md".into(), "越界".into())).is_err());
        assert!(tauri::async_runtime::block_on(create_text_file(path, "Codex/too-big.md".into(), "x".repeat(65_537))).is_err());
        assert!(!root.join("Codex/too-big.md").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
