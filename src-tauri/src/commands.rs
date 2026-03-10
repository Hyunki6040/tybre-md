use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::command;

/// Managed state: file path passed at launch (double-click / OS file association)
pub struct StartupFile(pub Mutex<Option<String>>);

#[command]
pub fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

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

    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(result)
}

/// Native folder picker dialog (rfd — no Tauri plugin needed)
#[command]
pub fn pick_folder() -> Result<Option<String>, String> {
    let result = rfd::FileDialog::new().pick_folder();
    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

/// Native save-file dialog for "Save As"
#[command]
pub fn pick_save_path(default_name: String) -> Result<Option<String>, String> {
    let result = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .save_file();
    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

// ── Project indexing & caching ────────────────────────────────────────────────

/// Returns ~/.tybre, creating it if needed
fn tybre_cache_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = std::path::Path::new(&home).join(".tybre");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn save_projects_cache(projects: &[String]) {
    if let Some(dir) = tybre_cache_dir() {
        if let Ok(json) = serde_json::to_string_pretty(projects) {
            let _ = fs::write(dir.join("projects.json"), json);
        }
    }
}

/// Return the on-disk cached project list (instant — no scanning)
#[command]
pub fn load_cached_projects() -> Vec<String> {
    let Some(dir) = tybre_cache_dir() else { return Vec::new() };
    let Ok(contents) = fs::read_to_string(dir.join("projects.json")) else { return Vec::new() };
    serde_json::from_str::<Vec<String>>(&contents).unwrap_or_default()
}

/// Recursively scan `root` up to `depth` levels for directories containing `.claude`
fn scan_dir_for_claude(root: &Path, depth: u8, found: &mut Vec<String>) {
    if depth == 0 { return; }
    let Ok(entries) = fs::read_dir(root) else { return };
    let mut count = 0u32;
    for entry in entries.flatten() {
        if count >= 400 { break; } // guard against huge directories
        count += 1;
        let p = entry.path();
        if !p.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden dirs and large build/dep directories
        if name.starts_with('.') || matches!(
            name.as_str(),
            "node_modules" | "target" | "vendor" | ".git" | "dist" | "build" | "__pycache__"
        ) {
            continue;
        }
        if p.join(".claude").exists() {
            found.push(p.to_string_lossy().to_string());
        }
        if depth > 1 {
            scan_dir_for_claude(&p, depth - 1, found);
        }
    }
}

/// Full scan: walk common user directories, save cache, return results.
/// Frontend should call `load_cached_projects` first for instant results, then call
/// this in the background to refresh.
#[command]
pub fn scan_claude_projects() -> Result<Vec<String>, String> {
    let home = std::env::var("HOME").unwrap_or_default();

    // Common dev directory names to scan as explicit roots (depth 2 each).
    // Also scan home itself with depth 3 to catch ~/X/Y/project patterns.
    let extra_names = [
        "Develop", "Developer", "Development",
        "dev", "src", "code", "coding",
        "Projects", "projects",
        "workspace", "Workspace",
        "repos", "github", "gitlab",
        "work", "Work",
        "IdeaProjects", "AndroidStudioProjects",
    ];

    let mut found = Vec::new();

    // Scan home 3 levels deep: ~/A/B/project is reachable
    let home_path = Path::new(&home);
    if home_path.exists() {
        if home_path.join(".claude").exists() {
            found.push(home.clone());
        }
        scan_dir_for_claude(home_path, 3, &mut found);
    }

    // Extra named roots — scan 2 levels each so ~/Develop/year/project is found
    // even if they weren't fully covered by the home pass (dedup handles overlaps)
    for name in &extra_names {
        let root_str = format!("{}/{}", home, name);
        let root = Path::new(&root_str);
        if !root.exists() { continue; }
        if root.join(".claude").exists() {
            found.push(root_str.clone());
        }
        scan_dir_for_claude(root, 2, &mut found);
    }

    found.sort();
    found.dedup();

    // Sort by directory modification time — newest first (= most recently worked on)
    found.sort_by(|a, b| {
        let mtime = |p: &str| {
            fs::metadata(p)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH)
        };
        mtime(b).cmp(&mtime(a))
    });

    save_projects_cache(&found);
    Ok(found)
}

// ── Full-text search ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchMatch {
    pub path: String,
    pub relative_path: String,
    pub line_num: usize,
    pub line_text: String,
}

