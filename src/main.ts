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

interface CalEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
  else if (name === "calendar") refreshCalendar();
}
document
  .querySelectorAll<HTMLElement>(".rail-btn")
  .forEach((btn) =>
    btn.addEventListener("click", () => setView(btn.dataset.view!)),
  );

function refreshSystem2(procs: Proc[]) {
  const body = $("proc-body") as HTMLTableSectionElement;
  const seen = new Set<string>();

  for (const p of procs) {
    const id = String(p.pid);
    seen.add(id);
    let row = body.querySelector<HTMLTableRowElement>(`tr[data-pid="${id}"]`);

    if (!row) {
      row = document.createElement("tr");
      row.dataset.pid = id;
      row.innerHTML =
        `<td class="c-name"></td><td class="c-cpu"></td><td class="c-mem"></td>` +
        `<td><button class="kill" data-pid="${id}" data-name="${esc(p.name)}" title="Quit process">✕</button></td>`;
      body.appendChild(row);
    }

    // Update only the text cells — never touch the kill button
    row.querySelector(".c-name")!.textContent = p.name;
    row.querySelector(".c-cpu")!.textContent = `${p.cpu.toFixed(1)}%`;
    row.querySelector(".c-mem")!.textContent = `${mb(p.mem)} MB`;
  }

  // Remove rows for processes that are gone
  body.querySelectorAll<HTMLTableRowElement>("tr[data-pid]").forEach((row) => {
    if (!seen.has(row.dataset.pid!)) row.remove();
  });
}

async function refreshSystem() {
  const s = await invoke<Stats>("get_stats");
  $("cpu").textContent = `${s.cpu.toFixed(1)}%`;
  $("mem").textContent = `${gb(s.mem_used)} / ${gb(s.mem_total)} GB`;
  const procs = await invoke<Proc[]>("get_processes");
  refreshSystem2(procs);
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

async function refreshCalendar() {
  const list = $("cal-list");
  const events = await invoke<CalEvent[]>("get_events");
  if (events.length === 0) {
    list.innerHTML = `<div class="cal-empty">Nothing on today.</div>`;
    return;
  }
  list.innerHTML = events
    .map((e) => {
      const when = e.allDay ? "All day" : clock(e.start);
      return `<div class="cal-item"><span class="cal-time">${when}</span><span class="cal-title">${esc(e.title)}</span></div>`;
    })
    .join("");
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

let armedPid: number | null = null;
let armTimer: number | undefined;

function disarm(btn: HTMLButtonElement) {
  btn.classList.remove("armed");
  btn.textContent = "✕";
  armedPid = null;
}

$("proc-body").addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".kill");
  if (!btn) return;
  const pid = Number(btn.dataset.pid);

  if (armedPid !== pid) {
    // Disarm any previously-armed button first
    const prev = $("proc-body").querySelector<HTMLButtonElement>(".kill.armed");
    if (prev) {
      clearTimeout(armTimer);
      disarm(prev);
    }

    // Arm this one
    armedPid = pid;
    btn.classList.add("armed");
    btn.textContent = "kill?";
    clearTimeout(armTimer);
    armTimer = window.setTimeout(() => disarm(btn), 2000);
    return;
  }

  // Second click on the same row: kill
  clearTimeout(armTimer);
  armedPid = null;
  const ok = await invoke<boolean>("kill_process", { pid });
  if (!ok) {
    btn.textContent = "denied";
  }
});

let calCounter = 0;
async function tick() {
  try {
    await refreshSystem();
    if (currentView === "spotify") {
      await refreshSpotify();
    } else if (calCounter % 3 === 0) {
      refreshSpotify().catch(() => {}); // warm Spotify every ~3s in background, no await
    }
    if (currentView === "calendar" && calCounter % 60 === 0)
      await refreshCalendar();
    calCounter++;
  } catch (e) {
    console.error(e);
  }
}

tick();
setInterval(tick, 1000);
