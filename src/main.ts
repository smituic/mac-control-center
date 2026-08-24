import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
  volume: number;
  shuffle: boolean;
  repeat: boolean;
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
let seeking = false;
let seekDur = 0;
let lastTrackKey = "";

const $ = (id: string) => document.getElementById(id)!;

// ---- Marquee (scrolls long titles) ----
let marqueeTimer: number | undefined;
function startMarquee() {
  clearInterval(marqueeTimer);
  const wrap = document.querySelector(".sp-track-wrap") as HTMLElement;
  const span = document.querySelector(".sp-track") as HTMLElement;
  if (!wrap || !span) return;
  span.style.transform = "translateX(0)";
  span.style.transition = "none";
  const overflow = span.scrollWidth - wrap.clientWidth;
  if (overflow <= 6) return;
  const shift = overflow + 14;
  let atStart = true;
  marqueeTimer = window.setInterval(() => {
    span.style.transition = "transform 4s ease-in-out";
    span.style.transform = atStart
      ? `translateX(-${shift}px)`
      : "translateX(0)";
    atStart = !atStart;
  }, 4500);
}

// ---- View switching ----
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

// ---- System ----
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
    row.querySelector(".c-name")!.textContent = p.name;
    row.querySelector(".c-cpu")!.textContent = `${p.cpu.toFixed(1)}%`;
    row.querySelector(".c-mem")!.textContent = `${mb(p.mem)} MB`;
  }
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

// ---- Spotify ----
const fill = $("sp-fill");
const knob = $("sp-knob");
const seekEl = $("sp-seek");
const volFill = $("sp-vol-fill");
const volBar = $("sp-vol-bar");
const glow = $("sp-glow");
const artWrap = () => document.querySelector(".sp-art-wrap") as HTMLElement;

function applyGlow(img: HTMLImageElement) {
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    glow.style.setProperty("--glow", `rgba(${r}, ${g}, ${b}, 0.5)`);
    glow.classList.add("show");
  } catch {
    glow.classList.remove("show");
  }
}

async function refreshSpotify() {
  const sp = await invoke<Spotify>("spotify_status");
  const now = $("sp-now");
  const art = $("sp-art") as HTMLImageElement;
  const pp = $("sp-playpause");

  if (!sp.running || !sp.track) {
    now.textContent = sp.running ? "Nothing playing" : "Spotify isn't running";
    art.classList.remove("show");
    glow.classList.remove("show");
    fill.style.width = "0%";
    knob.style.left = "0%";
    $("sp-cur").textContent = "0:00";
    $("sp-dur").textContent = "0:00";
    lastTrackKey = "";
    return;
  }

  // Rebuild title only when the song changes (so the marquee isn't reset every tick)
  if (lastTrackKey !== sp.track + "|" + sp.artist) {
    lastTrackKey = sp.track + "|" + sp.artist;
    now.innerHTML =
      `<div class="sp-track-wrap"><span class="sp-track" id="sp-track">${esc(sp.track)}</span></div>` +
      `<div class="sp-artist">${esc(sp.artist)}</div>`;
    setTimeout(startMarquee, 120);
  }

  pp.innerHTML = sp.playing
    ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

  // shuffle / repeat lit state
  $("sp-shuffle").classList.toggle("on", sp.shuffle);
  $("sp-repeat").classList.toggle("on", sp.repeat);

  const wrap = artWrap();
  if (wrap) wrap.classList.toggle("playing", sp.playing);

  if (sp.art_url.startsWith("http")) {
    if (art.getAttribute("src") !== sp.art_url) {
      art.classList.remove("show");
      art.src = sp.art_url;
      art.onload = () => {
        art.classList.add("show");
        applyGlow(art);
      };
    }
    if (art.complete) {
      art.classList.add("show");
      applyGlow(art);
    }
  } else {
    art.classList.remove("show");
    glow.classList.remove("show");
  }

  seekDur = sp.duration || 0;
  $("sp-dur").textContent = `-${time(Math.max(0, seekDur - sp.position))}`;
  if (!seeking) {
    const pct = seekDur ? (sp.position / seekDur) * 100 : 0;
    fill.style.width = `${pct}%`;
    knob.style.left = `${pct}%`;
    $("sp-cur").textContent = time(sp.position);
  }
  volFill.style.width = `${sp.volume}%`;
}

