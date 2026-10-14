import {
  Bus,
  MAX_TEAMS,
  clampTours,
  defaultState,
  finalQueue,
  fitScores,
  loadState,
  newTeam,
  playedTours,
  ranked,
  teamSum,
  empties,
} from "./bus.js";
import { bindPoster, paintPoster, posterOpen } from "./poster.js";

const bus = new Bus("operator");
let state = loadState();

const toastEl = document.getElementById("toast");
const titleEl = document.getElementById("gameTitle");
const tableWrap = document.getElementById("scoreTable");
const bgSelect = document.getElementById("bgSelect");
const colorFont = document.getElementById("colorFont");
const colorHead = document.getElementById("colorHead");
const colorBar = document.getElementById("colorBar");
const colorTable = document.getElementById("colorTable");
const tableScale = document.getElementById("tableScale");
const tableScaleVal = document.getElementById("tableScaleVal");
const bgUpload = document.getElementById("bgUpload");
const awardMiddle = document.getElementById("awardMiddle");
const awardPenult = document.getElementById("awardPenult");

function toast(msg) {
  toastEl.textContent = msg || "";
}

function afterChange() {
  state.rev = (Number(state.rev) || 0) + 1;
  bus.publish(state);
  paint();
}

function typingInTable() {
  const ae = document.activeElement;
  return ae && ae.tagName === "INPUT" && tableWrap.contains(ae);
}

function paint() {
  if (document.activeElement !== titleEl) titleEl.value = state.title || "";
  if (document.activeElement !== colorFont) colorFont.value = state.theme.font || "#F6F2E8";
  if (document.activeElement !== colorHead) colorHead.value = state.theme.head || state.theme.font || "#F6F2E8";
  if (document.activeElement !== colorBar) colorBar.value = state.theme.bar || "#5AA8D6";
  if (document.activeElement !== colorTable) colorTable.value = state.theme.table || "#14243C";
  const sc = Math.max(80, Math.min(200, Number(state.theme.tableScale) || 125));
  if (document.activeElement !== tableScale) tableScale.value = String(sc);
  tableScaleVal.textContent = `${sc}%`;
  awardMiddle.checked = !!state.awards.middle;
  awardPenult.checked = !!state.awards.penultimate;
  for (const btn of document.querySelectorAll("[data-tours]")) {
    btn.classList.toggle("is-live", Number(btn.dataset.tours) === state.tours);
  }
  for (const btn of document.querySelectorAll("[data-mode]")) {
    const on =
      (btn.dataset.mode === "idle" && state.mode === "idle") ||
      (btn.dataset.mode === "live" && state.mode === "table" && !state.isFinal) ||
      (btn.dataset.mode === "all" && state.mode === "table" && state.lastToShow <= 1 && !state.isFinal) ||
      (btn.dataset.mode === "final" && state.isFinal);
    btn.classList.toggle("is-live", on);
  }
  document.getElementById("animBtn").classList.toggle(
    "is-live",
    state.mode === "table" || state.mode === "award" || state.mode === "ready",
  );
  document.getElementById("checkBtn").classList.toggle(
    "is-live",
    document.getElementById("pult").classList.contains("is-preview"),
  );
  if (!typingInTable()) paintTable();
  else paintSums();
  paintPreview();
  if (posterOpen()) paintPoster();
  const n = state.teams.length;
  const n10 = n % 10;
  const n100 = n % 100;
  let word = "команд";
  if (n10 === 1 && n100 !== 11) word = "команда";
  else if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) word = "команды";
  document.getElementById("teamCount").textContent = `${n} ${word}`;
  const keep = state.theme.background || "";
  if (bgSelect && keep && [...bgSelect.options].some((o) => o.value === keep)) bgSelect.value = keep;
  else if (bgSelect && !keep) bgSelect.value = "";
}