/// Search for a text query across all .md files under root (case-insensitive, max 200 results)
#[command]
pub fn search_files(root: String, query: String) -> Result<Vec<SearchMatch>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut results = Vec::new();
    let q = query.to_lowercase();
    search_dir_for_text(&root, &root, &q, &mut results);
    Ok(results)
}

fn search_dir_for_text(root: &str, dir: &str, query: &str, results: &mut Vec<SearchMatch>) {
    if results.len() >= 200 { return; }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if results.len() >= 200 { return; }
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        if matches!(name.as_str(), "node_modules" | "target" | "dist" | "build" | ".git") {
            continue;
        }
        if p.is_dir() {
            search_dir_for_text(root, &p.to_string_lossy(), query, results);
        } else if name.ends_with(".md") || name.ends_with(".txt") || name.ends_with(".markdown") {
            let Ok(content) = fs::read_to_string(&p) else { continue };
            let path_str = p.to_string_lossy().to_string();
            let rel = path_str
                .strip_prefix(root)
                .unwrap_or(&path_str)
                .trim_start_matches('/')
                .to_string();
            for (i, line) in content.lines().enumerate() {
                if results.len() >= 200 { return; }
                if line.to_lowercase().contains(query) {
                    results.push(SearchMatch {
                        path: path_str.clone(),
                        relative_path: rel.clone(),
                        line_num: i + 1,
                        line_text: line.trim().to_string(),
                    });
                }
            }
        }
    }
}


// ── Session persistence ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowSession {
    pub is_main: bool,
    pub project_path: Option<String>,
    pub open_files: Vec<String>,
    pub active_file: Option<String>,
}

fn session_file() -> Option<std::path::PathBuf> {
    tybre_cache_dir().map(|d| d.join("session.json"))
}

fn read_sessions_raw() -> Vec<WindowSession> {
    let Some(path) = session_file() else { return Vec::new() };
    let Ok(contents) = fs::read_to_string(&path) else { return Vec::new() };
    serde_json::from_str::<Vec<WindowSession>>(&contents).unwrap_or_default()
}

fn write_sessions_raw(sessions: &[WindowSession]) {
    let Some(path) = session_file() else { return };
    if let Ok(json) = serde_json::to_string_pretty(sessions) {
        let _ = fs::write(path, json);
    }
}

/// Load saved window sessions, skipping entries whose project folder no longer exists.
#[command]
pub fn load_session() -> Vec<WindowSession> {
    read_sessions_raw()
        .into_iter()
        .filter(|s| {
            s.project_path
                .as_ref()
                .map_or(true, |p| Path::new(p).exists())
        })
        .collect()
}

/// Upsert a window's session entry. Identified by `is_main` (for the main window)
/// or by `project_path` (for project windows).
#[command]
pub fn update_window_session(
    is_main: bool,
    project_path: Option<String>,
    open_files: Vec<String>,
    active_file: Option<String>,
) -> Result<(), String> {
    let mut sessions = read_sessions_raw();
    let entry = WindowSession {
        is_main,
        project_path: project_path.clone(),
        open_files,
        active_file,
    };
    let pos = if is_main {
        sessions.iter().position(|s| s.is_main)
    } else {
        sessions
            .iter()
            .position(|s| !s.is_main && s.project_path == project_path)
    };
    match pos {
        Some(idx) => sessions[idx] = entry,
        None => sessions.push(entry),
    }
    write_sessions_raw(&sessions);
    Ok(())
}

/// Remove a window's session entry (called when the window is explicitly closed by the user).
#[command]
pub fn remove_window_session(is_main: bool, project_path: Option<String>) -> Result<(), String> {
    let mut sessions = read_sessions_raw();
    if is_main {
        sessions.retain(|s| !s.is_main);
    } else {
        sessions.retain(|s| s.is_main || s.project_path != project_path);
    }
    write_sessions_raw(&sessions);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

/// Check if the `claude` CLI is available in PATH
#[command]
pub fn check_claude_installed() -> bool {
    std::process::Command::new("which")
        .arg("claude")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Reveal a file or directory in Finder (macOS: open -R)
#[command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── App config directory (platform-standard) ──────────────────────────────────

fn app_config_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        let dir = Path::new(&home).join("Library/Application Support/Tybre");
        fs::create_dir_all(&dir).ok()?;
        Some(dir)
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        let dir = Path::new(&appdata).join("Tybre");
        fs::create_dir_all(&dir).ok()?;
        Some(dir)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let home = std::env::var("HOME").ok()?;
        let dir = Path::new(&home).join(".config/Tybre");
        fs::create_dir_all(&dir).ok()?;
        Some(dir)
    }
}

