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
interface Spotify {
  running: boolean;
  playing: boolean;
  track: string;
  artist: string;
}

const gb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(1);
const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

let currentView = "system";

function setView(name: string) {
  currentView = name;
  document
    .querySelectorAll<HTMLElement>(".view")
    .forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document
    .querySelectorAll<HTMLElement>(".rail-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "spotify") refreshSpotify();
}

document
  .querySelectorAll<HTMLElement>(".rail-btn")
  .forEach((btn) =>
    btn.addEventListener("click", () => setView(btn.dataset.view!)),
  );

async function refreshSystem() {
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
}

async function refreshSpotify() {
  const sp = await invoke<Spotify>("spotify_status");
  const now = document.getElementById("sp-now")!;
  if (!sp.running) now.textContent = "Spotify isn't running";
  else if (!sp.track) now.textContent = "Nothing playing";
  else
    now.innerHTML = `<div class="sp-track">${esc(sp.track)}</div><div class="sp-artist">${esc(sp.artist)}</div>`;
  document.getElementById("sp-playpause")!.textContent = sp.playing ? "⏸" : "▶";
}

function control(action: string) {
  invoke("spotify_control", { action }).then(() =>
    setTimeout(refreshSpotify, 300),
  );
}
document
  .getElementById("sp-prev")!
  .addEventListener("click", () => control("prev"));
document
  .getElementById("sp-playpause")!
  .addEventListener("click", () => control("playpause"));
document
  .getElementById("sp-next")!
  .addEventListener("click", () => control("next"));

async function tick() {
  try {
    await refreshSystem();
    if (currentView === "spotify") await refreshSpotify();
  } catch (e) {
    console.error(e);
  }
}
tick();
setInterval(tick, 1000);