function paintTable() {
  const tours = state.tours;
  const focus = document.activeElement;
  const focusKey = focus?.dataset?.cell || "";
  tableWrap.innerHTML = "";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.append(th("Команда"));
  for (let i = 0; i < tours; i++) hr.append(th(String(i + 1)));
  hr.append(th("Σ"));
  hr.append(th(""));
  thead.append(hr);
  table.append(thead);
  const tbody = document.createElement("tbody");
  state.teams.forEach((team, row) => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    const name = document.createElement("input");
    name.type = "text";
    name.value = team.name;
    name.dataset.cell = `n:${team.id}`;
    name.dataset.row = String(row);
    name.dataset.col = "0";
    name.placeholder = "Название";
    name.addEventListener("input", () => {
      team.name = name.value;
      state.rev = (Number(state.rev) || 0) + 1;
      bus.publish(state);
    });
    nameTd.append(name);
    tr.append(nameTd);
    for (let i = 0; i < tours; i++) {
      const td = document.createElement("td");
      const cell = document.createElement("input");
      cell.type = "text";
      cell.inputMode = "numeric";
      cell.className = "cell";
      cell.dataset.cell = `s:${team.id}:${i}`;
      cell.dataset.row = String(row);
      cell.dataset.col = String(i + 1);
      const raw = team.scores?.[i];
      cell.value = raw === null || raw === undefined || raw === "" ? "" : String(raw);
      cell.addEventListener("input", () => {
        const n = parseScore(cell.value);
        team.scores[i] = n;
        const sumEl = tableWrap.querySelector(`[data-sum="${team.id}"]`);
        if (sumEl) sumEl.textContent = String(teamSum(team, state.tours));
        state.rev = (Number(state.rev) || 0) + 1;
        bus.publish(state);
      });
      cell.addEventListener("focus", () => cell.select());
      td.append(cell);
      tr.append(td);
    }
    const sumTd = document.createElement("td");
    sumTd.className = "sum";
    sumTd.dataset.sum = team.id;
    sumTd.textContent = String(teamSum(team, tours));
    tr.append(sumTd);
    const delTd = document.createElement("td");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.textContent = "×";
    del.title = "Убрать команду";
    del.addEventListener("click", () => removeTeam(team.id));
    delTd.append(del);
    tr.append(delTd);
    tbody.append(tr);
  });
  table.append(tbody);
  tableWrap.append(table);
  if (focusKey) {
    const el = tableWrap.querySelector(`[data-cell="${focusKey}"]`);
    if (el) el.focus();
  }
}

function paintSums() {
  for (const team of state.teams) {
    const sumEl = tableWrap.querySelector(`[data-sum="${team.id}"]`);
    if (sumEl) sumEl.textContent = String(teamSum(team, state.tours));
  }
}

function paintPreview() {
  const box = document.getElementById("previewTable");
  const root = document.getElementById("pult");
  if (!box || !root.classList.contains("is-preview")) return;
  box.innerHTML = "";
  const tours = state.tours;
  const rows = ranked(state.teams, rankWidth());
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const label of ["М", "Команда", ...Array.from({ length: tours }, (_, i) => String(i + 1)), "Σ"]) {
    const thEl = document.createElement("th");
    thEl.textContent = label;
    hr.append(thEl);
  }
  thead.append(hr);
  table.append(thead);
  const tbody = document.createElement("tbody");
  for (const t of rows) {
    const tr = document.createElement("tr");
    const place = document.createElement("td");
    place.textContent = String(t.place);
    const name = document.createElement("td");
    name.textContent = t.name || "";
    tr.append(place, name);
    for (let i = 0; i < tours; i++) {
      const td = document.createElement("td");
      const raw = t.scores?.[i];
      td.textContent = raw === null || raw === undefined || raw === "" ? "" : String(raw);
      tr.append(td);
    }
    const sum = document.createElement("td");
    sum.className = "sum";
    sum.textContent = String(t.score);
    tr.append(sum);
    tbody.append(tr);
  }
  table.append(tbody);
  box.append(table);
}

function setPreview(on) {
  document.getElementById("pult").classList.toggle("is-preview", on);
  if (on) paintPreview();
  document.getElementById("checkBtn").classList.toggle("is-live", on);
}

