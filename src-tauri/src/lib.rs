mod commands;
mod terminal;
mod watcher;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use terminal::TerminalState;
use watcher::WatcherState;
use commands::StartupFile;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(TerminalState(Arc::new(Mutex::new(HashMap::new()))))
        .manage(WatcherState(Arc::new(Mutex::new(None))))
        .manage(StartupFile(Mutex::new(None)))
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let paths: Vec<String> = event.urls().iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .filter_map(|p| p.to_str().map(String::from))
                    .collect();
                if paths.is_empty() {
                    return;
                }
                // If the main window is ready, emit event directly (app already running)
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.emit("open-files", &paths);
                } else {
                    // App is starting up — store for frontend to retrieve via get_startup_file
                    let state = handle.state::<StartupFile>();
                    let mut lock = state.0.lock().unwrap();
                    if lock.is_none() {
                        *lock = paths.into_iter().next();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::delete_file,
            commands::rename_file,
            commands::open_folder,
            commands::list_directory,
            commands::pick_folder,
            commands::pick_save_path,
            commands::scan_claude_projects,
            commands::load_cached_projects,
            commands::search_files,
            commands::load_session,
            commands::update_window_session,
            commands::remove_window_session,
            commands::check_claude_installed,
            commands::reveal_in_finder,
            commands::load_global_config,
            commands::save_global_config,
            commands::load_recent_projects,
            commands::add_recent_project,
            commands::load_workspace,
            commands::save_workspace,
            commands::load_memo,
            commands::save_memo,
            commands::load_project_tabs,
            commands::save_project_tabs,
            commands::load_last_session,
            commands::save_last_session,
            commands::get_startup_file,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            watcher::start_watching,
            watcher::stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
