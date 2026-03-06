use std::sync::{Arc, Mutex};
use std::thread;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tauri::{command, AppHandle, Emitter};

pub struct PtySession {
    writer: Box<dyn std::io::Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    pair: Box<dyn portable_pty::MasterPty + Send>,
}

type PtyState = Arc<Mutex<Option<PtySession>>>;

pub struct TerminalState(pub PtyState);

/// Spawn a PTY with the user's shell.
/// `cwd` overrides the working directory (defaults to $HOME if None or path missing).
#[command]
pub fn terminal_spawn(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;

    // Kill existing session if any
    if let Some(old) = guard.take() {
        drop(old.writer);
        drop(old.child);
        drop(old.pair);
    }

    let pty_system = NativePtySystem::default();
    let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());

    // Use provided cwd if it exists on disk, otherwise fall back to $HOME
    let start_dir = cwd
        .filter(|p| std::path::Path::new(p).is_dir())
        .unwrap_or_else(|| home.clone());

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&start_dir);

    // Forward essential environment variables
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("HOME", &home);
    cmd.env("TERM_PROGRAM", "Tybre.md");
    for var in &["PATH", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME",
                  "SHELL", "MANPATH", "XDG_DATA_DIRS"] {
        if let Ok(val) = std::env::var(var) {
            cmd.env(var, val);
        }
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Stream PTY output → Tauri event "terminal-data" (base64-encoded bytes)
    let app_clone = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            use std::io::Read;
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let b64 = encode_base64(&buf[..n]);
                    let _ = app_clone.emit("terminal-data", b64);
                }
            }
        }
        // Notify renderer that the shell process has exited
        let _ = app_clone.emit("terminal-exit", ());
    });

    *guard = Some(PtySession { writer, child, pair: pair.master });
    Ok(())
}

/// Send bytes to the PTY (keyboard input).
#[command]
pub fn terminal_write(
    state: tauri::State<'_, TerminalState>,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = guard.as_mut() {
        use std::io::Write;
        session.writer.write_all(&data).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resize the PTY.
#[command]
pub fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = guard.as_ref() {
        session.pair.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Kill the current PTY session.
#[command]
pub fn terminal_kill(state: tauri::State<'_, TerminalState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.take();
    Ok(())
}

// ── Base64 encoder (no external dep) ────────────────────────────────────────
const B64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn encode_base64(data: &[u8]) -> String {
    let mut out = Vec::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        out.push(B64_CHARS[((b0 >> 2) & 0x3f) as usize]);
        out.push(B64_CHARS[(((b0 << 4) | (b1 >> 4)) & 0x3f) as usize]);
        out.push(if chunk.len() > 1 { B64_CHARS[(((b1 << 2) | (b2 >> 6)) & 0x3f) as usize] } else { b'=' });
        out.push(if chunk.len() > 2 { B64_CHARS[(b2 & 0x3f) as usize] } else { b'=' });
    }
    String::from_utf8(out).unwrap_or_default()
}
