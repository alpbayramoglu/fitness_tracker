"use strict";

// ---------- IndexedDB ----------
const TABLES = ["exercises", "workouts", "sets", "nutrition", "metrics", "measurements", "days", "day_exercises", "exercise_notes"];
let db;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("fitness", 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const t of TABLES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const getAll = (store) => tx(store, "readonly", (s) => s.getAll());
const getOne = (store, id) => tx(store, "readonly", (s) => s.get(id));
const putRaw = (store, row) => tx(store, "readwrite", (s) => s.put(row));
const getMeta = (k) => tx("meta", "readonly", (s) => s.get(k));
const setMeta = (k, v) => tx("meta", "readwrite", (s) => s.put(v, k));

// in-memory cache of live (non-deleted) rows, refreshed after every write
const cache = {};
async function loadCache() {
  for (const t of TABLES) cache[t] = (await getAll(t)).filter((r) => !r.deleted);
}

const putMany = (store, rows) => tx(store, "readwrite", (s) => { for (const r of rows) s.put(r); });

async function save(table, row) {
  const full = { deleted: 0, ...row, updated_at: Date.now() };
  await putRaw(table, full);
  await loadCache();
  updateBadge();
  return full;
}
async function remove(table, id) {
  const row = await getOne(table, id);
  if (row) await save(table, { ...row, deleted: 1 });
}

// ---------- first-run seed (ids match the Mac archive) ----------
const SEED_METRICS = [
  ["weight", "Kilo", "kg"], ["body_fat", "Yağ oranı", "%"],
  ["neck", "Boyun", "cm"], ["shoulder", "Omuz", "cm"], ["chest", "Göğüs", "cm"],
  ["arm_r", "Sağ kol", "cm"], ["arm_l", "Sol kol", "cm"],
  ["forearm_r", "Sağ ön kol", "cm"], ["forearm_l", "Sol ön kol", "cm"],
  ["waist", "Bel", "cm"], ["hips", "Kalça", "cm"],
  ["thigh_r", "Sağ bacak", "cm"], ["thigh_l", "Sol bacak", "cm"],
  ["calf_r", "Sağ baldır", "cm"], ["calf_l", "Sol baldır", "cm"],
];
const SEED_EXERCISES = [
  ["bench", "Bench Press", "Göğüs"], ["incline_db", "Incline Dumbbell Press", "Göğüs"],
  ["squat", "Squat", "Bacak"], ["deadlift", "Deadlift", "Sırt"],
  ["rdl", "Romanian Deadlift", "Bacak"], ["leg_press", "Leg Press", "Bacak"],
  ["ohp", "Overhead Press", "Omuz"], ["lateral", "Lateral Raise", "Omuz"],
  ["pullup", "Pull-up", "Sırt"], ["row", "Barbell Row", "Sırt"],
  ["lat_pd", "Lat Pulldown", "Sırt"], ["curl", "Biceps Curl", "Kol"],
  ["triceps_pd", "Triceps Pushdown", "Kol"], ["leg_curl", "Leg Curl", "Bacak"],
  ["calf_raise", "Calf Raise", "Bacak"],
];
async function seed() {
  if (await getMeta("seeded")) return;
  // updated_at = 1 so any later user edit wins; not counted as "unexported"
  await putMany("metrics", SEED_METRICS.map(([k, name, unit], i) => ({ id: "metric-" + k, name, unit, sort_order: i, updated_at: 1, deleted: 0 })));
  await putMany("exercises", SEED_EXERCISES.map(([k, name, muscle_group]) => ({ id: "ex-" + k, name, muscle_group, updated_at: 1, deleted: 0 })));
  await setMeta("seeded", 1);
}

// ---------- export to Mac / restore ----------
const EXPORT_FORMAT = "fitness-export";

async function unexportedCount() {
  const since = (await getMeta("lastExport")) || 0;
  let n = 0;
  for (const t of TABLES) n += (await getAll(t)).filter((r) => r.updated_at > since && r.updated_at > 1).length;
  return n;
}

async function exportFile() {
  const now = Date.now();
  const tables = {};
  for (const t of TABLES) tables[t] = await getAll(t);
  const payload = { format: EXPORT_FORMAT, version: 1, exported_at: now, source: "iphone", tables };
  const d = new Date();
  const stamp = today() + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
  const file = new File([JSON.stringify(payload)], `fitness-export-${stamp}.json`, { type: "application/json" });
  const download = () => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if (e.name === "AbortError") return; // user closed the share sheet
        download();
      }
    } else {
      download();
    }
    await setMeta("lastExport", now);
    toast("Dışa aktarıldı");
  } catch (e) {
    toast("Aktarılamadı: " + e.message);
  } finally {
    updateBadge();
  }
}

async function restoreFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("Dosya okunamadı"); }
  if (data?.format !== EXPORT_FORMAT || !data.tables) return toast("Bu bir fitness yedeği değil");
  if (!confirm("Yedekteki kayıtlar telefondakilerle birleştirilecek. Devam?")) return;
  let n = 0;
  for (const t of TABLES) {
    const incoming = [];
    for (const r of data.tables[t] || []) {
      if (!r || typeof r.id !== "string") continue;
      const local = await getOne(t, r.id);
      if (!local || r.updated_at > local.updated_at) incoming.push(r);
    }
    await putMany(t, incoming);
    n += incoming.length;
  }
  // on a fresh phone, what came from the Mac is already archived there
  if (data.source === "mac" && !(await getMeta("lastExport"))) await setMeta("lastExport", data.exported_at);
  await setMeta("seeded", 1);
  await loadCache();
  renderAll();
  updateBadge();
  toast(`${n} kayıt geri yüklendi`);
}

function setBadge(text, cls) {
  const b = $("#sync-badge");
  b.textContent = text;
  b.className = "sync-badge " + cls;
}
async function updateBadge() {
  const n = await unexportedCount();
  const last = await getMeta("lastExport");
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (n) setBadge(`${n} aktarılmadı`, days === null || days >= 7 ? "error" : "pending");
  else setBadge("✓ arşivde", "ok");
  const st = $("#s-status");
  if (st) {
    st.textContent = `Mac'e aktarılmamış kayıt: ${n}. Son aktarma: ${last ? new Date(last).toLocaleString("tr-TR") : "hiç"}.` +
      (n && days !== null && days >= 7 ? " Bir haftadan uzun süredir aktarılmadı." : "");
  }
}

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const fmt = (v) => (v == null ? "–" : Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ""));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const e1rm = (kg, reps, rir) => (kg && reps ? kg * (1 + (reps + (rir || 0)) / 30) : null);
const byName = (a, b) => a.name.localeCompare(b.name, "tr");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