// Play/pause/skip — optimistic icon flip
function control(action: string) {
  if (action === "playpause") {
    const pp = $("sp-playpause");
    const isPause = !!pp.querySelector('path[d^="M7 5"]');
    pp.innerHTML = isPause
      ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`;
  }
  invoke("spotify_control", { action }).then(() =>
    setTimeout(refreshSpotify, 250),
  );
}
$("sp-prev").addEventListener("click", () => control("prev"));
$("sp-playpause").addEventListener("click", () => control("playpause"));
$("sp-next").addEventListener("click", () => control("next"));

// Shuffle / repeat toggles — optimistic lit flip
$("sp-shuffle").addEventListener("click", () => {
  $("sp-shuffle").classList.toggle("on");
  invoke("spotify_toggle", { what: "shuffle" }).then(() =>
    setTimeout(refreshSpotify, 250),
  );
});
$("sp-repeat").addEventListener("click", () => {
  $("sp-repeat").classList.toggle("on");
  invoke("spotify_toggle", { what: "repeat" }).then(() =>
    setTimeout(refreshSpotify, 250),
  );
});

// Seek: click / drag
function seekPct(e: MouseEvent) {
  const r = seekEl.querySelector(".sp-track-bar")!.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  fill.style.width = `${pct * 100}%`;
  knob.style.left = `${pct * 100}%`;
  $("sp-cur").textContent = time(pct * seekDur);
  return pct;
}
seekEl.addEventListener("mousedown", (e) => {
  seeking = true;
  seekPct(e);
  const move = (ev: MouseEvent) => seekPct(ev);
  const up = (ev: MouseEvent) => {
    const pct = seekPct(ev);
    invoke("spotify_seek", { seconds: pct * seekDur }).then(() => {
      seeking = false;
      setTimeout(refreshSpotify, 250);
    });
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

// Volume: instant bar, throttled command
volBar.addEventListener("mousedown", (e) => {
  let lastSent = 0;
  const apply = (ev: MouseEvent, force: boolean) => {
    const r = volBar.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    volFill.style.width = `${pct * 100}%`;
    const t = Date.now();
    if (force || t - lastSent > 120) {
      lastSent = t;
      invoke("spotify_volume", { level: Math.round(pct * 100) });
    }
  };
  apply(e, true);
  const move = (ev: MouseEvent) => apply(ev, false);
  const up = (ev: MouseEvent) => {
    apply(ev, true);
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

// ---- Calendar ----
let selectedDate = new Date(); // which day the agenda is showing

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function refreshCalendar() {
  const list = $("cal-list");
  const now = new Date();
  const isToday = ymd(selectedDate) === ymd(now);

  $("cal-day").textContent = isToday
    ? "Today"
    : selectedDate.toLocaleDateString([], { weekday: "long" });
  $("cal-date").textContent = selectedDate.toLocaleDateString([], {
    month: "long",
    day: "numeric",
  });

  renderMonth();

  const events = await invoke<CalEvent[]>("get_events", {
    date: ymd(selectedDate),
  });

  if (events.length === 0) {
    list.innerHTML = `
      <div class="cal-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        <div class="cal-empty-title">Nothing on ${isToday ? "today" : "this day"}</div>
        <div class="cal-empty-sub">Enjoy the open day.</div>
      </div>`;
    return;
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  type Row = { ev: CalEvent; state: "now" | "upcoming" | "past" };
  const rows: Row[] = events.map((ev) => {
    if (ev.allDay || !isToday) return { ev, state: "upcoming" as const };
    const start = new Date(ev.start),
      end = new Date(ev.end);
    if (now >= start && now <= end) return { ev, state: "now" as const };
    if (now > end) return { ev, state: "past" as const };
    return { ev, state: "upcoming" as const };
  });

  const groups = [
    { label: "Now", items: rows.filter((r) => r.state === "now") },
    {
      label: isToday ? "Upcoming" : "Scheduled",
      items: rows.filter((r) => r.state === "upcoming"),
    },
    { label: "Earlier", items: rows.filter((r) => r.state === "past") },
  ].filter((g) => g.items.length > 0);

  list.innerHTML = groups
    .map((g) => {
      const items = g.items
        .map(({ ev, state }) => {
          const when = ev.allDay
            ? "All day"
            : `${fmt(ev.start)} – ${fmt(ev.end)}`;
          const nowTag =
            state === "now"
              ? `<div class="cal-now-tag">Happening now</div>`
              : "";
          return `<div class="cal-item ${state}"><div class="cal-accent"></div><div class="cal-body"><div class="cal-title">${esc(ev.title)}</div><div class="cal-time">${when}</div>${nowTag}</div></div>`;
        })
        .join("");
      return `<div class="cal-group-label">${g.label}</div>${items}`;
    })
    .join("");
}

function renderMonth() {
  const el = $("cal-month");
  const now = new Date();
  const year = selectedDate.getFullYear(),
    month = selectedDate.getMonth();
  const monthName = selectedDate.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dows = ["S", "M", "T", "W", "T", "F", "S"];
  let cells = dows.map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < firstDay; i++)
    cells += `<div class="cal-cell blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday =
      d === now.getDate() &&
      month === now.getMonth() &&
      year === now.getFullYear();
    const isSel = d === selectedDate.getDate();
    let cls = "cal-cell";
    if (isSel) cls += " sel";
    if (isToday) cls += " today";
    cells += `<div class="${cls}" data-day="${d}">${d}</div>`;
  }
  el.innerHTML =
    `<div class="cal-month-head"><div class="cal-month-title">${monthName}</div></div>` +
    `<div class="cal-grid">${cells}</div>`;
}

// click a day → switch the agenda to that day
$("cal-month").addEventListener("click", (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>(
    ".cal-cell[data-day]",
  );
  if (!cell) return;
  const day = Number(cell.dataset.day);
  selectedDate = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    day,
  );
  refreshCalendar();
});
// ---- Kill button ----
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
    const prev = $("proc-body").querySelector<HTMLButtonElement>(".kill.armed");
    if (prev) {
      clearTimeout(armTimer);
      disarm(prev);
    }
    armedPid = pid;
    btn.classList.add("armed");
    btn.textContent = "kill?";
    clearTimeout(armTimer);
    armTimer = window.setTimeout(() => disarm(btn), 2000);
    return;
  }
  clearTimeout(armTimer);
  armedPid = null;
  const ok = await invoke<boolean>("kill_process", { pid });
  if (!ok) {
    btn.textContent = "denied";
  }
});

// ---- Loop ----
let calCounter = 0;
async function tick() {
  try {
    await refreshSystem();
    if (currentView === "spotify") await refreshSpotify();
    else if (calCounter % 3 === 0) refreshSpotify().catch(() => {});
    if (currentView === "calendar" && calCounter % 60 === 0)
      await refreshCalendar();
    calCounter++;
  } catch (e) {
    console.error(e);
  }
}

$("close-btn").addEventListener("click", () => getCurrentWindow().hide());
tick();
setInterval(tick, 1000);
