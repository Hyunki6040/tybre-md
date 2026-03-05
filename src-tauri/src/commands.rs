use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

/// Read file contents as UTF-8 string
#[command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write content to a file (creates if not exists)
#[command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Create a new empty file
#[command]
pub fn create_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, "").map_err(|e| e.to_string())
}

/// Delete a file
#[command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

/// Rename/move a file or directory
#[command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

/// Open a folder and return its recursive file tree
#[command]
pub fn open_folder(path: String) -> Result<FileEntry, String> {
    build_file_tree(&path)
}

/// List directory contents (non-recursive)
#[command]
pub fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files
        if name.starts_with('.') {
            continue;
        }
        let full_path = entry.path().to_string_lossy().to_string();
        let is_dir = entry.path().is_dir();
        result.push(FileEntry {
            name,
            path: full_path,
            is_dir,
            children: None,
        });
    }

    // Sort: directories first, then alphabetically
    result.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    Ok(result)
}

fn build_file_tree(path: &str) -> Result<FileEntry, String> {
    let p = Path::new(path);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    if p.is_dir() {
        let mut children = Vec::new();
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden files and common build directories
                if entry_name.starts_with('.')
                    || entry_name == "node_modules"
                    || entry_name == "target"
                {
                    continue;
                }
                let child_path = entry.path().to_string_lossy().to_string();
                if let Ok(child) = build_file_tree(&child_path) {
                    children.push(child);
                }
            }
        }
        // Sort: directories first, then alphabetically
        children.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
        });

        Ok(FileEntry {
            name,
            path: path.to_string(),
            is_dir: true,
            children: Some(children),
        })
    } else {
        Ok(FileEntry {
            name,
            path: path.to_string(),
            is_dir: false,
            children: None,
        })
    }
}