const workoutById = () => Object.fromEntries(cache.workouts.map((w) => [w.id, w]));
const exerciseById = () => Object.fromEntries(cache.exercises.map((e) => [e.id, e]));

// ---------- navigation ----------
const TITLES = { workout: "Antrenman", nutrition: "Beslenme", measure: "Ölçüler", progress: "İlerleme", settings: "Ayarlar" };
function showView(name) {
  if (name === "workout" && $("#view-workout").classList.contains("active") && W.screen !== "days") go("days"); // tapping the active tab pops to the day list
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("#view-title").textContent = TITLES[name];
  updateHeader();
  if (name === "progress") renderProgress();
  if (name === "settings") { renderSettings(); updateBadge(); }
}

// ---------- workout: days → day → exercise ----------
// W.screen: "days" | "day" | "exercise"
let openedOn = today();
const W = { screen: "days", dayId: null, exId: null, date: today(), editMode: false, editingSetId: null };
const workoutId = (d) => "w-" + d;
const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const TR_DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const weekday = (ds) => TR_DAYS[new Date(ds + "T12:00:00").getDay()];
function fmtDate(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  return `${d} ${TR_MONTHS[m - 1]}` + (String(y) !== today().slice(0, 4) ? ` ${y}` : "");
}
function fmtRest(sec) {
  if (!sec) return "–";
  if (sec < 60) return `${sec} sn`;
  return sec % 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : `${sec / 60} dk`;
}
// "3x6-8 RIR 1 3dk", "3×8 rir0 90sn", "2x8-13 / RIR 0 / 60 sn" → {target_sets, rep_min, rep_max, target_rir, rest_sec}
function parseSpec(str) {
  const t = String(str || "").toLowerCase().replace(/,/g, ".").replace(/×/g, "x").replace(/\b(dinlenme|rest)\b/g, " ");
  const out = { target_sets: null, rep_min: null, rep_max: null, target_rir: null, rest_sec: null };
  let rest = t;
  let m = rest.match(/(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?/);
  if (m) {
    out.target_sets = Number(m[1]);
    out.rep_min = Number(m[2]);
    out.rep_max = Number(m[3] || m[2]);
    rest = rest.replace(m[0], " ");
  }
  if ((m = rest.match(/rir\s*(\d+(?:\.\d+)?)/))) { out.target_rir = Number(m[1]); rest = rest.replace(m[0], " "); }
  if ((m = rest.match(/(\d+:\d{1,2}|\d+(?:\.\d+)?\s*(?:dk|dakika|min|m|sn|saniye|sec|s)\b)/))) { out.rest_sec = parseRest(m[1]); rest = rest.replace(m[0], " "); }
  else if ((m = rest.match(/(?:^|[\s/])(\d+)\s*$/)) && out.target_sets) { out.rest_sec = Number(m[1]); rest = rest.replace(m[0], " "); } // bare trailing number = seconds
  const leftover = rest.replace(/[\s/·.-]+/g, "");
  if (leftover || (out.target_sets == null && out.rest_sec == null && out.target_rir == null)) return null;
  return out;
}
const repRange = (it) => (it.rep_min == null ? "" : it.rep_max && it.rep_max !== it.rep_min ? `${it.rep_min}-${it.rep_max}` : `${it.rep_min}`);
function specText(it, sep = " · ") {
  const parts = [];
  if (it.target_sets) parts.push(`${it.target_sets}×${repRange(it)}`);
  if (it.target_rir != null) parts.push(`RIR ${fmt(it.target_rir)}`);
  if (it.rest_sec) parts.push(`⏱ ${fmtRest(it.rest_sec)}`);
  return parts.join(sep) || "hedef yok";
}
const specInput = (it) => [it.target_sets ? `${it.target_sets}x${repRange(it)}` : "", it.target_rir != null ? `RIR ${fmt(it.target_rir)}` : "",
  it.rest_sec ? fmtRest(it.rest_sec).replace(" dk", "dk").replace(" sn", "sn") : ""].filter(Boolean).join(" ");
function parseRest(str) {
  const t = String(str || "").trim().toLowerCase().replace(",", ".");
  let m;
  if ((m = t.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(dk|d|m|min|dakika)$/))) return Math.round(Number(m[1]) * 60);
  if ((m = t.match(/^(\d+)\s*(sn|s|sec|saniye)?$/))) return Number(m[1]);
  return null;
}
const exNoteId = (date, exId) => `en-${date}-${exId}`;
const exNote = (date, exId) => cache.exercise_notes.find((n) => n.id === exNoteId(date, exId))?.notes || "";
const setText = (s) => `${fmt(s.weight_kg)} kg × ${fmt(s.reps)}${s.rir != null ? ` · RIR ${fmt(s.rir)}` : ""}`;
const setShort = (s) => `${fmt(s.weight_kg)}×${fmt(s.reps)}${s.rir != null ? " @" + fmt(s.rir) : ""}`;

const sortedDays = () => [...cache.days].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
const dayItems = (dayId) => cache.day_exercises.filter((i) => i.day_id === dayId).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
const dayItem = (dayId, exId) => cache.day_exercises.find((i) => i.day_id === dayId && i.exercise_id === exId);

function setsFor(exId, date) {
  const wmap = workoutById();
  return cache.sets
    .filter((s) => s.exercise_id === exId && wmap[s.workout_id] && wmap[s.workout_id].date === date)
    .sort((a, b) => a.set_no - b.set_no);
}
// past sessions of an exercise before `beforeDate`, newest first
function sessions(exId, beforeDate, limit = 99) {
  const wmap = workoutById();
  const dates = new Set();
  for (const s of cache.sets) {
    const w = wmap[s.workout_id];
    if (s.exercise_id === exId && w && w.date < beforeDate) dates.add(w.date);
  }
  return [...dates].sort().reverse().slice(0, limit).map((date) => ({ date, dayId: wmap[workoutId(date)]?.day_id, sets: setsFor(exId, date) }));
}
const lastSession = (exId, beforeDate) => sessions(exId, beforeDate, 1)[0] || null;

