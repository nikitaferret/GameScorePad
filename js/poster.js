import { playedTours, ranked } from "./bus.js";

const SIZE = 2160;
const SCALE = SIZE / 1080;
const POSTER_KEY = "gamescorepad-poster-v1";
const PRIZE = {
  1: { frame: "#C9A227", medal: "#E8C547" },
  2: { frame: "#8E99A6", medal: "#A8B0BA" },
  3: { frame: "#B87333", medal: "#C67A32" },
};

let getState = () => null;
let toast = () => {};
let logoImg = null;
let bgImg = null;
let bgToken = "";
let logoToken = "";
let drawSeq = 0;

function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDate(iso) {
  const t = String(iso || "").trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return t;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function clampLogoScale(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 100;
  return Math.max(40, Math.min(220, Math.round(v)));
}

function loadSettings() {
  const base = {
    customTitle: "",
    customBg: "",
    date: todayIso(),
    logo: "",
    logoScale: 100,
  };
  try {
    const raw = localStorage.getItem(POSTER_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return { ...base, ...parsed, logoScale: clampLogoScale(parsed.logoScale) };
  } catch {
    return base;
  }
}

function saveSettings(s) {
  const slim = {
    date: s.date,
    logoScale: clampLogoScale(s.logoScale),
    logo: (s.logo || "").length < 900000 ? s.logo : "",
  };
  try {
    localStorage.setItem(POSTER_KEY, JSON.stringify(slim));
  } catch {
    slim.logo = "";
    try {
      localStorage.setItem(POSTER_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

function settingsFromUi() {
  return {
    customTitle: document.getElementById("posterTitle")?.value || "",
    customBg: document.getElementById("poster")?.dataset.customBg || "",
    date: document.getElementById("posterDate")?.value || "",
    logo: document.getElementById("poster")?.dataset.logo || "",
    logoScale: clampLogoScale(document.getElementById("posterLogoScale")?.value),
  };
}

function applySettings(s) {
  const titleEl = document.getElementById("posterTitle");
  titleEl.disabled = false;
  titleEl.value = s.customTitle || "";
  document.getElementById("posterDate").value = s.date || todayIso();
  const scale = clampLogoScale(s.logoScale);
  const scaleEl = document.getElementById("posterLogoScale");
  scaleEl.value = String(scale);
  document.getElementById("posterLogoScaleVal").textContent = `${scale}%`;
  const root = document.getElementById("poster");
  root.dataset.logo = s.logo || "";
  root.dataset.customBg = s.customBg || "";
  document.getElementById("posterLogoClear").hidden = !s.logo;
  document.getElementById("posterBgHint").textContent = s.customBg
    ? "свой файл"
    : gspBgName() || "фон зала не выбран";
}

function gspBgName() {
  return String(getState()?.theme?.background || "").trim();
}

function posterTitle() {
  return String(document.getElementById("posterTitle")?.value || "").trim();
}

function fileTitle() {
  return (posterTitle() || "результаты").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60) || "результаты";
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

function drawCover(ctx, img, w, h) {
  if (!img || !img.width) return;
  const ir = img.width / img.height;
  const r = w / h;
  let dw;
  let dh;
  if (ir > r) {
    dh = h;
    dw = h * ir;
  } else {
    dw = w;
    dh = w / ir;
  }
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawContain(ctx, img, x, y, w, h) {
  if (!img || !img.width) return;
  const ir = img.width / img.height;
  const r = w / h;
  let dw;
  let dh;
  if (ir > r) {
    dw = w;
    dh = w / ir;
  } else {
    dh = h;
    dw = h * ir;
  }
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function ellipsize(ctx, text, maxW) {
  const s = String(text || "");
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${s.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${s.slice(0, lo)}…` : "…";
}

function wrapTitle(ctx, text, maxW, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${cur} ${words[i]}`;
    if (ctx.measureText(next).width <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines - 1) {
        const rest = [cur, ...words.slice(i + 1)].join(" ");
        lines.push(ellipsize(ctx, rest, maxW));
        return lines;
      }
    }
  }
  lines.push(cur);
  return lines;
}

function hex(c, fallback) {
  const s = String(c || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

async function ensureAssets() {
  const s = settingsFromUi();
  const st = getState();
  let nextBg = s.customBg || "";
  if (!nextBg) {
    const name = String(st?.theme?.background || "").trim();
    if (name) nextBg = `/bg/${encodeURIComponent(name)}`;
  }
  const nextLogo = s.logo || "";
  if (nextBg !== bgToken) {
    bgToken = nextBg;
    bgImg = await loadImage(nextBg);
  }
  if (nextLogo !== logoToken) {
    logoToken = nextLogo;
    logoImg = await loadImage(nextLogo);
  }
}

function drawPoster(ctx) {
  const st = getState();
  const theme = st?.theme || {};
  const font = hex(theme.font, "#F6F2E8");
  const head = hex(theme.head, font);
  const bar = hex(theme.bar, "#5AA8D6");
  const tableBg = hex(theme.table, "#14243C");
  const s = settingsFromUi();
  const title = posterTitle().toUpperCase();
  const dateText = formatDate(s.date);

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "#050508";
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (bgImg) drawCover(ctx, bgImg, SIZE, SIZE);
  else {
    const g = ctx.createRadialGradient(SIZE * 0.5, SIZE * 0.4, 40 * SCALE, SIZE * 0.5, SIZE * 0.5, SIZE * 0.75);
    g.addColorStop(0, "#10131b");
    g.addColorStop(1, "#050508");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  const pad = 44 * SCALE;
  const colW = (SIZE - pad * 2) / 3;
  const leftX = pad;
  const midX = pad + colW;
  const rightX = pad + colW * 2;
  const headerY = pad;
  const logoBox = logoImg ? Math.min(colW, 96 * SCALE * (clampLogoScale(s.logoScale) / 100)) : 0;
  const dateSize = 34 * SCALE;

  ctx.fillStyle = head;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let titleSize = 52 * SCALE;
  ctx.font = `900 ${titleSize}px "Segoe UI", "Arial Narrow", Arial, sans-serif`;
  let lines = wrapTitle(ctx, title, colW - 8 * SCALE, 2);
  while (titleSize > 28 * SCALE && lines.some((ln) => ctx.measureText(ln).width > colW - 8 * SCALE)) {
    titleSize -= 2 * SCALE;
    ctx.font = `900 ${titleSize}px "Segoe UI", "Arial Narrow", Arial, sans-serif`;
    lines = wrapTitle(ctx, title, colW - 8 * SCALE, 2);
  }
  const lineH = titleSize * 1.12;
  const titleBlock = Math.max(lineH, lines.length * lineH);
  const headerH = Math.max(titleBlock, logoBox, dateText ? dateSize : 0);

  if (logoImg) {
    drawContain(ctx, logoImg, leftX + (colW - logoBox) / 2, headerY + (headerH - logoBox) / 2, logoBox, logoBox);
  }

  ctx.fillStyle = head;
  ctx.font = `900 ${titleSize}px "Segoe UI", "Arial Narrow", Arial, sans-serif`;
  let ty = headerY + headerH / 2 - titleBlock / 2 + lineH / 2;
  for (const ln of lines) {
    ctx.fillText(ln, midX + colW / 2, ty);
    ty += lineH;
  }

  if (dateText) {
    ctx.font = `800 ${dateSize}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = head;
    ctx.fillText(dateText, rightX + colW / 2, headerY + headerH / 2);
  }

  const tours = Number(st?.tours) || 7;
  const played = playedTours(st?.teams || [], tours) || tours;
  const rows = ranked(st?.teams || [], played);
  const showTours = played;
  const labels = ["М", "Команда", ...Array.from({ length: showTours }, (_, i) => String(i + 1)), "Σ"];
  const tableTop = headerY + headerH + 10 * SCALE;
  const tableLeft = pad;
  const tableW = SIZE - pad * 2;
  const tableBottom = SIZE - pad;
  const tableH = tableBottom - tableTop;
  const n = Math.max(1, rows.length);
  const rowCount = n + 1;
  let fs = Math.min(36 * SCALE, Math.floor((tableH / rowCount) * 0.62));
  fs = Math.max(14 * SCALE, fs);
  const rowH = tableH / rowCount;
  const placeW = Math.max(56 * SCALE, Math.round(fs * 2.1));
  const sumW = Math.max(70 * SCALE, Math.round(fs * 2.4));
  const tourW = Math.max(42 * SCALE, Math.round(fs * 1.7));
  const toursW = tourW * showTours;
  const nameW = Math.max(120 * SCALE, tableW - placeW - toursW - sumW);
  const colWidths = [placeW, nameW, ...Array.from({ length: showTours }, () => tourW), sumW];
  const grid = "rgba(128,128,128,0.7)";
  const headFs = Math.max(12 * SCALE, Math.round(fs * 0.95));

  function colX(i) {
    let x = tableLeft;
    for (let k = 0; k < i; k++) x += colWidths[k];
    return x;
  }

  ctx.textBaseline = "middle";
  for (let r = 0; r < rowCount; r++) {
    const y = tableTop + r * rowH;
    const team = r === 0 ? null : rows[r - 1];
    for (let c = 0; c < labels.length; c++) {
      const x = colX(c);
      const w = colWidths[c];
      ctx.fillStyle = r === 0 ? "rgba(20,36,60,0.35)" : tableBg;
      ctx.fillRect(x, y, w, rowH);
      ctx.strokeStyle = grid;
      ctx.lineWidth = SCALE;
      ctx.strokeRect(x + 0.5 * SCALE, y + 0.5 * SCALE, w - SCALE, rowH - SCALE);
    }
    if (r === 0) {
      ctx.fillStyle = head;
      ctx.font = `900 ${headFs}px "Segoe UI", Arial, sans-serif`;
      for (let c = 0; c < labels.length; c++) {
        const x = colX(c);
        const w = colWidths[c];
        ctx.textAlign = c === 1 ? "left" : "center";
        const tx = c === 1 ? x + 12 * SCALE : x + w / 2;
        ctx.fillText(labels[c], tx, y + rowH / 2);
      }
      continue;
    }
    const prize = PRIZE[team.place];
    ctx.fillStyle = font;
    ctx.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`;

    const medal = Math.min(rowH - 10 * SCALE, placeW - 16 * SCALE, fs * 1.45);
    const mx = colX(0) + (placeW - medal) / 2;
    const my = y + (rowH - medal) / 2;
    ctx.fillStyle = prize ? prize.medal : "rgba(128,128,128,0.28)";
    ctx.beginPath();
    ctx.roundRect(mx, my, medal, medal, Math.max(6 * SCALE, medal * 0.22));
    ctx.fill();
    ctx.fillStyle = prize ? "#1a1406" : font;
    ctx.textAlign = "center";
    ctx.fillText(String(team.place), colX(0) + placeW / 2, y + rowH / 2);

    ctx.fillStyle = font;
    ctx.textAlign = "left";
    ctx.fillText(ellipsize(ctx, team.name || " ", nameW - 20 * SCALE), colX(1) + 12 * SCALE, y + rowH / 2);

    ctx.textAlign = "center";
    for (let i = 0; i < showTours; i++) {
      const raw = team.scores?.[i];
      const txt = raw === null || raw === undefined || raw === "" ? "" : String(raw);
      ctx.fillText(txt, colX(2 + i) + tourW / 2, y + rowH / 2);
    }
    ctx.fillStyle = bar;
    ctx.fillText(String(team.score), colX(labels.length - 1) + sumW / 2, y + rowH / 2);

    if (prize) {
      ctx.strokeStyle = prize.frame;
      ctx.lineWidth = 4 * SCALE;
      ctx.strokeRect(tableLeft + 2 * SCALE, y + 2 * SCALE, tableW - 4 * SCALE, rowH - 4 * SCALE);
    }
  }
}

function fitPosterPreview() {
  const stage = document.querySelector(".poster-stage");
  const canvas = document.getElementById("posterCanvas");
  if (!stage || !canvas) return;
  const side = Math.max(80, Math.floor(Math.min(stage.clientWidth, stage.clientHeight)));
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
}

export async function paintPoster() {
  const root = document.getElementById("poster");
  const canvas = document.getElementById("posterCanvas");
  if (!root || !canvas || !document.getElementById("pult").classList.contains("is-poster")) return;
  fitPosterPreview();
  const hint = document.getElementById("posterBgHint");
  if (hint && !settingsFromUi().customBg) {
    hint.textContent = gspBgName() || "фон зала не выбран";
  }
  const seq = ++drawSeq;
  await ensureAssets();
  if (seq !== drawSeq) return;
  const ctx = canvas.getContext("2d");
  drawPoster(ctx);
}

function setPoster(on) {
  const pult = document.getElementById("pult");
  pult.classList.toggle("is-poster", on);
  if (on) {
    pult.classList.remove("is-preview");
    const s = loadSettings();
    s.customTitle = String(getState()?.title || "").trim();
    s.customBg = "";
    applySettings(s);
    paintPoster();
    requestAnimationFrame(fitPosterPreview);
  }
}

function readFileData(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function pickFile(inputId, cb) {
  const input = document.getElementById(inputId);
  input.value = "";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    try {
      await cb(file);
    } catch {
      toast("Не прочитал файл");
    }
  };
  input.click();
}

async function downloadPng() {
  const canvas = document.getElementById("posterCanvas");
  await paintPoster();
  canvas.toBlob((blob) => {
    if (!blob) {
      toast("Не собрал картинку");
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileTitle()}-1x1.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Картинка 1:1 сохранена");
  }, "image/png");
}

export function bindPoster(opts) {
  getState = opts.getState;
  toast = opts.toast || toast;
  const s0 = loadSettings();
  applySettings(s0);

  document.getElementById("posterBtn").addEventListener("click", () => setPoster(true));
  document.getElementById("posterClose").addEventListener("click", () => setPoster(false));
  document.getElementById("posterSave").addEventListener("click", downloadPng);
  document.getElementById("posterTitle").addEventListener("input", () => {
    paintPoster();
  });
  document.getElementById("posterDate").addEventListener("input", () => {
    const s = settingsFromUi();
    saveSettings(s);
    paintPoster();
  });
  document.getElementById("posterLogoScale").addEventListener("input", () => {
    const s = settingsFromUi();
    document.getElementById("posterLogoScaleVal").textContent = `${s.logoScale}%`;
    saveSettings(s);
    paintPoster();
  });
  document.getElementById("posterBgPick").addEventListener("click", () => {
    pickFile("posterBgUpload", async (file) => {
      const data = await readFileData(file);
      const s = settingsFromUi();
      s.customBg = data;
      applySettings(s);
      saveSettings(s);
      paintPoster();
      toast(`Фон: ${file.name}`);
    });
  });
  document.getElementById("posterLogoPick").addEventListener("click", () => {
    pickFile("posterLogoUpload", async (file) => {
      const data = await readFileData(file);
      const s = settingsFromUi();
      s.logo = data;
      applySettings(s);
      saveSettings(s);
      paintPoster();
      toast(`Логотип: ${file.name}`);
    });
  });
  document.getElementById("posterLogoClear").addEventListener("click", () => {
    const s = settingsFromUi();
    s.logo = "";
    applySettings(s);
    saveSettings(s);
    paintPoster();
  });
  window.addEventListener("resize", () => {
    if (posterOpen()) fitPosterPreview();
  });
}

export function posterOpen() {
  return document.getElementById("pult")?.classList.contains("is-poster");
}
