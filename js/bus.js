export const CHANNEL = "gamescorepad-v1";
export const STORAGE_KEY = "gamescorepad-state-v2";
export const MAX_TEAMS = 24;
export const MIN_TOURS = 6;
export const MAX_TOURS = 8;

export function defaultTheme() {
  return {
    background: "",
    font: "#F6F2E8",
    head: "#F6F2E8",
    bar: "#5AA8D6",
    table: "#14243C",
    tableScale: 125,
  };
}

export function empties(n) {
  return Array.from({ length: n }, () => null);
}

export function zeros(n) {
  return Array.from({ length: n }, () => 0);
}

export function scoreFilled(v) {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "number" && Number.isNaN(v)) return false;
  return true;
}

export function clampTours(n) {
  const v = Number(n) || 7;
  return Math.min(MAX_TOURS, Math.max(MIN_TOURS, Math.round(v)));
}

export function fitScores(scores, tours) {
  const src = Array.isArray(scores) ? scores : [];
  const out = empties(tours);
  for (let i = 0; i < tours; i++) {
    if (!scoreFilled(src[i])) continue;
    const n = Number(src[i]);
    out[i] = Number.isFinite(n) ? n : null;
  }
  return out;
}

export function defaultState() {
  const tours = 7;
  return {
    rev: 1,
    title: "",
    mode: "idle",
    isFinal: false,
    tours,
    lastToShow: 5,
    awardIndex: -1,
    awardKind: "",
    awardReveal: 0,
    awards: { middle: false, penultimate: false },
    teams: [
      { id: "t1", name: "Команда 1", scores: empties(tours) },
      { id: "t2", name: "Команда 2", scores: empties(tours) },
      { id: "t3", name: "Команда 3", scores: empties(tours) },
      { id: "t4", name: "Команда 4", scores: empties(tours) },
    ],
    theme: defaultTheme(),
  };
}

function nextTeamId(teams) {
  let n = 1;
  const used = new Set((teams || []).map((t) => t.id));
  while (used.has(`t${n}`)) n += 1;
  return `t${n}`;
}

export function newTeam(teams, tours, name) {
  const i = (teams || []).length + 1;
  return {
    id: nextTeamId(teams),
    name: name || `Команда ${i}`,
    scores: empties(tours || 7),
  };
}

export function teamSum(team, tours) {
  const n = tours || (team.scores || []).length;
  let s = 0;
  for (let i = 0; i < n; i++) s += Number(team.scores?.[i]) || 0;
  return s;
}

export function playedTours(teams, tours) {
  let last = 0;
  const n = tours || 0;
  for (const t of teams || []) {
    for (let i = 0; i < n; i++) {
      if (scoreFilled(t.scores?.[i])) last = Math.max(last, i + 1);
    }
  }
  return last;
}

export function compareTeams(a, b, tours) {
  const sa = teamSum(a, tours);
  const sb = teamSum(b, tours);
  if (sb !== sa) return sb - sa;
  for (let i = (tours || 0) - 1; i >= 0; i--) {
    const da = Number(a.scores?.[i]) || 0;
    const db = Number(b.scores?.[i]) || 0;
    if (db !== da) return db - da;
  }
  return (a.order ?? 0) - (b.order ?? 0);
}

export function ranked(teams, tours) {
  const width = tours || 7;
  const list = (teams || []).map((t, i) => ({
    ...t,
    scores: fitScores(t.scores, width),
    score: teamSum(t, width),
    order: i,
  }));
  list.sort((a, b) => compareTeams(a, b, width));
  return list.map((t, i) => ({ ...t, place: i + 1 }));
}

export function middlePlace(n) {
  if (n < 3) return 0;
  if (n % 2 === 0) return n / 2 + 1;
  return Math.ceil(n / 2);
}

export function placeLabel(place) {
  if (place === 1) return "Первое место";
  if (place === 2) return "Второе место";
  if (place === 3) return "Третье место";
  return `${place} место`;
}

export function finalQueue(rows, flags) {
  const n = rows.length;
  const out = [];
  const top = new Set([1, 2, 3]);
  if (flags?.penultimate && n >= 2) {
    const t = rows.find((r) => r.place === n - 1);
    if (t && !top.has(t.place)) {
      out.push({ type: "award", kind: "penultimate", label: "Предпоследнее место", team: t });
    }
  }
  if (flags?.middle) {
    const t = rows.find((r) => r.place === middlePlace(n));
    if (t && !top.has(t.place) && t.place !== n - 1) {
      out.push({ type: "award", kind: "middle", label: "Середина таблицы", team: t });
    }
  }
  for (const place of [3, 2, 1]) {
    const t = rows.find((r) => r.place === place);
    if (t) out.push({ type: "award", kind: `place${place}`, label: placeLabel(place), team: t });
  }
  out.push({ type: "table" });
  return out;
}

function migrate(parsed, base) {
  const tours = clampTours(parsed.tours || 7);
  const theme = { ...base.theme, ...((parsed && parsed.theme) || {}) };
  const awards = { ...base.awards, ...((parsed && parsed.awards) || {}) };
  const teams =
    Array.isArray(parsed.teams) && parsed.teams.length
      ? parsed.teams.map((t, i) => {
          let scores = t.scores;
          if (!Array.isArray(scores)) {
            scores = empties(tours);
            scores[0] = Number(t.score) || 0;
          }
          return {
            id: String(t.id || `t${i + 1}`),
            name: String(t.name || `Команда ${i + 1}`),
            scores: fitScores(scores, tours),
          };
        })
      : base.teams.map((t) => ({ ...t, scores: fitScores(t.scores, tours) }));
  const mode =
    parsed.mode === "table" || parsed.mode === "award" || parsed.mode === "idle" || parsed.mode === "ready"
      ? parsed.mode
      : parsed.mode === "live" || parsed.mode === "final"
        ? "table"
        : "idle";
  return {
    ...base,
    ...parsed,
    tours,
    teams,
    theme,
    awards,
    mode,
    isFinal: !!parsed.isFinal || parsed.mode === "final",
    lastToShow: Number(parsed.lastToShow) || teams.length + 1,
    awardIndex: Number(parsed.awardIndex ?? -1),
    awardKind: String(parsed.awardKind || ""),
    awardReveal: Number(parsed.awardReveal) || 0,
    title: String(parsed.title || ""),
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrate(JSON.parse(raw), defaultState());
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export class Bus {
  constructor(role) {
    this.role = role;
    this.bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
    this.listeners = new Set();
    if (this.bc) this.bc.onmessage = (ev) => this._emit(ev.data);
    window.addEventListener("storage", (ev) => {
      if (ev.key === STORAGE_KEY && ev.newValue) {
        try {
          this._emit({ type: "state", state: JSON.parse(ev.newValue) });
        } catch {
          /* ignore */
        }
      }
    });
  }

  publish(state) {
    saveState(state);
    const msg = { type: "state", state, from: this.role };
    this.bc?.postMessage(msg);
    this._emit(msg);
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(msg) {
    for (const fn of this.listeners) fn(msg);
  }
}