/// Returns a rough ISO 8601 UTC timestamp without external crates.
fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    fn is_leap(y: u64) -> bool { y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) }

    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let mut days = secs / 86400;
    let mut y = 1970u64;
    loop {
        let diy = if is_leap(y) { 366 } else { 365 };
        if days < diy { break; }
        days -= diy;
        y += 1;
    }
    let months: [u64; 12] = [31, if is_leap(y) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut mo = 1u64;
    for mdays in &months {
        if days < *mdays { break; }
        days -= mdays;
        mo += 1;
    }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, days + 1, h, m, s)
}

// ── Global config ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ShortcutStats {
    pub used: HashMap<String, u32>,
    pub mouse: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlobalConfig {
    pub language: String,
    pub theme: String,
    pub font_size: u8,
    pub auto_save: bool,
    pub custom_shortcuts: HashMap<String, String>,
    pub guide_mode: bool,
    pub shortcut_stats: ShortcutStats,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        GlobalConfig {
            language: "en".to_string(),
            theme: "system".to_string(),
            font_size: 16,
            auto_save: true,
            custom_shortcuts: HashMap::new(),
            guide_mode: false,
            shortcut_stats: ShortcutStats::default(),
        }
    }
}

#[command]
pub fn load_global_config() -> GlobalConfig {
    let Some(dir) = app_config_dir() else { return GlobalConfig::default() };
    let Ok(contents) = fs::read_to_string(dir.join("config.json")) else { return GlobalConfig::default() };
    match serde_json::from_str::<GlobalConfig>(&contents) {
        Ok(cfg) => cfg,
        Err(e) => {
            eprintln!("[tybre] config.json parse error: {e} — using defaults");
            GlobalConfig::default()
        }
    }
}

#[command]
pub fn save_global_config(config: GlobalConfig) -> Result<(), String> {
    let Some(dir) = app_config_dir() else { return Err("cannot resolve config dir".into()) };
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(dir.join("config.json"), json).map_err(|e| e.to_string())
}

// ── Recent projects ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened: String,
}

#[command]
pub fn load_recent_projects() -> Vec<RecentProject> {
    let Some(dir) = app_config_dir() else { return Vec::new() };
    let Ok(contents) = fs::read_to_string(dir.join("recent-projects.json")) else { return Vec::new() };
    serde_json::from_str::<Vec<RecentProject>>(&contents).unwrap_or_default()
}

#[command]
pub fn add_recent_project(path: String, name: String) -> Result<(), String> {
    let Some(dir) = app_config_dir() else { return Err("cannot resolve config dir".into()) };
    let mut projects = load_recent_projects();
    projects.retain(|p| p.path != path);
    projects.insert(0, RecentProject { path, name, last_opened: iso_now() });
    projects.truncate(20);
    let json = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;
    fs::write(dir.join("recent-projects.json"), json).map_err(|e| e.to_string())
}

// ── Project workspace ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceState {
    pub sidebar_open: bool,
    pub sidebar_width: u32,
    pub memo_open: bool,
    pub memo_width: u32,
    // Terminal per-project settings — absent in old files, falls back to false via #[serde(default)]
    #[serde(default)]
    pub term_auto_claude: bool,
    #[serde(default)]
    pub term_yolo_mode: bool,
    #[serde(default)]
    pub terminal_open: bool,
    #[serde(default = "default_terminal_width")]
    pub terminal_width: u32,
    #[serde(default)]
    pub term_pre_command_enabled: bool,
    #[serde(default)]
    pub term_pre_command: String,
}

fn default_terminal_width() -> u32 { 0 }