function saveRoute() {
  localStorageSet("route", JSON.stringify({ screen: W.screen, dayId: W.dayId, exId: W.exId }));
}
function go(screen, patch = {}) {
  Object.assign(W, { screen, editingSetId: null }, patch);
  if (screen !== "day") W.editMode = false;
  saveRoute();
  renderWorkout();
  window.scrollTo(0, 0);
}
function goBack() {
  if (W.screen === "exercise") go("day");
  else go("days");
}

function updateHeader() {
  const active = $("#view-workout").classList.contains("active");
  const back = $("#back-btn");
  if (!active) { back.classList.add("hidden"); return; }
  const day = cache.days.find((d) => d.id === W.dayId);
  const ex = cache.exercises.find((e) => e.id === W.exId);
  back.classList.toggle("hidden", W.screen === "days");
  $("#view-title").textContent = W.screen === "exercise" ? ex?.name || "" : W.screen === "day" ? day?.name || "" : "Antrenman";
}

function dateChip() {
  const other = W.date !== today();
  return `<label class="date-chip ${other ? "other" : ""}"><span>${other ? "⚠︎ " : ""}${fmtDate(W.date)}${other ? "" : " · bugün"}</span>
    <input type="date" data-act="date" value="${W.date}" max="${today()}"></label>`;
}

function renderWorkout() {
  // guard against routes to deleted items (e.g. after a restore)
  if (W.screen !== "days" && !cache.days.some((d) => d.id === W.dayId)) W.screen = "days";
  if (W.screen === "exercise" && !cache.exercises.some((e) => e.id === W.exId)) W.screen = "day";
  const root = $("#w-root");
  root.innerHTML = W.screen === "days" ? renderDays() : W.screen === "day" ? renderDay() : renderExercise();
  updateHeader();
  if (W.screen === "exercise") prefillForm();
}

function renderDays() {
  const days = sortedDays();
  const wmap = workoutById();
  const lastDone = {};
  for (const w of cache.workouts) if (w.day_id && (!lastDone[w.day_id] || w.date > lastDone[w.day_id])) {
    if (cache.sets.some((s) => s.workout_id === w.id)) lastDone[w.day_id] = w.date;
  }
  const todayDay = wmap[workoutId(today())]?.day_id;
  const cards = days.map((d) => {
    const n = dayItems(d.id).length;
    const last = lastDone[d.id];
    return `<button type="button" class="day-card ${d.id === todayDay ? "today" : ""}" data-act="open-day" data-id="${esc(d.id)}">
      <span><span class="day-name">${esc(d.name)}</span>
      <span class="meta">${n} hareket${last ? ` · son: ${fmtDate(last)}` : ""}${d.id === todayDay ? " · bugün" : ""}</span></span>
      <span class="chev">›</span></button>`;
  }).join("");
  return (days.length ? `<div class="day-list">${cards}</div>` : `<p class="hint empty-state">Henüz antrenman günü yok. Push-A, Pull-A, Legs gibi günlerini ekle, sonra içine hareketleri koy.</p>`) +
    `<button type="button" class="wide ghost" data-act="new-day">+ Yeni antrenman günü</button>`;
}

function renderDay() {
  const items = dayItems(W.dayId);
  const exMap = exerciseById();
  const w = cache.workouts.find((x) => x.id === workoutId(W.date));
  let html = `<div class="toolbar">${dateChip()}
    <button type="button" class="ghost small" data-act="edit-toggle">${W.editMode ? "Bitti" : "Düzenle"}</button></div>`;

  if (!items.length && !W.editMode) html += `<p class="hint empty-state">Bu günde hareket yok. "Düzenle"ye basıp hareket ekle.</p>`;

  html += items.map((it, i) => {
    const ex = exMap[it.exercise_id];
    if (!ex) return "";
    if (W.editMode) {
      return `<div class="ex-card editing">
        <div class="ex-top"><b>${esc(ex.name)}</b>
          <button type="button" class="rest-chip" data-act="rest" data-id="${esc(it.id)}">${specText(it)}</button></div>
        <div class="edit-actions">
          <button type="button" class="icon-btn" data-act="up" data-id="${esc(it.id)}" ${i === 0 ? "disabled" : ""} aria-label="Yukarı">↑</button>
          <button type="button" class="icon-btn" data-act="down" data-id="${esc(it.id)}" ${i === items.length - 1 ? "disabled" : ""} aria-label="Aşağı">↓</button>
          <button type="button" class="icon-btn danger" data-act="remove-item" data-id="${esc(it.id)}" aria-label="Günden çıkar">✕</button>
        </div></div>`;
    }
    const last = lastSession(it.exercise_id, W.date);
    const doneToday = setsFor(it.exercise_id, W.date).length;
    return `<button type="button" class="ex-card" data-act="open-ex" data-id="${esc(it.exercise_id)}">
      <div class="ex-top"><b>${esc(ex.name)}</b></div>
      <div class="spec">${specText(it)}</div>
      <div class="meta">${last ? `${fmtDate(last.date)}: ${last.sets.map(setShort).join(" · ")}` : "Önceki kayıt yok"}</div>
      ${last && exNote(last.date, it.exercise_id) ? `<div class="meta">📝 ${esc(exNote(last.date, it.exercise_id))}</div>` : ""}
      ${doneToday ? `<div class="done ${it.target_sets && doneToday < it.target_sets ? "partial" : ""}">✓ ${doneToday}${it.target_sets ? "/" + it.target_sets : ""} set</div>` : ""}
    </button>`;
  }).join("");

  if (W.editMode) {
    const inDay = new Set(items.map((i) => i.exercise_id));
    const opts = [...cache.exercises].filter((e) => !inDay.has(e.id)).sort(byName);
    html += `<div class="card">
      <h2>Hareket ekle</h2>
      <label>Hareket<select id="w-add-ex">${opts.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}<option value="__new">+ Yeni hareket…</option></select></label>
      <div class="row"><label>Hedef (set×tekrar, RIR, dinlenme)<input type="text" id="w-add-rest" placeholder="3x6-8 RIR 1 3dk" autocomplete="off" autocapitalize="off"></label>
      <button type="button" class="primary" data-act="add-item">Ekle</button></div>
      <p class="hint">Örnek: <code>3x6-8 RIR 1 3dk</code>, <code>2x8-13 RIR 0 90sn</code>. Sadece dinlenme de yazabilirsin: <code>2dk</code></p>
    </div>
    <div class="row">
      <button type="button" class="ghost grow" data-act="rename-day">Adını değiştir</button>
      <button type="button" class="ghost grow danger-text" data-act="delete-day">Günü sil</button>
    </div>`;
  } else {
    html += `<div class="card"><label>Antrenman notu (${fmtDate(W.date)})<textarea id="w-notes" rows="2" placeholder="Uyku, enerji, ağrı…">${esc(w?.notes || "")}</textarea></label></div>`;
  }
  return html;
}

