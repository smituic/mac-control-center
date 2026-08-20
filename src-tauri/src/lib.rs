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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(System::new_all()))
        .invoke_handler(tauri::generate_handler![greet, get_stats, get_processes])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
