use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{command, AppHandle, Emitter};

pub struct WatcherState(pub Arc<Mutex<Option<RecommendedWatcher>>>);

/// Start watching a directory for file changes.
/// Emits "file-changed" events for modifications.
/// Emits "file-tree-changed" events for create/delete operations.
#[command]
pub fn start_watching(
    state: tauri::State<'_, WatcherState>,
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // Stop existing watcher if any
    guard.take();

    let app_clone = app.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            let Ok(event) = result else { return };

            match event.kind {
                EventKind::Create(_) | EventKind::Remove(_) => {
                    // Emit file-tree-changed event for any file/folder create/delete
                    // (triggers file tree refresh in frontend)
                    let _ = app_clone.emit("file-tree-changed", ());
                }
                EventKind::Modify(_) => {
                    // Emit file-changed event only for modifications to text files
                    for path in &event.paths {
                        let Some(ext) = path.extension() else { continue };
                        let ext_lower = ext.to_string_lossy().to_lowercase();
                        if !matches!(ext_lower.as_str(), "md" | "txt" | "markdown") {
                            continue;
                        }
                        let path_str = path.to_string_lossy().to_string();
                        let _ = app_clone.emit("file-changed", &path_str);
                    }
                }
                _ => {}
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(500)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

/// Stop file watching.
#[command]
pub fn stop_watching(state: tauri::State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.take();
    Ok(())
}