function renderExercise() {
  const exId = W.exId;
  const it = dayItem(W.dayId, exId);
  const todays = setsFor(exId, W.date);
  const past = sessions(exId, W.date, 8);
  const last = past[0];
  const dayName = (id) => cache.days.find((d) => d.id === id)?.name;

  const lastBox = last
    ? `<div class="last-box"><div class="meta">Son sefer · ${weekday(last.date)}, ${fmtDate(last.date)}${dayName(last.dayId) ? " · " + esc(dayName(last.dayId)) : ""}</div>
       ${last.sets.map((s) => `<div class="last-set"><span class="n">${s.set_no}</span>${setText(s)}</div>`).join("")}
       ${exNote(last.date, exId) ? `<div class="note">📝 ${esc(exNote(last.date, exId))}</div>` : ""}</div>`
    : `<p class="hint">Bu hareket için önceki kayıt yok.</p>`;

  const editing = W.editingSetId ? cache.sets.find((s) => s.id === W.editingSetId) : null;
  const form = `<div class="card">
    <div class="toolbar">${dateChip()}
      <button type="button" class="rest-chip" data-act="rest" data-id="${esc(it?.id || "")}">${it ? specText(it) : "hedef yok"}</button></div>
    <p class="hint" id="w-next-hint"></p>
    <div class="row three">
      <label>kg <input type="number" id="w-kg" inputmode="decimal" step="0.5" min="0"></label>
      <label>Tekrar <input type="number" id="w-reps" inputmode="numeric" step="1" min="0"></label>
      <label>RIR <input type="number" id="w-rir" inputmode="decimal" step="0.5" min="0"></label>
    </div>
    <div class="row">
      <button type="button" class="primary grow" data-act="add-set">${editing ? `${editing.set_no}. seti güncelle` : `${todays.length + 1}${it?.target_sets ? "/" + it.target_sets : ""}. seti kaydet`}</button>
      ${editing ? `<button type="button" class="ghost" data-act="cancel-edit">Vazgeç</button>` : ""}
    </div>
    <label class="note-label">Not (${fmtDate(W.date)})<input type="text" id="w-ex-note" value="${esc(exNote(W.date, exId))}" placeholder="Ağrı, makine, tutuş…" autocomplete="off"></label>
    </div>`;

  const vol = todays.reduce((t, s) => t + (s.weight_kg || 0) * (s.reps || 0), 0);
  const today_ = todays.length
    ? `<div class="card"><h2>Bugün</h2>` + todays.map((s) => {
        const prev = last?.sets[s.set_no - 1];
        return `<div class="set-row ${s.id === W.editingSetId ? "editing" : ""}" data-act="edit-set" data-id="${esc(s.id)}">
          <span><b>${s.set_no}.</b> ${setText(s)}${prev ? `<br><span class="meta">geçen: ${setShort(prev)}</span>` : ""}</span>
          <button type="button" class="icon-btn" data-act="del-set" data-id="${esc(s.id)}" aria-label="Sil">✕</button></div>`;
      }).join("") + `<div class="set-row"><span class="meta">Hacim</span><span class="meta">${fmt(Math.round(vol))} kg</span></div></div>`
    : "";

  const history = past.length > 1
    ? `<div class="card"><h2>Geçmiş</h2>` + past.slice(1).map((p) => {
        const best = Math.max(...p.sets.map((s) => e1rm(s.weight_kg, s.reps, s.rir) || 0));
        return `<div class="hist-row"><div class="hist-head"><b>${weekday(p.date)}, ${fmtDate(p.date)}</b><span class="meta">${[dayName(p.dayId) ? esc(dayName(p.dayId)) : "", best ? `1RM≈${Math.round(best)}` : ""].filter(Boolean).join(" · ")}</span></div>
          ${p.sets.map((s) => `<div class="hist-set">${setText(s)}</div>`).join("")}${exNote(p.date, exId) ? `<div class="note">📝 ${esc(exNote(p.date, exId))}</div>` : ""}</div>`;
      }).join("") + `</div>`
    : "";

  return `<div class="card">${lastBox}</div>` + form + today_ + history;
}

function prefillForm() {
  const kg = $("#w-kg");
  if (!kg) return;
  const todays = setsFor(W.exId, W.date);
  const last = lastSession(W.exId, W.date);
  const editing = W.editingSetId && cache.sets.find((s) => s.id === W.editingSetId);
  // today's last set wins (weight already chosen today), otherwise last session's first set
  const ref = editing || todays[todays.length - 1] || last?.sets[0];
  kg.value = ref?.weight_kg ?? "";
  $("#w-reps").value = ref?.reps ?? "";
  $("#w-rir").value = ref?.rir ?? "";
  const target = last?.sets[todays.length];
  const it = dayItem(W.dayId, W.exId);
  const hints = [];
  if (!editing && target) hints.push(`Geçen sefer ${todays.length + 1}. set: ${setText(target)}`);
  if (it?.target_sets && it.rep_max) {
    hints.push(`Hedef: ${it.target_sets}×${repRange(it)}${it.target_rir != null ? " @ RIR " + fmt(it.target_rir) : ""}`);
    const top = last?.sets.slice(0, it.target_sets);
    if (!todays.length && top?.length >= it.target_sets && top.every((s) => s.reps >= it.rep_max)) {
      hints.push(`Geçen sefer tüm setlerde ${it.rep_max} tekrara ulaştın, ağırlığı artırabilirsin.`);
    }
  }
  $("#w-next-hint").innerHTML = hints.map(esc).join("<br>");
}

async function ensureWorkout() {
  const id = workoutId(W.date);
  const cur = await getOne("workouts", id);
  if (!cur || cur.deleted || cur.day_id !== W.dayId) {
    await save("workouts", { notes: "", ...(cur || {}), id, date: W.date, day_id: W.dayId, deleted: 0 });
  }
}

