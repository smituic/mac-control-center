use std::sync::Mutex;
use sysinfo::{System, ProcessesToUpdate};


#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}


#[derive(serde::Serialize)]
struct Stats {
    cpu: f32,
    mem_used: u64,
    mem_total: u64,
}


#[tauri::command]
fn get_stats(state: tauri::State<'_, Mutex<System>>) -> Stats {
    let mut sys = state.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    Stats {
        cpu: sys.global_cpu_usage(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
    }
}

#[derive(serde::Serialize)]
struct ProcInfo {
    pid: u32,
    name: String,
    cpu: f32,
    mem: u64,
}

#[tauri::command]
fn get_processes(state: tauri::State<'_, Mutex<System>>) -> Vec<ProcInfo> {
    let mut sys = state.lock().unwrap();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut list: Vec<ProcInfo> = sys
        .processes()
        .iter()
        .map(|(pid, p)| ProcInfo {
            pid: pid.as_u32(),
            name: p.name().to_string_lossy().to_string(),
            cpu: p.cpu_usage(),
            mem: p.memory(),
        })
        .collect();
    list.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal));
    list.truncate(15);
    list
}

fn show_panel(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let mpos = monitor.position();
        let msize = monitor.size();
        let scale = monitor.scale_factor();
        let menubar = (28.0 * scale) as i32;
        let width = (380.0 * scale) as u32;
        let height = (msize.height as i32 - menubar).max(0) as u32;
        let x = mpos.x + msize.width as i32 - width as i32;
        let y = mpos.y + menubar;
        let _ = window.set_size(tauri::PhysicalSize { width, height });
        let _ = window.set_position(tauri::PhysicalPosition { x, y });
    }
    let _ = window.show();
    let _ = window.set_focus();
}


fn run_osascript(script: &str) -> String {
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

#[derive(serde::Serialize)]
struct Spotify {
    running: bool,
    playing: bool,
    track: String,
    artist: String,
}

#[tauri::command]
fn spotify_status() -> Spotify {
    let script = r#"
if application "Spotify" is running then
    tell application "Spotify"
        set st to player state as string
        set tn to name of current track
        set ar to artist of current track
    end tell
    return st & "|" & tn & "|" & ar
else
    return "notrunning"
end if
"#;
    let out = run_osascript(script);
    if out.is_empty() || out == "notrunning" {
        return Spotify { running: false, playing: false, track: String::new(), artist: String::new() };
    }
    let parts: Vec<&str> = out.splitn(3, '|').collect();
    Spotify {
        running: true,
        playing: parts.get(0).copied().unwrap_or("") == "playing",
        track: parts.get(1).copied().unwrap_or("").to_string(),
        artist: parts.get(2).copied().unwrap_or("").to_string(),
    }
}

#[tauri::command]
fn spotify_control(action: String) {
    let cmd = match action.as_str() {
        "playpause" => "playpause",
        "next" => "next track",
        "prev" => "previous track",
        _ => return,
    };
    let script = format!("if application \"Spotify\" is running then tell application \"Spotify\" to {cmd}");
    run_osascript(&script);
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(System::new_all()))
                .invoke_handler(tauri::generate_handler![greet, get_stats, get_processes, spotify_status, spotify_control])
        .setup(|app| {
            use tauri::Manager;
            use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};

            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let _tray = TrayIconBuilder::with_id("main_tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                show_panel(&window);
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}