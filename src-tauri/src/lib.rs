// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
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
fn get_stats() -> Stats {
    let mut sys = sysinfo::System::new();
    // CPU usage is a *diff*: read once, wait, read again.
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    Stats {
        cpu: sys.global_cpu_usage(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, get_stats])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
