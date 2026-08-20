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
  art_url: string;
  position: number;
  duration: number;
}

const gb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(1);
const mb = (b: number) => (b / 1024 / 1024).toFixed(0);
const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const time = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

let currentView = "system";
let seeking = false; // true while the user is dragging the seek bar

const $ = (id: string) => document.getElementById(id)!;

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
  $("cpu").textContent = `${s.cpu.toFixed(1)}%`;
  $("mem").textContent = `${gb(s.mem_used)} / ${gb(s.mem_total)} GB`;
  const procs = await invoke<Proc[]>("get_processes");
  $("proc-body").innerHTML = procs
    .map(
      (p) =>
        `<tr><td>${p.pid}</td><td>${esc(p.name)}</td><td>${p.cpu.toFixed(1)}%</td><td>${mb(p.mem)} MB</td></tr>`,
    )
    .join("");
}

const seekbar = $("sp-seekbar") as HTMLInputElement;

async function refreshSpotify() {
  const sp = await invoke<Spotify>("spotify_status");
  const now = $("sp-now");
  const art = $("sp-art") as HTMLImageElement;

  if (!sp.running || !sp.track) {
    now.textContent = sp.running ? "Nothing playing" : "Spotify isn't running";
    art.classList.remove("show");
    seekbar.value = "0";
    $("sp-cur").textContent = "0:00";
    $("sp-dur").textContent = "0:00";
    return;
  }

  now.innerHTML = `<div class="sp-track">${esc(sp.track)}</div><div class="sp-artist">${esc(sp.artist)}</div>`;
  $("sp-playpause").textContent = sp.playing ? "⏸" : "▶";

  if (sp.art_url.startsWith("http")) {
    art.src = sp.art_url;
    art.classList.add("show");
  } else art.classList.remove("show");

  $("sp-dur").textContent = time(sp.duration);
  if (!seeking) {
    // don't fight the user's drag
    seekbar.max = String(Math.floor(sp.duration));
    seekbar.value = String(Math.floor(sp.position));
    $("sp-cur").textContent = time(sp.position);
  }
}

// Optimistic icon flip so play/pause responds instantly
function control(action: string) {
  if (action === "playpause") {
    const b = $("sp-playpause");
    b.textContent = b.textContent === "⏸" ? "▶" : "⏸";
  }
  invoke("spotify_control", { action }).then(() =>
    setTimeout(refreshSpotify, 250),
  );
}
$("sp-prev").addEventListener("click", () => control("prev"));
$("sp-playpause").addEventListener("click", () => control("playpause"));
$("sp-next").addEventListener("click", () => control("next"));

// Seek: mark while dragging, commit on release
seekbar.addEventListener("input", () => {
  seeking = true;
  $("sp-cur").textContent = time(Number(seekbar.value));
});
seekbar.addEventListener("change", () => {
  invoke("spotify_seek", { seconds: Number(seekbar.value) }).then(() => {
    seeking = false;
    setTimeout(refreshSpotify, 250);
  });
});

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