function th(text) {
  const el = document.createElement("th");
  el.textContent = text;
  return el;
}

function parseScore(raw) {
  const t = String(raw || "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function removeTeam(id) {
  if (state.teams.length <= 1) {
    toast("Нужна хотя бы одна команда.");
    return;
  }
  state.teams = state.teams.filter((t) => t.id !== id);
  afterChange();
}

function addTeam() {
  if (state.teams.length >= MAX_TEAMS) {
    toast(`Максимум ${MAX_TEAMS} команд.`);
    return;
  }
  state.teams.push(newTeam(state.teams, state.tours));
  afterChange();
}

function setTours(n) {
  const tours = clampTours(n);
  if (tours === state.tours) return;
  state.tours = tours;
  for (const t of state.teams) t.scores = fitScores(t.scores, tours);
  afterChange();
}

function rankWidth() {
  return playedTours(state.teams, state.tours) || state.tours;
}

function startShow(isFinal) {
  state.isFinal = !!isFinal;
  state.awardIndex = -1;
  state.awardKind = "";
  state.awardReveal = 0;
  if (isFinal) {
    state.mode = "ready";
    state.lastToShow = 1;
    afterChange();
    toast("Итоги. Пробел — номинация, ещё раз — команда");
    return;
  }
  state.mode = "table";
  state.lastToShow = Math.min(4, state.teams.length + 1);
  afterChange();
  toast("Таблица без топ-3. Пробел — 3, 2, 1");
}

function showAllTable() {
  state.mode = "table";
  state.lastToShow = 1;
  state.awardIndex = 99;
  state.awardKind = "";
  state.awardReveal = 0;
  afterChange();
  toast("Вся таблица");
}

function stepAnim() {
  if (state.mode === "idle") {
    toast("Сначала «Промежуточные» или «Итоги»");
    return;
  }
  if (state.isFinal || state.mode === "ready" || state.mode === "award") {
    if (state.mode === "award" && !state.awardReveal) {
      state.awardReveal = 1;
      afterChange();
      return;
    }
    const rows = ranked(state.teams, rankWidth());
    const queue = finalQueue(rows, state.awards);
    const next = state.awardIndex + 1;
    if (next >= queue.length) {
      toast("Итоги показаны");
      return;
    }
    const item = queue[next];
    state.awardIndex = next;
    state.awardReveal = 0;
    if (item.type === "table") {
      state.mode = "table";
      state.lastToShow = 1;
      state.awardKind = "";
    } else {
      state.mode = "award";
      state.awardKind = item.kind;
    }
    afterChange();
    return;
  }
  if (state.mode === "table") {
    if (state.lastToShow > 1) {
      state.lastToShow -= 1;
      afterChange();
      return;
    }
    toast("Таблица полностью");
  }
}

async function openHall() {
  try {
    const st = await fetch("/api/status", { cache: "no-store" }).then((r) => r.json());
    const url = st.display_alive ? "/api/cycle-display" : "/api/open-display";
    const r = await fetch(url).then((x) => x.json());
    if (!r.ok) {
      toast(r.error || "Не открыл зал");
      return;
    }
    if (r.moved) toast(`Зал переключён на монитор ${(r.monitor ?? 0) + 1}. Ещё раз — другой монитор`);
    else toast(r.warning || "Зал открыт. Ещё раз — другой монитор. F11 на зале");
  } catch {
    toast("Сервер не ответил");
  }
}

async function loadBackgrounds(selectName) {
  try {
    const data = await fetch("/api/bg", { cache: "no-store" }).then((r) => r.json());
    const files = data.files || [];
    const keep = selectName || state.theme.background || "";
    bgSelect.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = files.length ? "без картинки" : "нет файлов в bg";
    bgSelect.append(empty);
    for (const name of files) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      bgSelect.append(opt);
    }
    if (keep && files.includes(keep)) bgSelect.value = keep;
  } catch {
    /* ignore */
  }
}

titleEl.addEventListener("input", () => {
  state.title = titleEl.value;
  afterChange();
});