async function addOrUpdateSet() {
  const kg = num($("#w-kg").value), reps = num($("#w-reps").value), rir = num($("#w-rir").value);
  if (reps == null) return toast("Tekrar sayısını gir");
  await ensureWorkout();
  if (W.editingSetId) {
    const s = await getOne("sets", W.editingSetId);
    await save("sets", { ...s, weight_kg: kg, reps, rir });
    W.editingSetId = null;
    toast("Set güncellendi");
  } else {
    const n = setsFor(W.exId, W.date).length + 1;
    await save("sets", { id: uid(), workout_id: workoutId(W.date), exercise_id: W.exId, set_no: n, weight_kg: kg, reps, rir, notes: "", created_at: Date.now() });
    const it = dayItem(W.dayId, W.exId);
    if (it?.rest_sec) startRest(it.rest_sec, cache.exercises.find((e) => e.id === W.exId)?.name || "");
    else toast(`${n}. set kaydedildi`);
  }
  renderWorkout();
}

async function deleteSet(id) {
  const s = cache.sets.find((x) => x.id === id);
  if (!s || !confirm(`${s.set_no}. set silinsin mi?`)) return;
  await remove("sets", id);
  const rest = cache.sets.filter((x) => x.workout_id === s.workout_id && x.exercise_id === s.exercise_id).sort((a, b) => a.set_no - b.set_no);
  for (let i = 0; i < rest.length; i++) if (rest[i].set_no !== i + 1) await save("sets", { ...rest[i], set_no: i + 1 });
  if (W.editingSetId === id) W.editingSetId = null;
  renderWorkout();
}

const MUSCLE_GROUPS = ["Göğüs", "Sırt", "Omuz", "Bacak", "Kol", "Karın", "Diğer"];
async function newExercise() {
  const name = prompt("Hareket adı:");
  if (!name || !name.trim()) return null;
  const existing = cache.exercises.find((e) => e.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) return existing;
  const g = prompt(`Kas grubu (${MUSCLE_GROUPS.join(", ")}):`, "Diğer") || "Diğer";
  return save("exercises", { id: uid(), name: name.trim(), muscle_group: g.trim() });
}

async function newDay() {
  const name = prompt("Gün adı (ör. Push-A, Pull-A, Legs, Upper):");
  if (!name || !name.trim()) return;
  const order = Math.max(0, ...cache.days.map((d) => d.sort_order ?? 0)) + 1;
  const d = await save("days", { id: uid(), name: name.trim(), sort_order: order });
  go("day", { dayId: d.id, editMode: true });
}

async function addItem() {
  let exId = $("#w-add-ex").value;
  const raw = $("#w-add-rest").value.trim();
  const spec = raw ? parseSpec(raw) : { rest_sec: null };
  if (!spec) return toast("Anlamadım. Örnek: 3x6-8 RIR 1 3dk");
  if (exId === "__new") {
    const ex = await newExercise();
    if (!ex) return;
    if (dayItem(W.dayId, ex.id)) return toast("Bu hareket zaten bu günde");
    exId = ex.id;
  }
  const order = Math.max(0, ...dayItems(W.dayId).map((i) => i.sort_order ?? 0)) + 1;
  await save("day_exercises", { target_sets: null, rep_min: null, rep_max: null, target_rir: null, ...spec, id: uid(), day_id: W.dayId, exercise_id: exId, sort_order: order });
  renderWorkout();
}

async function moveItem(id, dir) {
  const items = dayItems(W.dayId);
  const i = items.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  for (let k = 0; k < items.length; k++) if (items[k].sort_order !== k) await save("day_exercises", { ...items[k], sort_order: k });
  renderWorkout();
}

async function editRest(itemId) {
  const it = cache.day_exercises.find((x) => x.id === itemId);
  if (!it) return;
  const v = prompt("Hedef (ör. 3x6-8 RIR 1 3dk):", specInput(it));
  if (v === null) return;
  const spec = parseSpec(v);
  if (!spec) return toast("Anlamadım. Örnek: 3x6-8 RIR 1 3dk");
  await save("day_exercises", { ...it, ...spec });
  renderWorkout();
}

async function onWorkoutClick(ev) {
  const el = ev.target.closest("[data-act]");
  if (!el || el.dataset.act === "date") return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case "open-day": return go("day", { dayId: id });
    case "open-ex": return go("exercise", { exId: id });
    case "new-day": return newDay();
    case "edit-toggle": W.editMode = !W.editMode; return renderWorkout();
    case "add-item": return addItem();
    case "up": return moveItem(id, -1);
    case "down": return moveItem(id, 1);
    case "rest": return id ? editRest(id) : toast("Bu hareket bir güne bağlı değil");
    case "remove-item": {
      const it = cache.day_exercises.find((x) => x.id === id);
      const ex = it && cache.exercises.find((e) => e.id === it.exercise_id);
      if (it && confirm(`${ex?.name || "Hareket"} bu günden çıkarılsın mı? Geçmiş kayıtlar silinmez.`)) { await remove("day_exercises", id); renderWorkout(); }
      return;
    }
    case "rename-day": {
      const d = cache.days.find((x) => x.id === W.dayId);
      const name = d && prompt("Yeni ad:", d.name);
      if (name && name.trim()) { await save("days", { ...d, name: name.trim() }); renderWorkout(); }
      return;
    }
    case "delete-day": {
      const d = cache.days.find((x) => x.id === W.dayId);
      if (!d || !confirm(`"${d.name}" silinsin mi? Bu günde yaptığın setler silinmez.`)) return;
      for (const it of dayItems(d.id)) await remove("day_exercises", it.id);
      await remove("days", d.id);
      return go("days");
    }
    case "add-set": return addOrUpdateSet();
    case "cancel-edit": W.editingSetId = null; return renderWorkout();
    case "del-set": ev.stopPropagation(); return deleteSet(id);
    case "edit-set": W.editingSetId = id; renderWorkout(); return window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

let notesTimer;
function onWorkoutInput(ev) {
  if (ev.target.id === "w-ex-note") return onExNoteInput(ev);
  if (ev.target.id !== "w-notes") return;
  clearTimeout(notesTimer);
  const date = W.date, dayId = W.dayId, notes = ev.target.value;
  notesTimer = setTimeout(async () => {
    const old = await getOne("workouts", workoutId(date));
    if ((old?.notes || "") === notes) return;
    await save("workouts", { ...(old || {}), id: workoutId(date), date, day_id: old?.day_id || dayId, notes, deleted: 0 });
  }, 600);
}
let exNoteTimer;
function onExNoteInput(ev) {
  clearTimeout(exNoteTimer);
  const date = W.date, exId = W.exId, notes = ev.target.value.trim();
  exNoteTimer = setTimeout(async () => {
    const id = exNoteId(date, exId);
    const old = await getOne("exercise_notes", id);
    if ((old && !old.deleted ? old.notes : "") === notes) return;
    if (!notes) return remove("exercise_notes", id);
    await save("exercise_notes", { id, date, exercise_id: exId, notes });
  }, 600);
}
function onWorkoutChange(ev) {
  if (ev.target.dataset.act !== "date" || !ev.target.value) return;
  W.date = ev.target.value;
  W.editingSetId = null;
  renderWorkout();
}

// ---------- rest timer ----------
let rest = { end: 0 };
let restTick = null, wakeLock = null, audioCtx = null;
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* no audio */ }
}
function beep() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  for (const o of [0, 0.3, 0.6]) {
    const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
    osc.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t + o);
    g.gain.exponentialRampToValueAtTime(0.5, t + o + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o + 0.2);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t + o);
    osc.stop(t + o + 0.22);
  }
}
async function requestWake() { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; } }
function releaseWake() { try { wakeLock?.release(); } catch { /* ignore */ } wakeLock = null; }

