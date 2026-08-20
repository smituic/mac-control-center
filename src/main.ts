import { invoke } from "@tauri-apps/api/core";

interface Stats {
  cpu: number;
  mem_used: number;
  mem_total: number;
}

const gb = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(1);

async function refresh() {
  try {
    const s = await invoke<Stats>("get_stats");
    document.getElementById("cpu")!.textContent = `${s.cpu.toFixed(1)}%`;
    document.getElementById("mem")!.textContent = `${gb(s.mem_used)} / ${gb(s.mem_total)} GB`;
  } catch (e) {
    console.error(e);
  }
}

refresh();
setInterval(refresh, 1000);