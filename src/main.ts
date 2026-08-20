import { invoke } from "@tauri-apps/api/core";

interface Stats {
  cpu: number;
  mem_used: number;
  mem_total: number;
}
interface Proc {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
}

const gb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(1);
const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

function setView(name: string) {
  document.querySelectorAll<HTMLElement>(".view").forEach((v) => {
    v.classList.toggle("active", v.id === `view-${name}`);
  });
  document.querySelectorAll<HTMLElement>(".rail-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
}

document.querySelectorAll<HTMLElement>(".rail-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view!));
});

async function refresh() {
  try {
    const s = await invoke<Stats>("get_stats");
    document.getElementById("cpu")!.textContent = `${s.cpu.toFixed(1)}%`;
    document.getElementById("mem")!.textContent =
      `${gb(s.mem_used)} / ${gb(s.mem_total)} GB`;

    const procs = await invoke<Proc[]>("get_processes");
    document.getElementById("proc-body")!.innerHTML = procs
      .map(
        (p) =>
          `<tr><td>${p.pid}</td><td>${esc(p.name)}</td><td>${p.cpu.toFixed(1)}%</td><td>${mb(p.mem)} MB</td></tr>`,
      )
      .join("");
  } catch (e) {
    console.error(e);
  }
}

refresh();
setInterval(refresh, 1000);