function fileTitle() {
  return (state.title || "результаты").trim().replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60) || "результаты";
}

async function saveExcel() {
  const tours = state.tours;
  const rows = ranked(state.teams, rankWidth()).map((t) => ({
    place: t.place,
    name: t.name,
    scores: t.scores,
    score: t.score,
  }));
  try {
    const res = await fetch("/api/export.xlsx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: state.title, tours, rows }),
    });
    if (!res.ok) {
      toast("Не сохранил Excel");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileTitle()}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Сохранил Excel");
  } catch {
    toast("Не сохранил Excel");
  }
}

function savePack() {
  const pack = {
    version: 1,
    title: state.title,
    tours: state.tours,
    teams: state.teams,
    theme: state.theme,
    awards: state.awards,
  };
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fileTitle()}.gamescore.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Комплект сохранён. Фон — файл из папки bg");
}

function applyPack(pack) {
  if (!pack || typeof pack !== "object") {
    toast("Не тот файл");
    return;
  }
  const tours = clampTours(pack.tours || state.tours);
  const teams = Array.isArray(pack.teams) ? pack.teams : [];
  if (!teams.length) {
    toast("В комплекте нет команд");
    return;
  }
  state.title = String(pack.title || "");
  state.tours = tours;
  state.teams = teams.map((t, i) => ({
    id: String(t.id || `t${i + 1}`),
    name: String(t.name || `Команда ${i + 1}`),
    scores: fitScores(t.scores, tours),
  }));
  if (pack.theme && typeof pack.theme === "object") {
    state.theme = { ...state.theme, ...pack.theme };
  }
  if (pack.awards && typeof pack.awards === "object") {
    state.awards = { ...state.awards, ...pack.awards };
  }
  state.mode = "idle";
  state.isFinal = false;
  afterChange();
  loadBackgrounds(state.theme.background);
  toast("Комплект открыт");
}

document.getElementById("addTeam").addEventListener("click", addTeam);
document.getElementById("saveExcel").addEventListener("click", saveExcel);
document.getElementById("savePack").addEventListener("click", savePack);
document.getElementById("loadPack").addEventListener("click", () => document.getElementById("packUpload").click());
document.getElementById("packUpload").addEventListener("change", async () => {
  const file = document.getElementById("packUpload").files && document.getElementById("packUpload").files[0];
  document.getElementById("packUpload").value = "";
  if (!file) return;
  try {
    applyPack(JSON.parse(await file.text()));
  } catch {
    toast("Не прочитал комплект");
  }
});
document.getElementById("resetScores").addEventListener("click", () => {
  if (!confirm("Сбросить счёт у всех команд?")) return;
  for (const t of state.teams) t.scores = empties(state.tours);
  afterChange();
});
document.getElementById("openDisplay").addEventListener("click", openHall);
document.getElementById("animBtn").addEventListener("click", stepAnim);
document.getElementById("allBtn").addEventListener("click", showAllTable);
document.getElementById("hideBtn").addEventListener("click", () => {
  state.mode = "idle";
  state.isFinal = false;
  state.awardKind = "";
  afterChange();
});
document.getElementById("checkBtn").addEventListener("click", () => {
  const on = !document.getElementById("pult").classList.contains("is-preview");
  setPreview(on);
});
document.getElementById("previewClose").addEventListener("click", () => setPreview(false));
document.getElementById("liveBtn").addEventListener("click", () => startShow(false));
document.getElementById("finalBtn").addEventListener("click", () => startShow(true));

for (const btn of document.querySelectorAll("[data-tours]")) {
  btn.addEventListener("click", () => setTours(Number(btn.dataset.tours)));
}

awardMiddle.addEventListener("change", () => {
  state.awards.middle = awardMiddle.checked;
  afterChange();
});
awardPenult.addEventListener("change", () => {
  state.awards.penultimate = awardPenult.checked;
  afterChange();
});