function startRest(sec, name) {
  unlockAudio();
  rest = { end: Date.now() + sec * 1000, name, done: false };
  localStorageSet("rest", JSON.stringify(rest));
  requestWake();
  runRest();
}
function runRest() {
  clearInterval(restTick);
  restTick = setInterval(tickRest, 250);
  tickRest();
}
function stopRest() {
  rest = { end: 0 };
  clearInterval(restTick);
  localStorageSet("rest", "");
  releaseWake();
  $("#rest-bar").classList.add("hidden");
  document.body.classList.remove("rest-on");
}
function tickRest() {
  if (!rest.end) return stopRest();
  const bar = $("#rest-bar");
  const left = Math.ceil((rest.end - Date.now()) / 1000);
  bar.classList.remove("hidden");
  document.body.classList.add("rest-on");
  $("#rest-label").textContent = rest.name ? `Dinlenme · ${rest.name}` : "Dinlenme";
  if (left > 0) {
    bar.classList.remove("done");
    $("#rest-time").textContent = clock(left);
    return;
  }
  if (!rest.done) {
    rest.done = true;
    if (left > -5) beep(); // don't beep for timers that ran out while the app was closed
    releaseWake();
  }
  bar.classList.add("done");
  $("#rest-time").textContent = "Hazır";
  if (left < -5) stopRest();
}
function restoreRest() {
  try {
    const r = JSON.parse(localStorageGet("rest") || "null");
    if (r?.end && r.end > Date.now() - 5000) { rest = r; runRest(); }
  } catch { /* ignore */ }
}

// ---------- nutrition ----------
const N_FIELDS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g"];
function renderNutrition() {
  const date = $("#n-date").value;
  const row = cache.nutrition.find((n) => n.date === date);
  for (const f of N_FIELDS) $("#n-" + f).value = row?.[f] ?? "";
  $("#n-notes").value = row?.notes || "";
  const recent = [...cache.nutrition].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  $("#n-list").innerHTML = recent.length
    ? `<h2>Son kayıtlar</h2>` + recent.map((n) =>
        `<div class="list-row"><span>${n.date}</span><span>${fmt(n.kcal)} kcal <span class="meta">· P${fmt(n.protein_g)} K${fmt(n.carb_g)} Y${fmt(n.fat_g)}</span></span></div>`).join("")
    : `<p class="hint">Henüz kayıt yok.</p>`;
}
async function saveNutrition() {
  const date = $("#n-date").value;
  if (!date) return;
  const row = { id: "n-" + date, date, notes: $("#n-notes").value };
  for (const f of N_FIELDS) row[f] = num($("#n-" + f).value);
  await save("nutrition", row);
  renderNutrition();
  toast("Kaydedildi");
}

// ---------- measurements ----------
// pair "Sol X" with "Sağ X" so left-side metrics sit in the left column
function metricGroups() {
  const metrics = [...cache.metrics].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  const side = (m) => { const r = m.name.match(/^(sol|sağ)\s+(.+)$/i); return r ? { side: r[1].toLocaleLowerCase("tr"), rest: r[2].toLocaleLowerCase("tr") } : null; };
  const pairs = [], used = new Set();
  for (const m of metrics) {
    const sm = side(m);
    if (!sm || used.has(m.id)) continue;
    const other = metrics.find((o) => !used.has(o.id) && o.id !== m.id && side(o)?.rest === sm.rest && side(o).side !== sm.side);
    if (!other) continue;
    const [left, right] = sm.side === "sol" ? [m, other] : [other, m];
    used.add(left.id).add(right.id);
    const label = sm.rest.charAt(0).toLocaleUpperCase("tr") + sm.rest.slice(1);
    pairs.push({ left, right, label });
  }
  return { singles: metrics.filter((m) => !used.has(m.id)), pairs };
}