impl Default for WorkspaceState {
    fn default() -> Self {
        WorkspaceState {
            sidebar_open: true,
            sidebar_width: 240,
            memo_open: false,
            memo_width: 280,
            term_auto_claude: false,
            term_yolo_mode: false,
            terminal_open: false,
            terminal_width: 0,
            term_pre_command_enabled: false,
            term_pre_command: String::new(),
        }
    }
}

fn project_tybre_dir(project_path: &str) -> Option<std::path::PathBuf> {
    let dir = Path::new(project_path).join(".tybre");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

#[command]
pub fn load_workspace(project_path: String) -> WorkspaceState {
    let Some(dir) = project_tybre_dir(&project_path) else { return WorkspaceState::default() };
    let Ok(contents) = fs::read_to_string(dir.join("workspace.json")) else { return WorkspaceState::default() };
    match serde_json::from_str::<WorkspaceState>(&contents) {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[tybre] workspace.json parse error: {e} — using defaults");
            WorkspaceState::default()
        }
    }
}

#[command]
pub fn save_workspace(project_path: String, workspace: WorkspaceState) -> Result<(), String> {
    let Some(dir) = project_tybre_dir(&project_path) else { return Err("cannot resolve .tybre dir".into()) };
    let json = serde_json::to_string_pretty(&workspace).map_err(|e| e.to_string())?;
    fs::write(dir.join("workspace.json"), json).map_err(|e| e.to_string())
}

#[command]
pub fn load_memo(project_path: String) -> String {
    let Some(dir) = project_tybre_dir(&project_path) else { return String::new() };
    fs::read_to_string(dir.join("memo.txt")).unwrap_or_default()
}

#[command]
pub fn save_memo(project_path: String, content: String) -> Result<(), String> {
    let Some(dir) = project_tybre_dir(&project_path) else { return Err("cannot resolve .tybre dir".into()) };
    fs::write(dir.join("memo.txt"), content).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────

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
        children.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));

        Ok(FileEntry { name, path: path.to_string(), is_dir: true, children: Some(children) })
    } else {
        Ok(FileEntry { name, path: path.to_string(), is_dir: false, children: None })
    }
}

// ── Last session (multi-project restore) ─────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct LastSession {
    #[serde(default)]
    pub open_projects: Vec<String>,
    #[serde(default)]
    pub active_project: Option<String>,
}

#[command]
pub fn load_last_session() -> LastSession {
    let Some(dir) = app_config_dir() else { return LastSession::default() };
    let Ok(contents) = fs::read_to_string(dir.join("last-session.json")) else { return LastSession::default() };
    let mut s: LastSession = serde_json::from_str(&contents).unwrap_or_default();
    // Filter out projects whose folder no longer exists on disk
    s.open_projects.retain(|p| Path::new(p).exists());
    if let Some(ref ap) = s.active_project {
        if !Path::new(ap).exists() {
            s.active_project = s.open_projects.first().cloned();
        }
    }
    s
}

#[command]
pub fn save_last_session(open_projects: Vec<String>, active_project: Option<String>) -> Result<(), String> {
    let Some(dir) = app_config_dir() else { return Err("cannot resolve config dir".into()) };
    let s = LastSession { open_projects, active_project };
    let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    fs::write(dir.join("last-session.json"), json).map_err(|e| e.to_string())
}

// ── Project tabs / session restoration ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ProjectTabsState {
    #[serde(default)]
    pub open_tabs: Vec<String>,
    #[serde(default)]
    pub active_tab: Option<String>,
    #[serde(default)]
    pub terminal_session_names: Vec<String>,
}

#[command]
pub fn load_project_tabs(project_path: String) -> ProjectTabsState {
    let Some(dir) = project_tybre_dir(&project_path) else { return ProjectTabsState::default() };
    let Ok(contents) = fs::read_to_string(dir.join("tabs.json")) else { return ProjectTabsState::default() };
    serde_json::from_str::<ProjectTabsState>(&contents).unwrap_or_default()
}

#[command]
pub fn save_project_tabs(project_path: String, tabs: ProjectTabsState) -> Result<(), String> {
    let Some(dir) = project_tybre_dir(&project_path) else { return Err("cannot resolve .tybre dir".into()) };
    let json = serde_json::to_string_pretty(&tabs).map_err(|e| e.to_string())?;
    fs::write(dir.join("tabs.json"), json).map_err(|e| e.to_string())
}