bgSelect.addEventListener("change", () => {
  state.theme.background = bgSelect.value;
  afterChange();
});
colorFont.addEventListener("input", () => {
  state.theme.font = colorFont.value;
  afterChange();
});
colorHead.addEventListener("input", () => {
  state.theme.head = colorHead.value;
  afterChange();
});
colorBar.addEventListener("input", () => {
  state.theme.bar = colorBar.value;
  afterChange();
});
colorTable.addEventListener("input", () => {
  state.theme.table = colorTable.value;
  afterChange();
});
tableScale.addEventListener("input", () => {
  state.theme.tableScale = Number(tableScale.value) || 125;
  tableScaleVal.textContent = `${state.theme.tableScale}%`;
  afterChange();
});
document.getElementById("clearBg").addEventListener("click", () => {
  state.theme.background = "";
  bgSelect.value = "";
  afterChange();
});
document.getElementById("pickBg").addEventListener("click", () => bgUpload.click());
bgUpload.addEventListener("change", async () => {
  const file = bgUpload.files && bgUpload.files[0];
  bgUpload.value = "";
  if (!file) return;
  const body = new FormData();
  body.append("file", file, file.name);
  try {
    const data = await fetch("/api/bg", { method: "POST", body }).then((r) => r.json());
    if (!data.ok) {
      toast(data.error || "Не загрузил фон");
      return;
    }
    state.theme.background = data.name;
    await loadBackgrounds(data.name);
    afterChange();
    toast(`Фон: ${data.name}`);
  } catch {
    toast("Не загрузил фон");
  }
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.key !== " ") return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  e.preventDefault();
  stepAnim();
});

tableWrap.addEventListener("keydown", (e) => {
  const keys = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Enter: 1 };
  if (!keys[e.key]) return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  const r = Number(el.dataset.row);
  const c = Number(el.dataset.col);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return;
  const rows = state.teams.length;
  const cols = 1 + state.tours;
  let nr = r;
  let nc = c;
  if (e.key === "ArrowLeft") {
    nc -= 1;
    if (nc < 0) {
      nr -= 1;
      nc = cols - 1;
    }
  } else if (e.key === "ArrowRight") {
    nc += 1;
    if (nc >= cols) {
      nr += 1;
      nc = 0;
    }
  } else if (e.key === "ArrowUp" || e.key === "Enter") {
    nr += e.key === "Enter" ? 1 : -1;
  } else if (e.key === "ArrowDown") {
    nr += 1;
  }
  if (e.key === "Enter" && nr >= rows) {
    e.preventDefault();
    if (state.teams.length >= MAX_TEAMS) {
      toast(`Максимум ${MAX_TEAMS} команд.`);
      return;
    }
    state.teams.push(newTeam(state.teams, state.tours));
    el.blur();
    afterChange();
    const added = tableWrap.querySelector(`[data-row="${state.teams.length - 1}"][data-col="${c}"]`);
    if (added) {
      added.focus();
      if (typeof added.select === "function") added.select();
      added.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return;
  e.preventDefault();
  const next = tableWrap.querySelector(`[data-row="${nr}"][data-col="${nc}"]`);
  if (next) {
    next.focus();
    if (typeof next.select === "function") next.select();
  }
});

bus.on((msg) => {
  if (msg?.type === "state" && msg.from !== "operator" && msg.state) {
    state = msg.state;
    paint();
  }
});

if (!state.theme) state.theme = defaultState().theme;
state.tours = clampTours(state.tours);
for (const t of state.teams) t.scores = fitScores(t.scores, state.tours);
bus.publish(state);
paint();
loadBackgrounds(state.theme.background);
bindPoster({ getState: () => state, toast });

const pult = document.getElementById("pult");
function setView(view) {
  pult.dataset.view = view;
  document.getElementById("tabTable").classList.toggle("is-live", view === "table");
  document.getElementById("tabHall").classList.toggle("is-live", view === "hall");
  if (view === "table" && !typingInTable()) paintTable();
}
document.getElementById("tabTable").addEventListener("click", () => setView("table"));
document.getElementById("tabHall").addEventListener("click", () => setView("hall"));
setView(pult.dataset.view || "table");
