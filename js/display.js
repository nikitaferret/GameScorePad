import { Bus, finalQueue, loadState, playedTours, ranked } from "./bus.js";

const bus = new Bus("display");
const stage = document.getElementById("stage");
const splash = document.getElementById("splash");
const tablePanel = document.getElementById("tablePanel");
const awardPanel = document.getElementById("awardPanel");
const splashTitle = document.getElementById("splashTitle");
const tableTitle = document.getElementById("tableTitle");
const headRow = document.getElementById("headRow");
const tableBody = document.getElementById("tableBody");
const awardLabel = document.getElementById("awardLabel");
const awardName = document.getElementById("awardName");

let state = loadState();

function fitStage() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const s = Math.min(w / 1920, h / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}

function applyTheme(theme) {
  const t = theme || {};
  document.documentElement.style.setProperty("--c-font", t.font || "#F6F2E8");
  document.documentElement.style.setProperty("--c-head", t.head || t.font || "#F6F2E8");
  document.documentElement.style.setProperty("--c-bar", t.bar || "#5AA8D6");
  document.documentElement.style.setProperty("--c-table", t.table || "#14243C");
  const file = (t.background || "").trim();
  if (file) {
    stage.style.backgroundImage = `url("/bg/${encodeURIComponent(file)}")`;
    stage.classList.add("has-bg");
  } else {
    stage.style.backgroundImage = "";
    stage.classList.remove("has-bg");
  }
}

function gameTitle() {
  return (state.title || "").trim();
}

function paintHead(tours) {
  headRow.innerHTML = "";
  const labels = ["М", "Команда"];
  for (let i = 0; i < tours; i++) labels.push(String(i + 1));
  labels.push("Сумма");
  for (const text of labels) {
    const th = document.createElement("th");
    th.textContent = text;
    if (text !== "Команда") th.className = "num";
    headRow.append(th);
  }
}

function applyTableScale(fs, padY, padX, head, medal) {
  tablePanel.style.setProperty("--table-fs", `${fs}px`);
  tablePanel.style.setProperty("--head-fs", `${head}px`);
  tablePanel.style.setProperty("--row-pad", `${padY}px ${padX}px`);
  tablePanel.style.setProperty("--medal", `${medal}px`);
}

function fitTable(n) {
  const board = tablePanel.querySelector(".board");
  const table = board?.querySelector("table");
  if (!board || !table || tablePanel.hidden) return;
  const availH = board.clientHeight;
  const availW = board.clientWidth;
  if (availH < 40 || availW < 40) return;
  const prefer = Math.max(80, Math.min(200, Number(state.theme?.tableScale) || 125));
  let fs = Math.round(18 + ((prefer - 80) * 22) / 100);
  function apply(size) {
    const padY = Math.max(1, Math.round(size * 0.2));
    const padX = Math.max(4, Math.round(size * 0.3));
    const head = Math.max(14, Math.round(size * 0.95));
    const medal = Math.max(16, Math.round(size * 1.3));
    applyTableScale(size, padY, padX, head, medal);
  }
  function shrink() {
    for (let i = 0; i < 24; i++) {
      if (table.scrollHeight <= availH + 1 && table.scrollWidth <= availW + 1) return;
      fs = Math.max(12, fs - 1);
      apply(fs);
    }
  }
  apply(fs);
  shrink();
  requestAnimationFrame(shrink);
}

function paint() {
  if (!state) return;
  applyTheme(state.theme);
  const mode = state.mode || "idle";
  const tours = Number(state.tours) || 7;
  const played = playedTours(state.teams || [], tours);
  const rankTours = played || tours;
  const showTours = state.isFinal ? tours : played;
  splash.hidden = mode !== "idle" && mode !== "ready";
  tablePanel.hidden = mode !== "table";
  awardPanel.hidden = mode !== "award";
  const title = gameTitle();
  if (mode === "ready" || (state.isFinal && mode === "idle")) {
    splashTitle.textContent = title ? `ИТОГИ · ${title}` : "ИТОГИ";
  } else {
    splashTitle.textContent = title || "СЧЁТ";
  }
  tableTitle.textContent = state.isFinal
    ? title
      ? `ИТОГИ · ${title}`
      : "ИТОГИ"
    : title || "СЧЁТ";

  const rows = ranked(state.teams || [], rankTours);
  const lastToShow = Number(state.lastToShow) || rows.length + 1;
  paintHead(showTours);
  tableBody.innerHTML = "";
  const visible = rows.filter((t) => t.place >= lastToShow).sort((a, b) => a.place - b.place);
  for (const t of visible) {
    const tr = document.createElement("tr");
    if (t.place <= 3) tr.classList.add(`p${t.place}`);
    if (t.place <= 3 && t.place === lastToShow) tr.classList.add("enter");
    const place = document.createElement("td");
    place.className = "place";
    const medal = document.createElement("span");
    medal.className = "medal";
    medal.textContent = String(t.place);
    place.append(medal);
    const name = document.createElement("td");
    name.className = "name";
    name.textContent = t.name || " ";
    tr.append(place, name);
    for (let i = 0; i < showTours; i++) {
      const td = document.createElement("td");
      td.className = "tour";
      const raw = t.scores?.[i];
      td.textContent = raw === null || raw === undefined || raw === "" ? "" : String(raw);
      tr.append(td);
    }
    const sum = document.createElement("td");
    sum.className = "score";
    sum.textContent = String(t.score);
    tr.append(sum);
    tableBody.append(tr);
  }
  fitTable(visible.length);

  if (mode === "award") {
    const queue = finalQueue(rows, state.awards);
    const item = queue[Number(state.awardIndex) || 0];
    if (item?.type === "award") {
      awardLabel.textContent = item.label;
      awardName.textContent = item.team.name || " ";
      awardName.classList.toggle("is-on", !!state.awardReveal);
      const podium = item.kind === "place1" ? "p1" : item.kind === "place2" ? "p2" : item.kind === "place3" ? "p3" : "";
      awardLabel.classList.remove("p1", "p2", "p3");
      if (podium) awardLabel.classList.add(podium);
    }
  } else {
    awardName.classList.remove("is-on");
    awardLabel.classList.remove("p1", "p2", "p3");
  }
}

function accept(next) {
  if (!next) return;
  state = next;
  paint();
}

bus.on((msg) => {
  if (msg?.type === "state") accept(msg.state);
});
paint();
fitStage();
window.addEventListener("resize", () => {
  fitStage();
  fitTable();
});

let lastRev = state?.rev ?? -1;
let lastReload = Number(sessionStorage.getItem("hallReload") || 0);
async function pullServer() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const n = Number(data.hallReload || 0);
    if (sessionStorage.getItem("hallReload") != null && n > lastReload) {
      sessionStorage.setItem("hallReload", String(n));
      location.reload();
      return;
    }
    lastReload = n;
    sessionStorage.setItem("hallReload", String(n));
    const next = data.state;
    if (!next) return;
    if (next.rev === lastRev) return;
    lastRev = next.rev ?? lastRev;
    accept(next);
  } catch {
    /* last frame stays */
  }
}
setInterval(pullServer, 250);
pullServer();

function toggleHallFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "F11" || e.code === "F11") {
    e.preventDefault();
    toggleHallFullscreen();
  }
});
document.addEventListener("dblclick", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