function renderMeasure() {
  const date = $("#m-date").value;
  const lastVal = (mid) => {
    const prev = cache.measurements.filter((m) => m.metric_id === mid && m.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
    return prev ? `son: ${fmt(prev.value)}` : "";
  };
  const field = (m, label = m.name) => {
    const cur = cache.measurements.find((x) => x.id === `m-${date}-${m.id}`);
    return `<label>${esc(label)} (${esc(m.unit)})
      <input type="number" inputmode="decimal" step="0.1" data-metric="${esc(m.id)}" value="${cur?.value ?? ""}" placeholder="${lastVal(m.id)}"></label>`;
  };
  const { singles, pairs } = metricGroups();
  $("#m-fields").innerHTML =
    `<div class="grid-fields">${singles.map((m) => field(m)).join("")}</div>` +
    (pairs.length ? `<div class="pair-head"><span>Sol</span><span>Sağ</span></div>
      <div class="grid-fields">${pairs.map((pr) => field(pr.left) + field(pr.right)).join("")}</div>` : "");
}
async function saveMeasure() {
  const date = $("#m-date").value;
  let n = 0;
  for (const input of document.querySelectorAll("#m-fields input")) {
    const id = `m-${date}-${input.dataset.metric}`;
    const v = num(input.value);
    const existing = cache.measurements.find((x) => x.id === id);
    if (v != null && existing?.value !== v) { await save("measurements", { id, date, metric_id: input.dataset.metric, value: v }); n++; }
    else if (v == null && existing) { await remove("measurements", id); n++; }
  }
  renderMeasure();
  toast(n ? `${n} ölçü kaydedildi` : "Değişiklik yok");
}
async function newMetric() {
  const name = prompt("Ölçü adı (ör. Sağ bilek):");
  if (!name || !name.trim()) return;
  const unit = prompt("Birim:", "cm") || "cm";
  const maxOrder = Math.max(0, ...cache.metrics.map((m) => m.sort_order ?? 0));
  await save("metrics", { id: uid(), name: name.trim(), unit: unit.trim(), sort_order: maxOrder + 1 });
  renderMeasure();
}

// ---------- progress ----------
const RANGES = [["90", "3 ay"], ["180", "6 ay"], ["365", "1 yıl"], ["0", "Tümü"]];
const rangeDays = () => Number(localStorageGet("range") ?? "90");
const rangeStart = () => { const d = rangeDays(); return d ? new Date(Date.now() - d * 86400000).toISOString().slice(0, 10) : ""; };
const inRange = (pts) => pts.filter((p) => p[0] >= rangeStart());

function lineChart(el, series, opts = {}) {
  // series: [{points:[[dateStr, value]], cls, label?, dots?}]
  const all = series.flatMap((s) => s.points);
  if (all.length < 1) { el.innerHTML = `<div class="empty">Bu dönemde veri yok.</div>`; return; }
  const W = 340, H = 180, L = 40, R = 8, T = 10, B = 22;
  const ts = all.map((p) => Date.parse(p[0]));
  const vs = all.map((p) => p[1]);
  // the selected period sets the x axis, so a 1-year view really spans a year
  let t0 = rangeDays() ? Date.parse(rangeStart()) : Math.min(...ts);
  let t1 = Math.max(Date.parse(today()), ...ts);
  if (t0 === t1) { t0 -= 86400000; t1 += 86400000; }
  let v0 = Math.min(...vs), v1 = Math.max(...vs);
  const pad = (v1 - v0) * 0.1 || Math.abs(v1) * 0.05 || 1;
  v0 -= pad; v1 += pad;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - v0) / (v1 - v0)) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 3; i++) {
    const v = v0 + ((v1 - v0) * i) / 3;
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(Math.round(v * 10) / 10)}</text>`;
  }
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const tm = (t0 + t1) / 2;
  svg += `<text class="axis" x="${L}" y="${H - 6}">${fmtDate(iso(t0))}</text>` +
    `<text class="axis" x="${x(tm)}" y="${H - 6}" text-anchor="middle">${fmtDate(iso(tm))}</text>` +
    `<text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${fmtDate(iso(t1))}</text>`;
  for (const s of series) {
    if (!s.points.length) continue;
    const pts = s.points.map((p) => `${x(Date.parse(p[0])).toFixed(1)},${y(p[1]).toFixed(1)}`);
    svg += `<polyline class="${s.cls}" points="${pts.join(" ")}"/>`;
    if (s.dots) for (const pt of pts) { const [a, b] = pt.split(","); svg += `<circle class="dot ${s.cls}" cx="${a}" cy="${b}" r="2.5"/>`; }
  }
  svg += `</svg>`;
  const legend = series.filter((s) => s.label);
  if (legend.length > 1) svg += `<div class="legend">${legend.map((s) => `<span><i class="sw ${s.cls}"></i>${esc(s.label)}</span>`).join("")}</div>`;
  if (opts.caption) svg += `<p class="hint">${opts.caption}</p>`;
  el.innerHTML = svg;
}

// trailing 7-day average for each point
const movingAvg = (pts) => pts.map(([d]) => {
  const t = Date.parse(d);
  const win = pts.filter(([d2]) => { const t2 = Date.parse(d2); return t2 <= t && t2 > t - 7 * 86400000; });
  return [d, win.reduce((a, p) => a + p[1], 0) / win.length];
});
const change = (pts) => {
  if (pts.length < 2) return "";
  const d = Math.round((pts[pts.length - 1][1] - pts[0][1]) * 10) / 10;
  return `${d > 0 ? "+" : ""}${fmt(d)}`;
};

function renderProgress() {
  $("#p-range").innerHTML = RANGES.map(([v, l]) => `<button type="button" data-range="${v}" class="${String(rangeDays()) === v ? "active" : ""}">${l}</button>`).join("");

  // exercise e1RM (best set per day)
  const exSel = $("#p-exercise");
  const used = new Set(cache.sets.map((s) => s.exercise_id));
  const exOpts = cache.exercises.filter((e) => used.has(e.id)).sort(byName);
  const prevEx = exSel.value;
  exSel.innerHTML = exOpts.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("");
  if (exOpts.some((e) => e.id === prevEx)) exSel.value = prevEx;
  const wmap = workoutById();
  const best = {};
  for (const s of cache.sets) {
    const w = wmap[s.workout_id];
    if (s.exercise_id !== exSel.value || !w) continue;
    const e = e1rm(s.weight_kg, s.reps, s.rir);
    if (e && (!best[w.date] || e > best[w.date])) best[w.date] = e;
  }
  const exPts = inRange(Object.entries(best).sort());
  const peak = exPts.length ? Math.max(...exPts.map((p) => p[1])) : null;
  lineChart($("#p-ex-chart"), [{ points: exPts, cls: "l1", dots: true }],
    { caption: peak ? `Dönemdeki en iyi tahmini 1RM: ${fmt(Math.round(peak))} kg${exPts.length > 1 ? ` · değişim ${change(exPts)} kg` : ""}` : "" });

  // metric chart: single metric with 7-day average, or a left/right pair as two lines
  const { singles, pairs } = metricGroups();
  const mSel = $("#p-metric");
  const prevM = mSel.value || "metric-weight";
  mSel.innerHTML = singles.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.unit)})</option>`).join("") +
    pairs.map((pr) => `<option value="pair:${esc(pr.left.id)}|${esc(pr.right.id)}">${esc(pr.label)} — sol / sağ (${esc(pr.left.unit)})</option>`).join("");
  if ([...mSel.options].some((o) => o.value === prevM)) mSel.value = prevM;
  const series = (mid) => cache.measurements.filter((m) => m.metric_id === mid && m.value != null)
    .sort((a, b) => a.date.localeCompare(b.date)).map((m) => [m.date, m.value]);
  if (mSel.value.startsWith("pair:")) {
    const [l, r] = mSel.value.slice(5).split("|");
    const lp = inRange(series(l)), rp = inRange(series(r));
    const cap = [lp.length > 1 ? `Sol ${change(lp)}` : "", rp.length > 1 ? `Sağ ${change(rp)}` : ""].filter(Boolean).join(" · ");
    lineChart($("#p-metric-chart"), [{ points: lp, cls: "l3", dots: true, label: "Sol" }, { points: rp, cls: "l1", dots: true, label: "Sağ" }],
      { caption: cap ? `Dönemdeki değişim: ${cap}` : "" });
  } else {
    const all = series(mSel.value);
    const avg = movingAvg(all);
    const pts = inRange(all);
    lineChart($("#p-metric-chart"), [{ points: pts, cls: "l2", dots: true, label: "Ölçüm" }, { points: inRange(avg), cls: "l1", label: "7 günlük ort." }],
      { caption: pts.length > 1 ? `Dönemdeki değişim: ${change(pts)} (${fmtDate(pts[0][0])} → ${fmtDate(pts[pts.length - 1][0])})` : "" });
  }

  // weekly sets per muscle group, last 8 weeks
  const exMap = exerciseById();
  const weekStart = (ds) => {
    const d = new Date(ds + "T12:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const weeks = {};
  const groups = new Set();
  for (const s of cache.sets) {
    const w = wmap[s.workout_id];
    if (!w) continue;
    const wk = weekStart(w.date), g = exMap[s.exercise_id]?.muscle_group || "Diğer";
    groups.add(g);
    ((weeks[wk] ||= {})[g] = (weeks[wk][g] || 0) + 1);
  }
  const wkKeys = Object.keys(weeks).sort().slice(-8).reverse();
  const gList = [...groups].sort((a, b) => a.localeCompare(b, "tr"));
  $("#p-volume").innerHTML = wkKeys.length
    ? `<table><tr><th>Hafta</th>${gList.map((g) => `<th>${esc(g)}</th>`).join("")}</tr>` +
      wkKeys.map((wk) => `<tr><td>${fmtDate(wk)}</td>${gList.map((g) => `<td>${weeks[wk][g] || "·"}</td>`).join("")}</tr>`).join("") + `</table>`
    : `<p class="hint">Henüz set kaydı yok.</p>`;

  // calories over the selected period
  const kAll = cache.nutrition.filter((n) => n.kcal != null).sort((a, b) => a.date.localeCompare(b.date)).map((n) => [n.date, n.kcal]);
  const kPts = inRange(kAll);
  const kAvg = kPts.length ? Math.round(kPts.reduce((a, p) => a + p[1], 0) / kPts.length) : null;
  lineChart($("#p-kcal-chart"), [{ points: kPts, cls: "l2", dots: kPts.length < 40, label: "Günlük" }, { points: inRange(movingAvg(kAll)), cls: "l1", label: "7 günlük ort." }],
    { caption: kAvg ? `Ortalama: ${kAvg} kcal/gün (${kPts.length} gün)` : "" });
}

// ---------- settings ----------
function renderSettings() {
  const list = [...cache.exercises].sort(byName);
  $("#s-exercises").innerHTML = list.map((e) =>
    `<div class="list-row"><span>${esc(e.name)} <span class="meta">· ${esc(e.muscle_group || "")}</span></span>
     <span><button class="icon-btn" data-edit-ex="${esc(e.id)}" aria-label="Düzenle">✎</button></span></div>`).join("");
}
async function editExercise(id) {
  const e = cache.exercises.find((x) => x.id === id);
  if (!e) return;
  const name = prompt("Hareket adı (silmek için boş bırak):", e.name);
  if (name === null) return;
  if (!name.trim()) {
    if (cache.sets.some((s) => s.exercise_id === id)) return toast("Bu hareketin kayıtlı setleri var, silinemez");
    await remove("exercises", id);
  } else {
    const g = prompt("Kas grubu:", e.muscle_group || "Diğer");
    await save("exercises", { ...e, name: name.trim(), muscle_group: (g || e.muscle_group || "Diğer").trim() });
  }
  renderSettings();
  renderWorkout();
}

// ---------- misc ----------
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

function renderAll() {
  renderWorkout();
  renderNutrition();
  renderMeasure();
  if ($("#view-progress").classList.contains("active")) renderProgress();
  if ($("#view-settings").classList.contains("active")) renderSettings();
}

async function main() {
  db = await openDb();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  await seed();
  await loadCache();
  for (const id of ["#n-date", "#m-date"]) $(id).value = today();
  try {
    const r = JSON.parse(localStorageGet("route") || "null"); // reopen where the app was left (iOS may kill it mid-workout)
    if (r) Object.assign(W, { screen: r.screen || "days", dayId: r.dayId, exId: r.exId });
  } catch { /* ignore */ }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  const wr = $("#w-root");
  wr.addEventListener("click", onWorkoutClick);
  wr.addEventListener("input", onWorkoutInput);
  wr.addEventListener("change", onWorkoutChange);
  $("#back-btn").addEventListener("click", goBack);
  $("#rest-plus").addEventListener("click", () => { if (rest.end) { rest.end = Math.max(rest.end, Date.now()) + 30000; rest.done = false; localStorageSet("rest", JSON.stringify(rest)); requestWake(); tickRest(); } });
  $("#rest-skip").addEventListener("click", stopRest);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (openedOn !== today()) { openedOn = today(); W.date = today(); W.editingSetId = null; renderWorkout(); } // midnight passed while the app was in background
    if (rest.end) { requestWake(); tickRest(); }
  });
  $("#n-date").addEventListener("change", renderNutrition);
  $("#n-save").addEventListener("click", saveNutrition);
  $("#m-date").addEventListener("change", renderMeasure);
  $("#m-save").addEventListener("click", saveMeasure);
  $("#m-new").addEventListener("click", newMetric);
  $("#p-exercise").addEventListener("change", renderProgress);
  $("#p-range").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-range]");
    if (b) { localStorageSet("range", b.dataset.range); renderProgress(); }
  });
  $("#p-metric").addEventListener("change", renderProgress);
  $("#s-export").addEventListener("click", exportFile);
  $("#s-restore").addEventListener("change", (e) => { if (e.target.files[0]) restoreFile(e.target.files[0]); e.target.value = ""; });
  $("#sync-badge").addEventListener("click", () => showView("settings"));
  $("#s-exercises").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-edit-ex]");
    if (b) editExercise(b.dataset.editEx);
  });

  renderAll();
  restoreRest();
  updateBadge();

  if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) toast("Yeni sürüm yüklendi, uygulamayı kapatıp aç");
    });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

main();
