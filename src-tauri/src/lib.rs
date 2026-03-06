mod commands;
mod terminal;
mod watcher;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use terminal::TerminalState;
use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(TerminalState(Arc::new(Mutex::new(HashMap::new()))))
        .manage(WatcherState(Arc::new(Mutex::new(None))))
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
