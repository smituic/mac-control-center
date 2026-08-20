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
        list.sort_by(|a, b| b.mem.cmp(&a.mem));
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
    art_url: String,
    position: f64,
    duration: f64,
}

#[tauri::command]
fn spotify_status() -> Spotify {
    let script = r#"
set theOut to "notrunning"
if application "Spotify" is running then
    tell application "Spotify"
        set theState to player state as string
        set theName to name of current track
        set theArtist to artist of current track
        set theDur to (duration of current track) / 1000
        set thePos to player position
        set theArt to ""
        try
            set theArt to artwork url of current track
        end try
        set theOut to theState & "|" & theName & "|" & theArtist & "|" & theArt & "|" & theDur & "|" & thePos
    end tell
end if
theOut
"#;
    let out = run_osascript(script);
    if out.is_empty() || out == "notrunning" {
        return Spotify {
            running: false, playing: false, track: String::new(), artist: String::new(),
            art_url: String::new(), position: 0.0, duration: 0.0,
        };
    }
    let p: Vec<&str> = out.splitn(6, '|').collect();
    Spotify {
        running: true,
        playing: p.get(0).copied().unwrap_or("") == "playing",
        track: p.get(1).copied().unwrap_or("").to_string(),
        artist: p.get(2).copied().unwrap_or("").to_string(),
        art_url: p.get(3).copied().unwrap_or("").to_string(),
        duration: p.get(4).and_then(|s| s.parse().ok()).unwrap_or(0.0),
        position: p.get(5).and_then(|s| s.parse().ok()).unwrap_or(0.0),
    }
}

#[tauri::command]
fn spotify_seek(seconds: f64) {
    let script = format!(
        "if application \"Spotify\" is running then tell application \"Spotify\" to set player position to {seconds}"
    );
    run_osascript(&script);
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


#[tauri::command]
fn kill_process(state: tauri::State<'_, Mutex<System>>, pid: u32) -> bool {
    let sys = state.lock().unwrap();
    if let Some(proc) = sys.process(sysinfo::Pid::from_u32(pid)) {
        proc.kill()
    } else {
        false
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CalEvent {
    title: String,
    start: String,
    end: String,
    #[serde(rename = "allDay")]
    all_day: bool,
}

#[tauri::command]
async fn get_events(app: tauri::AppHandle) -> Vec<CalEvent> {
    use tauri_plugin_shell::ShellExt;
    let output = match app.shell().sidecar("calendar") {
        Ok(cmd) => cmd.output().await,
        Err(_) => return vec![],
    };
    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return vec![],
    };
    serde_json::from_str::<Vec<CalEvent>>(stdout.trim()).unwrap_or_default()
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(System::new_all()))
        .invoke_handler(tauri::generate_handler![greet, get_stats, get_processes, spotify_status, spotify_control, spotify_seek, kill_process, get_events])
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