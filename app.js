"use strict";

// ---------- IndexedDB ----------
const TABLES = ["exercises", "workouts", "sets", "nutrition", "metrics", "measurements", "days", "day_exercises", "exercise_notes", "profile"];
let db;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("fitness", 3);
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

// library: adds the built-in exercises once per LIBRARY_VERSION, skipping ids and names that already exist
async function seedLibrary() {
  if (((await getMeta("libraryVersion")) || 0) >= LIBRARY_VERSION) return;
  const existing = await getAll("exercises");
  const ids = new Set(existing.map((e) => e.id));
  const names = new Set(existing.filter((e) => !e.deleted).map((e) => fold(e.name)));
  const slug = (n) => fold(n).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const add = [];
  const entries = [...Object.entries(LIBRARY).flatMap(([group, list]) => list.map((name) => [name, group])), ...LIBRARY_EXTRA];
  {
    for (const [name, group] of entries) {
      const id = "ex-l-" + slug(name);
      if (ids.has(id) || names.has(fold(name))) continue;
      names.add(fold(name));
      add.push({ id, name, muscle_group: group, updated_at: 1, deleted: 0 });
    }
  }
  // starter exercises the user never edited (updated_at 1) move to the finer groups; 2 so the Mac copy updates too
  const regroup = existing.filter((e) => e.updated_at === 1 && SEED_GROUPS[e.id] && e.muscle_group !== SEED_GROUPS[e.id])
    .map((e) => ({ ...e, muscle_group: SEED_GROUPS[e.id], updated_at: 2 }));
  await putMany("exercises", [...add, ...regroup]);
  await setMeta("libraryVersion", LIBRARY_VERSION);
}

// ---------- export to Mac / restore ----------
const EXPORT_FORMAT = "fitness-export";

async function unexportedCount() {
  const since = (await getMeta("lastExport")) || 0;
  let n = 0;
  for (const t of TABLES) n += (await getAll(t)).filter((r) => r.updated_at > since && r.updated_at > 2).length;
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
const TITLES = { workout: "Antrenman", nutrition: "Günlük", measure: "Ölçüler", progress: "İlerleme", settings: "Ayarlar" };
function showView(name) {
  if (name === "workout" && $("#view-workout").classList.contains("active") && W.screen !== "days") go("days"); // tapping the active tab pops to the day list
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("#view-title").textContent = TITLES[name];
  updateHeader();
  if (name === "progress") renderProgress();
  if (name === "nutrition" && $("#n-calc-box").open) renderCalc(); // latest weight / body fat may have changed in Ölçüler
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
const repRange = (it) => (it.rep_min == null ? "" : it.rep_max && it.rep_max !== it.rep_min ? `${it.rep_min}-${it.rep_max}` : `${it.rep_min}`);
function specText(it, sep = " · ") {
  const parts = [];
  if (it.target_sets) parts.push(`${it.target_sets}×${repRange(it)}`);
  if (it.target_rir != null) parts.push(`RIR ${fmt(it.target_rir)}`);
  if (it.rest_sec) parts.push(`${fmtRest(it.rest_sec)} dinlenme`);
  return parts.join(sep) || "hedef yok";
}
// target form: separate fields so there is nothing to type in a special format
const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300];
const SPEC_DEFAULT = { target_sets: 3, rep_min: 8, rep_max: 12, target_rir: 1, rest_sec: 120 };
function specForm(it = SPEC_DEFAULT) {
  const v = (x) => (x == null ? "" : x);
  const rests = REST_OPTIONS.includes(it.rest_sec || 0) ? REST_OPTIONS : [...REST_OPTIONS, it.rest_sec].sort((a, b) => a - b);
  return `<div class="spec-form">
    <label>Set<input type="number" inputmode="numeric" min="1" data-f="target_sets" value="${v(it.target_sets)}"></label>
    <label>Tekrar<span class="rep-range"><input type="number" inputmode="numeric" min="1" data-f="rep_min" value="${v(it.rep_min)}" aria-label="En az tekrar"><span>–</span><input type="number" inputmode="numeric" min="1" data-f="rep_max" value="${v(it.rep_max !== it.rep_min ? it.rep_max : "")}" placeholder="max" aria-label="En çok tekrar"></span></label>
    <label>RIR<input type="number" inputmode="decimal" step="0.5" min="0" data-f="target_rir" value="${v(it.target_rir)}"></label>
    <label>Dinlenme<select data-f="rest_sec">${rests.map((r) => `<option value="${r}" ${r === (it.rest_sec || 0) ? "selected" : ""}>${r ? fmtRest(r) : "yok"}</option>`).join("")}</select></label>
  </div>`;
}
function readSpec(box) {
  const f = (k) => num(box.querySelector(`[data-f="${k}"]`).value);
  const spec = { target_sets: f("target_sets"), rep_min: f("rep_min"), rep_max: f("rep_max"), target_rir: f("target_rir"), rest_sec: f("rest_sec") || null };
  if (spec.rep_min == null && spec.rep_max != null) spec.rep_min = spec.rep_max;
  if (spec.rep_max == null) spec.rep_max = spec.rep_min;
  if (spec.rep_min != null && spec.rep_max < spec.rep_min) [spec.rep_min, spec.rep_max] = [spec.rep_max, spec.rep_min];
  return spec;
}
const exNoteId = (date, exId) => `en-${date}-${exId}`;
const exNote = (date, exId) => cache.exercise_notes.find((n) => n.id === exNoteId(date, exId))?.notes || "";
// notes are stored as lines of text and shown as a numbered list
const noteLines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
const noteHtml = (text, sep = "<br>") => noteLines(text).map(esc).join(sep);
function noteBlock(kind, text) {
  const lines = noteLines(text);
  const ph = { day: "Not ekle: uyku, enerji, ağrı…", ex: "Not ekle: ağrı, makine, tutuş…", nut: "Not ekle: öğün, su, takviye…" }[kind];
  return `<div class="notes">
    <div class="note-add"><input type="text" class="note-input" data-kind="${kind}" placeholder="${ph}" autocomplete="off" enterkeyhint="done">
      <button type="button" class="note-add-btn" data-act="note-add" data-kind="${kind}">Ekle</button></div>
    ${lines.length ? `<ol class="note-list">${lines.map((l, i) => `<li><button type="button" class="note-text" data-act="note-edit" data-kind="${kind}" data-i="${i}">${esc(l)}</button><button type="button" class="icon-btn" data-act="note-del" data-kind="${kind}" data-i="${i}" aria-label="Notu sil">✕</button></li>`).join("")}</ol>` : ""}
  </div>`;
}
const noteText = (kind) => (kind === "day" ? cache.workouts.find((w) => w.id === workoutId(W.date))?.notes : exNote(W.date, W.exId)) || "";
async function saveNoteLines(kind, lines) {
  const text = lines.join("\n");
  if (kind === "day") {
    const id = workoutId(W.date);
    const old = await getOne("workouts", id);
    if ((old && !old.deleted ? old.notes || "" : "") === text) return;
    await save("workouts", { ...(old || {}), id, date: W.date, day_id: old?.day_id || W.dayId || null, notes: text, deleted: 0 });
  } else {
    const id = exNoteId(W.date, W.exId);
    if (!text) await remove("exercise_notes", id);
    else await save("exercise_notes", { id, date: W.date, exercise_id: W.exId, notes: text });
  }
  renderWorkout();
}
async function noteAction(act, kind, i, input) {
  const lines = noteLines(noteText(kind));
  if (act === "note-add") {
    const v = input?.value.trim();
    if (!v) return input?.focus();
    return saveNoteLines(kind, [...lines, v]);
  }
  if (act === "note-edit") {
    const v = prompt("Notu düzenle (silmek için boş bırak):", lines[i]);
    if (v === null) return;
    if (v.trim()) lines[i] = v.trim(); else lines.splice(i, 1);
    return saveNoteLines(kind, lines);
  }
  if (act === "note-del" && confirm(`"${lines[i]}" silinsin mi?`)) {
    lines.splice(i, 1);
    return saveNoteLines(kind, lines);
  }
}

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
  Object.assign(W, { screen, editingSetId: null, specEditId: null }, patch);
  if (screen !== "day") { W.editMode = false; W.addQuery = ""; W.addExId = null; W.addGroup = null; }
  saveRoute();
  renderWorkout();
  window.scrollTo(0, 0);
}
function goBack() {
  if (W.screen === "exercise" && W.dayId) go("day");
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

// ‹ › step one day without relying on the iOS picker; the visible native input jumps further
function dateChip() {
  const other = W.date !== today();
  return `<div class="date-nav ${other ? "other" : ""}">
    <button type="button" class="step" data-act="date-prev" aria-label="Önceki gün">‹</button>
    <input type="date" class="date-input" data-act="date" value="${W.date}" max="${today()}" aria-label="Tarih">
    <button type="button" class="step" data-act="date-next" aria-label="Sonraki gün" ${other ? "" : "disabled"}>›</button>
    ${other ? `<button type="button" class="step today-btn" data-act="date-today">Bugün</button>` : ""}
  </div>`;
}
function shiftDate(ds, delta) {
  const [y, m, d] = ds.split("-").map(Number);
  const t = new Date(y, m - 1, d + delta);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function setWorkoutDate(ds) {
  if (!ds || ds > today()) ds = today();
  if (ds === W.date) return;
  W.date = ds;
  W.editingSetId = null;
  renderWorkout();
}

function renderWorkout() {
  // guard against routes to deleted items (e.g. after a restore)
  if (W.screen === "day" && !cache.days.some((d) => d.id === W.dayId)) W.screen = "days";
  if (W.screen === "exercise" && W.dayId && !cache.days.some((d) => d.id === W.dayId)) W.dayId = null;
  if (W.screen === "exercise" && !cache.exercises.some((e) => e.id === W.exId)) W.screen = "day";
  const root = $("#w-root");
  root.innerHTML = W.screen === "days" ? renderDays() : W.screen === "day" ? renderDay() : renderExercise();
  root.className = W.screen !== "days" && W.dayId ? dayTint(W.dayId) : "";
  updateHeader();
  if (W.screen === "exercise") prefillForm();
  if (W.screen === "day" && W.editMode) renderAddResults();
}

// every workout day keeps its own color, in list order
const dayTint = (dayId) => { const i = sortedDays().findIndex((d) => d.id === dayId); return i < 0 ? "" : `tint-c${i % 8}`; };

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
    return `<button type="button" class="day-card ${dayTint(d.id)} ${d.id === todayDay ? "today" : ""}" data-act="open-day" data-id="${esc(d.id)}">
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
  let html = W.editMode
    ? `<div class="toolbar"><span class="hint">Sıra, hedef ve hareketleri düzenle</span>
       <button type="button" class="primary small" data-act="edit-toggle">Bitti</button></div>`
    : `<div class="toolbar">${dateChip()}</div>`;

  if (!items.length && !W.editMode) html += `<p class="hint empty-state">Bu günde hareket yok. Aşağıdan "Günü düzenle"ye basıp hareket ekle.</p>`;

  html += items.map((it, i) => {
    const ex = exMap[it.exercise_id];
    if (!ex) return "";
    if (W.editMode && W.specEditId === it.id) {
      return `<div class="ex-card spec-editing" data-spec-box="${esc(it.id)}"><b>${esc(ex.name)}</b>${specForm(it)}
        <div class="row"><button type="button" class="primary grow" data-act="spec-save" data-id="${esc(it.id)}">Kaydet</button>
        <button type="button" class="ghost" data-act="spec-cancel">Vazgeç</button></div></div>`;
    }
    if (W.editMode) {
      return `<div class="ex-card editing">
        <div class="ex-top"><b>${esc(ex.name)}</b>
          <button type="button" class="rest-chip" data-act="rest" data-id="${esc(it.id)}">${specText(it)} ✎</button></div>
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
      ${last && exNote(last.date, it.exercise_id) ? `<div class="meta note-line">${noteHtml(exNote(last.date, it.exercise_id), " · ")}</div>` : ""}
      ${doneToday ? `<div class="done ${it.target_sets && doneToday < it.target_sets ? "partial" : ""}">✓ ${doneToday}${it.target_sets ? "/" + it.target_sets : ""} set</div>` : ""}
    </button>`;
  }).join("");

  if (W.editMode) {
    const inDay = new Set(items.map((i) => i.exercise_id));
    const opts = [...cache.exercises].filter((e) => !inDay.has(e.id)).sort(byName);
    html += `<div class="card add-card">
      <h2>Hareket ekle</h2>
      <div class="chips group-chips" id="w-add-groups"></div>
      <label>Hareket<input type="search" id="w-add-q" value="${esc(W.addQuery || "")}" placeholder="Ara: bench, db, cable, squat…" autocomplete="off" autocapitalize="off" enterkeyhint="search"></label>
      <div id="w-add-results" class="pick-list"></div>
      <div class="field-label">Hedef</div>
      <div id="w-add-spec">${specForm()}</div>
      <button type="button" class="primary" data-act="add-item">Güne ekle</button>
    </div>
    <div class="row">
      <button type="button" class="ghost grow" data-act="rename-day">Adını değiştir</button>
      <button type="button" class="ghost grow danger-text" data-act="delete-day">Günü sil</button>
    </div>`;
  } else {
    html += `<button type="button" class="wide ghost" data-act="edit-toggle">✎ Günü düzenle</button>`;
    html += `<div class="card"><h2>Antrenman notları · ${fmtDate(W.date)}</h2>${noteBlock("day", w?.notes)}</div>`;
  }
  return html;
}

function renderExercise() {
  const exId = W.exId;
  const it = dayItem(W.dayId, exId);
  const todays = setsFor(exId, W.date);
  const past = sessions(exId, W.date, W.dayId ? 8 : 99);
  const last = past[0];
  const dayName = (id) => cache.days.find((d) => d.id === id)?.name;

  const lastBox = last
    ? `<div class="last-box"><div class="meta">Son sefer · ${weekday(last.date)}, ${fmtDate(last.date)}${dayName(last.dayId) ? " · " + esc(dayName(last.dayId)) : ""}</div>
       ${last.sets.map((s) => `<div class="last-set"><span class="setno">${s.set_no}</span>${setText(s)}</div>`).join("")}
       ${exNote(last.date, exId) ? `<div class="note">${noteHtml(exNote(last.date, exId))}</div>` : ""}</div>`
    : `<p class="hint">Bu hareket için önceki kayıt yok.</p>`;

  const editing = W.editingSetId ? cache.sets.find((s) => s.id === W.editingSetId) : null;
  const form = `<div class="card">
    ${dateChip()}
    <div class="spec-row"><button type="button" class="rest-chip" data-act="rest" data-id="${esc(it?.id || "")}">${it ? specText(it) + " ✎" : "hedef yok"}</button></div>
    ${it && W.specEditId === it.id ? `<div class="spec-inline" data-spec-box="${esc(it.id)}">${specForm(it)}
      <div class="row"><button type="button" class="primary grow" data-act="spec-save" data-id="${esc(it.id)}">Hedefi kaydet</button>
      <button type="button" class="ghost" data-act="spec-cancel">Vazgeç</button></div></div>` : ""}
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
    <div class="note-wrap"><div class="field-label">Hareket notları · ${fmtDate(W.date)}</div>${noteBlock("ex", exNote(W.date, exId))}</div>
    </div>`;

  const vol = todays.reduce((t, s) => t + (s.weight_kg || 0) * (s.reps || 0), 0);
  const today_ = todays.length
    ? `<div class="card"><h2>${W.date === today() ? "Bugün" : `${weekday(W.date)}, ${fmtDate(W.date)} setleri`}</h2>` + todays.map((s) => {
        const prev = last?.sets[s.set_no - 1];
        return `<div class="set-row ${s.id === W.editingSetId ? "editing" : ""}" data-act="edit-set" data-id="${esc(s.id)}">
          <span class="set-main"><span class="setno">${s.set_no}</span><span>${setText(s)}${prev ? `<br><span class="meta">geçen: ${setShort(prev)}</span>` : ""}</span></span>
          <button type="button" class="icon-btn" data-act="del-set" data-id="${esc(s.id)}" aria-label="Sil">✕</button></div>`;
      }).join("") + `<div class="set-row"><span class="meta">Hacim</span><span class="meta">${fmt(Math.round(vol))} kg</span></div></div>`
    : "";

  const history = past.length > 1 || (!W.dayId && past.length)
    ? `<div class="card"><h2>Geçmiş</h2>` + past.slice(W.dayId ? 1 : 0).map((p) => {
        const best = Math.max(...p.sets.map((s) => e1rm(s.weight_kg, s.reps, s.rir) || 0));
        return `<div class="hist-row"><div class="hist-head"><b>${weekday(p.date)}, ${fmtDate(p.date)}</b><span class="meta">${[dayName(p.dayId) ? esc(dayName(p.dayId)) : "", best ? `1RM≈${Math.round(best)}` : ""].filter(Boolean).join(" · ")}</span></div>
          ${p.sets.map((s) => `<div class="hist-set"><span>${setText(s)}</span>${W.dayId ? "" : `<button type="button" class="icon-btn" data-act="del-set" data-id="${esc(s.id)}" aria-label="Sil">✕</button>`}</div>`).join("")}${exNote(p.date, exId) ? `<div class="note">${noteHtml(exNote(p.date, exId))}</div>` : ""}</div>`;
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
  const dayId = W.dayId || cur?.day_id || null; // logging outside a day keeps the date's existing day
  if (!cur || cur.deleted || cur.day_id !== dayId) {
    await save("workouts", { notes: "", ...(cur || {}), id, date: W.date, day_id: dayId, deleted: 0 });
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
    if (it?.rest_sec && W.date === today()) startRest(it.rest_sec, cache.exercises.find((e) => e.id === W.exId)?.name || "");
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

const MUSCLE_GROUPS = ["Göğüs", "Sırt", "Omuz", "Biceps", "Triceps", "Ön kol", "Quadriceps", "Hamstring", "Kalça", "Baldır", "Karın", "Tüm vücut", "Diğer"];

// search: case/diacritic-insensitive, every word must match (in any order), common gym abbreviations expand
const fold = (t) => String(t || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
const ALIASES = {
  db: ["dumbbell"], bb: ["barbell"], kb: ["kettlebell"], ohp: ["overhead press", "shoulder press"], rdl: ["romanian deadlift"],
  sm: ["smith"], overhead: ["shoulder"], shoulder: ["overhead"], quad: ["quadriceps"], ham: ["hamstring"], abs: ["karin"], glute: ["kalca"],
};
// each typed word must start a word of the name ("chin" ≠ ma-chin-e); runs of words may be typed joined ("pullup" = Pull-up)
function matchesQuery(ex, q) {
  const words = fold(q).replace(/[-']/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hw = fold(`${ex.name} ${ex.muscle_group || ""}`).replace(/[-']/g, " ").split(/\s+/).filter(Boolean);
  const phrase = " " + hw.join(" ");
  const starts = (w) => hw.some((_, i) => hw.slice(i, i + 3).join("").startsWith(w));
  return words.every((w) => starts(w) || (ALIASES[w] || []).some((a) => phrase.includes(" " + a)));
}
function searchExercises(q, { exclude = new Set(), group = null } = {}) {
  const f = fold(q).trim();
  return cache.exercises
    .filter((e) => !exclude.has(e.id) && (!group || e.muscle_group === group) && matchesQuery(e, q))
    // names that start with the query come first
    .sort((a, b) => (f && fold(b.name).startsWith(f)) - (f && fold(a.name).startsWith(f)) || byName(a, b));
}
async function newExercise(suggested = "") {
  const name = prompt("Hareket adı:", suggested);
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

function renderAddResults() {
  const box = $("#w-add-results");
  if (!box) return;
  const groups = MUSCLE_GROUPS.filter((g) => cache.exercises.some((e) => e.muscle_group === g));
  $("#w-add-groups").innerHTML = [["", "Hepsi"], ...groups.map((g) => [g, g])].map(([v, l]) =>
    `<button type="button" class="chip ${(W.addGroup || "") === v ? "on all" : ""}" data-act="add-group" data-group="${esc(v)}">${esc(l)}</button>`).join("");
  const inDay = new Set(dayItems(W.dayId).map((i) => i.exercise_id));
  const q = W.addQuery || "";
  const chosen = W.addExId && cache.exercises.find((e) => e.id === W.addExId);
  if (chosen) {
    box.innerHTML = `<div class="pick-row picked"><span>✓ ${esc(chosen.name)} <span class="meta">· ${esc(chosen.muscle_group || "")}</span></span><button type="button" class="icon-btn" data-act="unpick" aria-label="Seçimi kaldır">✕</button></div>`;
    return;
  }
  const hits = searchExercises(q, { exclude: inDay, group: W.addGroup || null });
  const exact = cache.exercises.some((e) => fold(e.name) === fold(q.trim()));
  // a chosen muscle group lists all of its exercises (scrollable); a bare search shows the best few
  const limit = W.addGroup ? 150 : 8;
  if (!q.trim() && !W.addGroup) { box.innerHTML = `<div class="hint pick-more">Bölge seç ya da ara.</div>`; return; }
  box.classList.toggle("scroll", !!W.addGroup);
  box.innerHTML = hits.slice(0, limit).map((e) =>
    `<button type="button" class="pick-row" data-act="pick-ex" data-id="${esc(e.id)}"><span>${esc(e.name)}</span><span class="meta">${esc(e.muscle_group || "")}</span></button>`).join("") +
    (hits.length > limit ? `<div class="hint pick-more">+${hits.length - limit} hareket daha, aramayı daralt</div>` : "") +
    (!hits.length && !q.trim() ? `<div class="hint pick-more">Bu bölgede eklenecek hareket kalmadı.</div>` : "") +
    (q.trim() && !exact ? `<button type="button" class="pick-row new" data-act="pick-new">+ Yeni hareket: “${esc(q.trim())}”</button>` : "");
}

async function addItem() {
  let exId = W.addExId;
  if (!exId) return toast("Önce listeden bir hareket seç");
  const spec = readSpec($("#w-add-spec"));
  if (dayItem(W.dayId, exId)) return toast("Bu hareket zaten bu günde");
  W.addExId = null;
  W.addQuery = "";
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

async function saveSpec(itemId) {
  const it = cache.day_exercises.find((x) => x.id === itemId);
  const box = document.querySelector(`[data-spec-box="${itemId}"]`);
  if (!it || !box) return;
  await save("day_exercises", { ...it, ...readSpec(box) });
  W.specEditId = null;
  renderWorkout();
  toast("Hedef kaydedildi");
}

async function onWorkoutClick(ev) {
  const el = ev.target.closest("[data-act]");
  if (!el || el.dataset.act === "date") return;
  const id = el.dataset.id;
  if (el.dataset.act === "pick-ex") {
    W.addExId = id;
    W.addQuery = cache.exercises.find((e) => e.id === id)?.name || "";
    $("#w-add-q").value = W.addQuery;
    renderAddResults();
    return;
  }
  if (el.dataset.act === "add-group") {
    W.addGroup = el.dataset.group || null;
    W.addExId = null;
    renderAddResults();
    $("#w-add-results").scrollTop = 0;
    return;
  }
  if (el.dataset.act === "unpick") { W.addExId = null; renderAddResults(); return $("#w-add-q")?.focus(); }
  if (el.dataset.act === "pick-new") {
    const ex = await newExercise((W.addQuery || "").trim());
    if (!ex) return;
    W.addExId = ex.id;
    W.addQuery = ex.name;
    $("#w-add-q").value = ex.name;
    renderAddResults();
    return;
  }
  if (el.dataset.act.startsWith("note-")) {
    return noteAction(el.dataset.act, el.dataset.kind, Number(el.dataset.i), el.closest(".notes")?.querySelector(".note-input"));
  }
  switch (el.dataset.act) {
    case "open-day": return go("day", { dayId: id });
    case "open-ex": return go("exercise", { exId: id });
    case "new-day": return newDay();
    case "edit-toggle": W.editMode = !W.editMode; W.specEditId = null; return renderWorkout();
    case "add-item": return addItem();
    case "up": return moveItem(id, -1);
    case "down": return moveItem(id, 1);
    case "rest": if (!id) return toast("Bu hareket bir güne bağlı değil"); W.specEditId = W.specEditId === id ? null : id; return renderWorkout();
    case "spec-save": return saveSpec(id);
    case "spec-cancel": W.specEditId = null; return renderWorkout();
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
    case "date-prev": return setWorkoutDate(shiftDate(W.date, -1));
    case "date-next": return setWorkoutDate(shiftDate(W.date, 1));
    case "date-today": return setWorkoutDate(today());
    case "add-set": return addOrUpdateSet();
    case "cancel-edit": W.editingSetId = null; return renderWorkout();
    case "del-set": ev.stopPropagation(); return deleteSet(id);
    case "edit-set": W.editingSetId = id; renderWorkout(); return window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function onWorkoutKey(ev) {
  if (ev.key !== "Enter" || !ev.target.classList.contains("note-input")) return;
  ev.preventDefault();
  noteAction("note-add", ev.target.dataset.kind, 0, ev.target);
}
function onWorkoutChange(ev) {
  if (ev.target.dataset.act !== "date" || !ev.target.value) return; // iOS "Sıfırla" clears the value: keep the current date
  setWorkoutDate(ev.target.value);
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
  rest = { end: Date.now() + sec * 1000, total: sec * 1000, name, done: false };
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
  // CSSOM (not a style attribute) so the CSP stays strict
  bar.style.setProperty("--p", rest.total ? Math.max(0, Math.min(1, (rest.end - Date.now()) / rest.total)).toFixed(3) : "1");
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
const N_FIELDS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "steps"];
const MACROS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g"];
const hasData = (r) => r && (N_FIELDS.some((f) => r[f] != null) || noteLines(r.notes).length);
const nutRow = (date) => cache.nutrition.find((n) => n.date === date);
function renderNutrition() {
  const date = $("#n-date").value;
  const row = nutRow(date);
  for (const f of N_FIELDS) $("#n-" + f).value = row?.[f] ?? "";
  $("#n-notes-title").textContent = `Notlar · ${fmtDate(date)}`;
  if ($("#n-calc-box").open && !document.activeElement?.closest("#n-calc")) renderCalc();
  $("#n-notes-box").innerHTML = noteBlock("nut", row?.notes);
  const recent = cache.nutrition.filter(hasData).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  $("#n-list").innerHTML = recent.length
    ? `<h2>Son kayıtlar</h2>` + recent.map((n) => {
        const parts = [];
        if (MACROS.some((f) => n[f] != null)) parts.push(`${n.kcal != null ? fmt(n.kcal) + " kcal" : "kcal yok"} <span class="meta">· P${fmt(n.protein_g)} K${fmt(n.carb_g)} Y${fmt(n.fat_g)}</span>`);
        if (n.steps != null) parts.push(`<span class="meta">${Number(n.steps).toLocaleString("tr-TR")} adım</span>`);
        const macros = parts.join(" ") || `<span class="meta">sadece not</span>`;
        const notes = noteLines(n.notes);
        return `<button type="button" class="nut-row ${n.date === date ? "on" : ""}" data-nut-date="${n.date}">
          <span class="nut-top"><b>${weekday(n.date)}, ${fmtDate(n.date)}</b><span>${macros}</span></span>
          ${notes.length ? `<span class="nut-notes">${notes.map(esc).join(" · ")}</span>` : ""}</button>`;
      }).join("") + `<p class="hint spaced">Bir güne dokununca o gün yukarıda açılır.</p>`
    : `<p class="hint">Henüz kayıt yok.</p>`;
}
async function saveNutrition() {
  const date = $("#n-date").value;
  if (!date) return;
  const row = { ...(nutRow(date) || {}), id: "n-" + date, date };
  for (const f of N_FIELDS) row[f] = num($("#n-" + f).value);
  if (hasData(row)) await save("nutrition", row);
  else if (nutRow(date)) await remove("nutrition", row.id); // everything cleared: drop the day
  renderNutrition();
  toast(`${fmtDate(date)} kaydedildi`);
}
// ---------- calorie calculator ----------
const ACTIVITY = [
  ["sed", "Sedanter", 1.2, "Masa başı iş, günde 5.000 adımın altı, az ya da hiç antrenman."],
  ["mod", "Orta", 1.55, "Haftada 3–5 antrenman, günde 7–10 bin adım."],
  ["act", "Aktif", 1.725, "Haftada 6–7 antrenman ya da ayakta/fiziksel iş, 10 bin adımın üstü."],
];
const latestMeasure = (mid) => [...cache.measurements].filter((m) => m.metric_id === mid && m.value != null).sort((a, b) => b.date.localeCompare(a.date))[0];
const ageOf = (pr) => (pr.birth_year ? new Date().getFullYear() - pr.birth_year : null);
function renderCalc() {
  const pr = profile();
  const w = latestMeasure("metric-weight"), bf = latestMeasure("metric-body_fat");
  const act = pr.activity || "mod";
  const cutoff = shiftDate(today(), -14);
  const steps = cache.nutrition.filter((n) => n.steps != null && n.date > cutoff).map((n) => n.steps);
  const avgSteps = steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null;
  $("#n-calc").innerHTML = `
    <div class="calc-grid">
      <label>Cinsiyet<select id="c-sex"><option value="">Seç</option><option value="m" ${pr.sex === "m" ? "selected" : ""}>Erkek</option><option value="f" ${pr.sex === "f" ? "selected" : ""}>Kadın</option></select></label>
      <label>Yaş<input type="number" id="c-age" inputmode="numeric" min="14" max="90" value="${ageOf(pr) ?? ""}"></label>
      <label>Boy (cm)<input type="number" id="c-height" inputmode="numeric" value="${pr.height_cm ?? ""}"></label>
      <label>Kilo (kg)<input type="number" id="c-weight" inputmode="decimal" step="0.1" value="${w?.value ?? ""}"></label>
      <label>Yağ oranı (%)<input type="number" id="c-bf" inputmode="decimal" step="0.1" value="${bf?.value ?? ""}" placeholder="bilmiyorsan boş"></label>
      <span></span>
    </div>
    ${w || bf ? `<p class="hint">Kilo${bf ? " ve yağ oranı" : ""} son ölçümünden geldi (${fmtDate((w || bf).date)}). Burada değiştirirsen ölçümün değişmez.</p>` : ""}
    <div class="field-label">Aktivite</div>
    <div class="seg mode-seg" id="c-activity">${ACTIVITY.map(([id, l]) => `<button type="button" data-activity="${id}" class="${id === act ? "active" : ""}">${l}</button>`).join("")}</div>
    <p class="hint" id="c-act-hint"></p>
    ${avgSteps ? `<p class="hint">Son 14 gün ortalaman: <b>${avgSteps.toLocaleString("tr-TR")} adım/gün</b>.</p>` : ""}
    <div id="c-result"></div>`;
  computeCalc();
}
function computeCalc() {
  const pr = profile();
  const sex = $("#c-sex").value, age = num($("#c-age").value), h = num($("#c-height").value);
  const w = num($("#c-weight").value), bf = num($("#c-bf").value);
  const act = ACTIVITY.find((a) => a[0] === (pr.activity || "mod")) || ACTIVITY[1];
  $("#c-act-hint").textContent = `×${act[2]} · ${act[3]}`;
  const out = $("#c-result");
  if (!sex || !age || !h || !w) { out.innerHTML = `<p class="hint">Hesap için cinsiyet, yaş, boy ve kiloyu gir.</p>`; return; }
  const useKatch = bf != null && bf > 2 && bf < 60;
  const bmr = useKatch ? 370 + 21.6 * w * (1 - bf / 100) : 10 * w + 6.25 * h - 5 * age + (sex === "m" ? 5 : -161);
  const tdee = bmr * act[2];
  const r10 = (x) => Math.round(x / 10) * 10;
  const goals = [
    ["Cut", tdee * 0.8, 2.2, "yağ yakımı, ~%20 açık"],
    ["Koruma", tdee, 2.0, "kiloyu korur"],
    ["Bulk", tdee * 1.1, 2.0, "yavaş kas kazanımı, ~%10 fazla"],
  ];
  out.innerHTML = `<div class="calc-table">${goals.map(([name, kcal, pkg, note]) => {
      const k = r10(kcal), P = Math.round(w * pkg), F = Math.round(w * 0.8), C = Math.max(0, Math.round((k - P * 4 - F * 9) / 4));
      return `<div class="calc-row ${name === "Koruma" ? "main" : ""}"><div><b>${name}</b><span class="meta">${note}</span></div>
        <div class="calc-kcal"><b>${k.toLocaleString("tr-TR")}</b> kcal<span class="meta">P ${P} · K ${C} · Y ${F} g</span></div></div>`;
    }).join("")}</div>
    <p class="hint spaced">${useKatch ? "Katch-McArdle (yağ oranıyla)" : "Mifflin-St Jeor"} · bazal ${r10(bmr).toLocaleString("tr-TR")} kcal · günlük harcama ${r10(tdee).toLocaleString("tr-TR")} kcal.
    Tahmini değerler: 2–3 hafta kilo trendine bakıp gerekirse 100–200 kcal ayarla.</p>`;
}
let calcSaveTimer;
function onCalcInput(ev) {
  computeCalc();
  if (!["c-sex", "c-age", "c-height"].includes(ev.target.id)) return; // kilo/yağ oranı ölçümden gelir, profile yazılmaz
  clearTimeout(calcSaveTimer);
  calcSaveTimer = setTimeout(async () => {
    const age = num($("#c-age").value), height_cm = num($("#c-height").value);
    await save("profile", { ...profile(), id: "profile", sex: $("#c-sex").value || null, height_cm,
      birth_year: age ? new Date().getFullYear() - age : null });
  }, 700);
}

// notes save on their own, keeping the day's macros as they are
async function nutNoteAction(act, i, input) {
  const date = $("#n-date").value;
  const cur = nutRow(date);
  const lines = noteLines(cur?.notes);
  if (act === "note-add") {
    const v = input?.value.trim();
    if (!v) return input?.focus();
    lines.push(v);
  } else if (act === "note-edit") {
    const v = prompt("Notu düzenle (silmek için boş bırak):", lines[i]);
    if (v === null) return;
    if (v.trim()) lines[i] = v.trim(); else lines.splice(i, 1);
  } else if (act === "note-del") {
    if (!confirm(`"${lines[i]}" silinsin mi?`)) return;
    lines.splice(i, 1);
  } else return;
  const base = cur || Object.fromEntries(N_FIELDS.map((f) => [f, null]));
  const next = { ...base, id: "n-" + date, date, notes: lines.join("\n") };
  if (hasData(next)) await save("nutrition", next);
  else if (cur) await remove("nutrition", next.id); // last note removed and no numbers: drop the day
  renderNutrition();
  if (act === "note-add") $("#n-notes-box .note-input")?.focus();
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
    const auto = m.id === NAVY.bf && cur?.source === "navy";
    return `<label>${esc(label)} (${esc(m.unit)})${auto ? ` <span class="tag">Navy</span>` : ""}
      <input type="number" inputmode="decimal" step="0.1" data-metric="${esc(m.id)}" value="${cur?.value ?? ""}" placeholder="${lastVal(m.id)}"></label>`;
  };
  const { singles, pairs } = metricGroups();
  const pr = profile();
  const navyHint = !pr.height_cm || !pr.sex
    ? `<p class="hint">Ayarlar → Profil'e boy ve cinsiyet girersen yağ oranı bel ve boyundan otomatik hesaplanır (Navy yöntemi).</p>`
    : `<p class="hint">Yağ oranını boş bırakırsan bel ve boyundan${pr.sex === "f" ? ", kalçadan" : ""} otomatik hesaplanır (Navy). Elle yazarsan senin değerin kalır.</p>`;
  $("#m-fields").innerHTML = navyHint +
    `<div class="grid-fields">${singles.map((m) => field(m)).join("")}</div>` +
    (pairs.length ? `<div class="pair-head"><span>Sol</span><span>Sağ</span></div>
      <div class="grid-fields">${pairs.map((pr) => field(pr.left) + field(pr.right)).join("")}</div>` : "");
}
// U.S. Navy body fat (metric form). Men: waist + neck; women also hips. Needs height and sex from the profile.
const NAVY = { waist: "metric-waist", neck: "metric-neck", hips: "metric-hips", bf: "metric-body_fat" };
const profile = () => cache.profile.find((p) => p.id === "profile") || {};
function navyBodyFat(date) {
  const pr = profile();
  const h = pr.height_cm;
  if (!h || !pr.sex) return null;
  const v = (mid) => cache.measurements.find((m) => m.id === `m-${date}-${mid}`)?.value;
  const w = v(NAVY.waist), n = v(NAVY.neck), hp = v(NAVY.hips);
  if (!w || !n) return null;
  let bf;
  if (pr.sex === "m") {
    if (w <= n) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450;
  } else {
    if (!hp || w + hp <= n) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(w + hp - n) + 0.221 * Math.log10(h)) - 450;
  }
  return bf > 2 && bf < 70 ? Math.round(bf * 10) / 10 : null;
}
// keeps an automatic (source "navy") body fat in step with the tape; a value typed by hand is never overwritten
async function applyNavy(date) {
  const id = `m-${date}-${NAVY.bf}`;
  const cur = cache.measurements.find((m) => m.id === id);
  if (cur && cur.source !== "navy") return null;
  const bf = navyBodyFat(date);
  if (bf == null) { if (cur) await remove("measurements", id); return null; }
  if (cur?.value !== bf) await save("measurements", { id, date, metric_id: NAVY.bf, value: bf, source: "navy" });
  return bf;
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
  const bf = await applyNavy(date);
  renderMeasure();
  toast((n ? `${n} ölçü kaydedildi` : "Değişiklik yok") + (bf != null ? ` · yağ oranı ${fmt(bf)}% (Navy)` : ""));
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
  if (all.length < 1) { el.innerHTML = `<div class="empty">${opts.empty || "Bu dönemde veri yok."}</div>`; return; }
  const dates = new Set(all.map((p) => p[0]));
  if (dates.size === 1) {
    const vals = opts.legend ? series.filter((s) => s.points.length).map((s) => esc(s.label)) : series.filter((s) => s.points.length && s.label !== "7 günlük ort.").map((s) => `${s.label && series.filter((x) => x.label).length > 1 ? s.label + " " : ""}${fmt(Math.round(s.points[0][1] * 10) / 10)}${opts.unit || ""}`);
    el.innerHTML = `<div class="empty">Tek kayıt var: <b>${vals.join(" · ")}</b> (${fmtDate(all[0][0])}). Grafik için en az 2 farklı tarih gerekiyor.</div>`;
    return;
  }
  const W = 340, H = opts.h || 180, L = 40, R = 8, T = 10, B = 22;
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
  if (opts.zero && v0 < 0 && v1 > 0) svg += `<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
  for (const s of series) {
    if (!s.points.length) continue;
    const pts = s.points.map((p) => `${x(Date.parse(p[0])).toFixed(1)},${y(p[1]).toFixed(1)}`);
    svg += `<polyline class="${s.cls}" points="${pts.join(" ")}"/>`;
    if (s.dots) for (const pt of pts) { const [a, b] = pt.split(","); svg += `<circle class="dot ${s.cls}" cx="${a}" cy="${b}" r="2.5"/>`; }
  }
  svg += `</svg>`;
  const legend = series.filter((s) => s.label);
  if (legend.length > 1 || (opts.legend && legend.length)) svg += `<div class="legend">${legend.map((s) => `<span><i class="sw ${s.cls}"></i>${esc(s.label)}</span>`).join("")}</div>`;
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

  const wmap = workoutById();
  // metrics: toggle chips, one small chart per selected metric (units and scales differ)
  renderMetricCharts();

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
  const wkKeys = Object.keys(weeks).sort().slice(-4).reverse();
  const order = (g) => { const i = MUSCLE_GROUPS.indexOf(g); return i < 0 ? 99 : i; };
  const gList = [...groups].filter((g) => wkKeys.some((wk) => weeks[wk][g])).sort((a, b) => order(a) - order(b) || a.localeCompare(b, "tr"));
  $("#p-volume").innerHTML = wkKeys.length
    ? `<table><tr><th>Kas grubu</th>${wkKeys.map((wk) => `<th>${fmtDate(wk)}</th>`).join("")}</tr>` +
      gList.map((g) => `<tr><td>${esc(g)}</td>${wkKeys.map((wk) => `<td>${weeks[wk][g] || "·"}</td>`).join("")}</tr>`).join("") +
      `</table><p class="hint spaced">Sütunlar haftanın pazartesisi. En soldaki bu hafta.</p>`
    : `<p class="hint">Henüz set kaydı yok.</p>`;

  // steps over the selected period
  const sAll = cache.nutrition.filter((n) => n.steps != null).sort((a, b) => a.date.localeCompare(b.date)).map((n) => [n.date, n.steps]);
  const sPts = inRange(sAll);
  const sAvg = sPts.length ? Math.round(sPts.reduce((a, p) => a + p[1], 0) / sPts.length) : null;
  lineChart($("#p-steps-chart"), [{ points: sPts, cls: "l2", dots: sPts.length < 40, label: "Günlük" }, { points: inRange(movingAvg(sAll)), cls: "l1", label: "7 günlük ort." }],
    { caption: sAvg ? `Ortalama: ${sAvg.toLocaleString("tr-TR")} adım/gün (${sPts.length} gün)` : "", empty: "Henüz adım girilmemiş. Günlük sekmesinden girebilirsin." });

  // calories over the selected period
  const kAll = cache.nutrition.filter((n) => n.kcal != null).sort((a, b) => a.date.localeCompare(b.date)).map((n) => [n.date, n.kcal]);
  const kPts = inRange(kAll);
  const kAvg = kPts.length ? Math.round(kPts.reduce((a, p) => a + p[1], 0) / kPts.length) : null;
  lineChart($("#p-kcal-chart"), [{ points: kPts, cls: "l2", dots: kPts.length < 40, label: "Günlük" }, { points: inRange(movingAvg(kAll)), cls: "l1", label: "7 günlük ort." }],
    { caption: kAvg ? `Ortalama: ${kAvg} kcal/gün (${kPts.length} gün)` : "" });
}

function metricItems() {
  const has = new Set(cache.measurements.filter((m) => m.value != null).map((m) => m.metric_id));
  const g = metricGroups();
  return [
    ...g.singles.filter((m) => has.has(m.id)).map((m) => ({ key: m.id, label: m.name, unit: m.unit, ids: [m.id] })),
    ...g.pairs.filter((pr) => has.has(pr.left.id) || has.has(pr.right.id))
      .map((pr) => ({ key: `pair:${pr.left.id}|${pr.right.id}`, label: pr.label, unit: pr.left.unit, ids: [pr.left.id, pr.right.id], pair: true })),
  ];
}
function metricSelection(items) {
  let sel;
  try { sel = JSON.parse(localStorageGet("metricSel") || "null"); } catch { sel = null; }
  if (sel === "all") return items.map((i) => i.key);
  sel = (sel || []).filter((k) => items.some((i) => i.key === k));
  if (!sel.length && items.length) {
    // nothing chosen yet: start with the most recently measured metric
    const latest = [...cache.measurements].filter((m) => m.value != null).sort((a, b) => b.date.localeCompare(a.date) || b.updated_at - a.updated_at)[0];
    const it = items.find((i) => i.ids.includes(latest?.metric_id)) || items[0];
    sel = [it.key];
  }
  return sel;
}
const SERIES_COLORS = 8;
function renderMetricCharts() {
  const items = metricItems();
  const sel = metricSelection(items);
  const all = items.length && sel.length === items.length;
  const delta = localStorageGet("metricMode") === "delta";
  const chosenKeys = items.filter((i) => sel.includes(i.key)).map((i) => i.key);
  $("#p-metric-chips").innerHTML = items.length
    ? `<button type="button" class="chip all ${all ? "on" : ""}" data-chip="__all" aria-pressed="${all}">Hepsi</button>` +
      items.map((i) => {
        const on = sel.includes(i.key);
        return `<button type="button" class="chip ${on ? `on c${chosenKeys.indexOf(i.key) % SERIES_COLORS}` : ""}" data-chip="${esc(i.key)}" aria-pressed="${on}">${esc(i.label)}</button>`;
      }).join("") +
      `<div class="seg mode-seg"><button type="button" data-mode="value" class="${delta ? "" : "active"}">Değer</button><button type="button" data-mode="delta" class="${delta ? "active" : ""}">Değişim</button></div>`
    : "";
  const el = $("#p-metric-chart");
  if (!items.length) { el.innerHTML = `<div class="empty">Henüz ölçü girilmemiş. Ölçüler sekmesinden ilk ölçünü gir.</div>`; return; }

  const raw = (mid) => inRange(cache.measurements.filter((m) => m.metric_id === mid && m.value != null)
    .sort((a, b) => a.date.localeCompare(b.date)).map((m) => [m.date, m.value]));
  // "Değişim" plots each metric relative to its first value in the period, so small moves stay visible
  const shift = (p) => (delta && p.length ? p.map(([d, v]) => [d, Math.round((v - p[0][1]) * 10) / 10]) : p);
  const tail = (p) => (p.length ? ` ${fmt(p[p.length - 1][1])}${p.length > 1 ? ` (${change(p)})` : ""}` : "");
  const series = [];
  items.filter((i) => sel.includes(i.key)).forEach((it, n) => {
    const c = `c${n % SERIES_COLORS}`;
    if (it.pair) {
      const lp = raw(it.ids[0]), rp = raw(it.ids[1]);
      series.push({ points: shift(lp), cls: `${c} dash`, label: `Sol ${it.label.toLocaleLowerCase("tr")}${tail(lp)}`, dots: lp.length < 25 });
      series.push({ points: shift(rp), cls: c, label: `Sağ ${it.label.toLocaleLowerCase("tr")}${tail(rp)}`, dots: rp.length < 25 });
    } else {
      const p = raw(it.ids[0]);
      series.push({ points: shift(p), cls: c, label: `${it.label}${tail(p)}`, dots: p.length < 25 });
    }
  });
  lineChart(el, series, { h: 220, legend: true, zero: delta });
}
function toggleMetricChip(key) {
  const items = metricItems();
  let sel = metricSelection(items);
  if (key === "__all") sel = sel.length === items.length ? [sel[0]] : "all";
  else if (sel.includes(key)) sel = sel.length > 1 ? sel.filter((k) => k !== key) : sel; // keep at least one
  else sel = [...sel, key];
  localStorageSet("metricSel", JSON.stringify(Array.isArray(sel) && sel.length === items.length ? "all" : sel));
  renderMetricCharts();
}

// ---------- settings ----------
function renderProfile() {
  const pr = profile();
  $("#s-height").value = pr.height_cm ?? "";
  $("#s-age").value = ageOf(pr) ?? "";
  $("#s-sex").value = pr.sex || "";
}
async function saveProfile() {
  const height_cm = num($("#s-height").value), sex = $("#s-sex").value || null;
  if (height_cm != null && (height_cm < 120 || height_cm > 230)) return toast("Boyu cm olarak gir, ör. 178");
  const age = num($("#s-age").value);
  await save("profile", { ...profile(), id: "profile", height_cm, sex, birth_year: age ? new Date().getFullYear() - age : null });
  // fill in body fat for every past date that has the needed tape measurements
  const dates = [...new Set(cache.measurements.filter((m) => m.metric_id === NAVY.waist).map((m) => m.date))];
  let n = 0;
  for (const d of dates) if ((await applyNavy(d)) != null) n++;
  renderMeasure();
  toast(n ? `Profil kaydedildi · ${n} tarih için yağ oranı hesaplandı` : "Profil kaydedildi");
}

let exGroup = null;
function renderSettings() {
  renderProfile();
  renderExerciseList();
}
function renderExerciseList() {
  const groups = MUSCLE_GROUPS.filter((g) => cache.exercises.some((e) => e.muscle_group === g))
    .concat([...new Set(cache.exercises.map((e) => e.muscle_group).filter((g) => g && !MUSCLE_GROUPS.includes(g)))]);
  if (exGroup && !groups.includes(exGroup)) exGroup = null;
  $("#s-ex-groups").innerHTML = [`<button type="button" class="chip ${exGroup ? "" : "on all"}" data-group="">Hepsi</button>`]
    .concat(groups.map((g) => `<button type="button" class="chip ${exGroup === g ? "on all" : ""}" data-group="${esc(g)}">${esc(g)}</button>`)).join("");
  const q = $("#s-ex-q").value;
  const list = searchExercises(q, { group: exGroup });
  const wmap = workoutById();
  const count = {};
  for (const s of cache.sets) { const w = wmap[s.workout_id]; if (w) (count[s.exercise_id] ||= new Set()).add(w.date); }
  $("#s-ex-count").textContent = `${list.length} / ${cache.exercises.length} hareket`;
  $("#s-exercises").innerHTML = (list.length ? "" : `<p class="hint">Eşleşen hareket yok.${q.trim() ? " Yukarıdan “Yeni hareket” ile ekleyebilirsin." : ""}</p>`) + list.map((e) =>
    `<div class="list-row"><button type="button" class="link-btn" data-open-ex="${esc(e.id)}">${esc(e.name)} <span class="meta">· ${esc(e.muscle_group || "")}${count[e.id] ? ` · ${count[e.id].size} seans` : ""}</span></button>
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
  renderExerciseList();
  renderWorkout();
}

// ---------- where the app runs: Safari tab vs home screen app (separate storage on iOS) ----------
const isStandalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// ---------- theme: per-device look, so it lives in localStorage ----------
const THEMES = [["ocean", "Okyanus", "#1B6FB5"], ["rose", "Gül kurusu", "#B97983"], ["forest", "Orman", "#1C9A78"], ["graphite", "Grafit", "#243041"]];
function applyTheme(name) {
  if (name === "sunset") name = "rose"; // renamed theme
  const t = THEMES.find((x) => x[0] === name) || THEMES[0];
  document.documentElement.dataset.theme = t[0];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t[2]);
  $("#s-themes").innerHTML = THEMES.map(([id, label]) =>
    `<button type="button" class="theme-btn ${id === t[0] ? "on" : ""}" data-theme-pick="${id}" aria-pressed="${id === t[0]}"><span class="sw-hero sw-${id}"></span><span>${label}</span></button>`).join("");
}

function renderMode() {
  const tab = isIOS() && !isStandalone();
  $("#mode-banner").classList.toggle("hidden", !tab);
  $("#s-mode").innerHTML = isStandalone()
    ? `<p class="ok-text">✓ Ana ekran uygulaması olarak çalışıyor. Veri bu uygulamanın kendi hafızasında, kalıcı.</p>
       <p class="hint">Ana ekrandaki ikonu silersen buradaki veri de silinir. Silmeden önce export al.</p>`
    : `<p class="warn-text">Safari sekmesinde çalışıyor.</p>
       <p class="hint">Buradaki veri ana ekran uygulamasıyla paylaşılmaz ve Safari 7 gün açılmayan sitelerin verisini silebilir.</p>
       <ol class="steps">
         <li>Önce buradaki veriyi al: <b>Dışa aktar</b> → <b>Dosyalar'a Kaydet</b>.</li>
         <li>Safari'de <b>Paylaş</b> butonuna bas. Görünmüyorsa adres çubuğundaki <b>•••</b> menüsünden Paylaş'ı seç.</li>
         <li><b>Ana Ekrana Ekle</b>'yi seç. "Web Uygulaması Olarak Aç" seçeneği varsa açık kalsın. <b>Ekle</b>'ye bas.</li>
         <li>Ana ekrandaki ikonu aç: Ayarlar → <b>Yedekten geri yükle</b> → 1. adımda kaydettiğin dosyayı seç.</li>
         <li>Bundan sonra hep ikondan aç, bu Safari sekmesini kullanma.</li>
       </ol>`;
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
  await seedLibrary();
  await loadCache();
  for (const id of ["#n-date", "#m-date"]) $(id).value = today();
  try {
    const r = JSON.parse(localStorageGet("route") || "null"); // reopen where the app was left (iOS may kill it mid-workout)
    if (r) Object.assign(W, { screen: r.screen || "days", dayId: r.dayId, exId: r.exId });
  } catch { /* ignore */ }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  const wr = $("#w-root");
  wr.addEventListener("click", onWorkoutClick);
  wr.addEventListener("keydown", onWorkoutKey);
  wr.addEventListener("input", (ev) => {
    if (ev.target.id !== "w-add-q") return;
    W.addQuery = ev.target.value;
    W.addExId = null;
    renderAddResults();
  });
  wr.addEventListener("change", onWorkoutChange);
  $("#back-btn").addEventListener("click", goBack);
  $("#rest-plus").addEventListener("click", () => { if (rest.end) { rest.end = Math.max(rest.end, Date.now()) + 30000; rest.total = Math.max(rest.total || 0, rest.end - Date.now()); rest.done = false; localStorageSet("rest", JSON.stringify(rest)); requestWake(); tickRest(); } });
  $("#rest-skip").addEventListener("click", stopRest);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (openedOn !== today()) { openedOn = today(); W.date = today(); W.editingSetId = null; renderWorkout(); } // midnight passed while the app was in background
    if (rest.end) { requestWake(); tickRest(); }
  });
  $("#n-date").addEventListener("change", renderNutrition);
  $("#n-save").addEventListener("click", saveNutrition);
  $("#n-notes-box").addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-act^='note-']");
    if (el) nutNoteAction(el.dataset.act, Number(el.dataset.i), $("#n-notes-box .note-input"));
  });
  $("#n-notes-box").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.classList.contains("note-input")) { ev.preventDefault(); nutNoteAction("note-add", 0, ev.target); }
  });
  $("#n-calc-box").addEventListener("toggle", () => { if ($("#n-calc-box").open) renderCalc(); });
  $("#n-calc").addEventListener("input", onCalcInput);
  $("#n-calc").addEventListener("change", onCalcInput);
  $("#n-calc").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-activity]");
    if (!b) return;
    await save("profile", { ...profile(), id: "profile", activity: b.dataset.activity });
    document.querySelectorAll("#c-activity button").forEach((x) => x.classList.toggle("active", x === b));
    computeCalc();
  });
  $("#n-list").addEventListener("click", (ev) => {
    const r = ev.target.closest("[data-nut-date]");
    if (!r) return;
    $("#n-date").value = r.dataset.nutDate;
    renderNutrition();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#m-date").addEventListener("change", renderMeasure);
  $("#m-save").addEventListener("click", saveMeasure);
  $("#m-new").addEventListener("click", newMetric);
  $("#p-range").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-range]");
    if (b) { localStorageSet("range", b.dataset.range); renderProgress(); }
  });
  $("#p-metric-chips").addEventListener("click", (ev) => {
    const c = ev.target.closest("[data-chip]");
    if (c) return toggleMetricChip(c.dataset.chip);
    const m = ev.target.closest("[data-mode]");
    if (m) { localStorageSet("metricMode", m.dataset.mode); renderMetricCharts(); }
  });
  $("#s-export").addEventListener("click", exportFile);
  $("#s-profile-save").addEventListener("click", saveProfile);
  $("#s-restore").addEventListener("change", (e) => { if (e.target.files[0]) restoreFile(e.target.files[0]); e.target.value = ""; });
  $("#sync-badge").addEventListener("click", () => showView("settings"));
  $("#mode-banner").addEventListener("click", () => showView("settings"));
  $("#s-ex-q").addEventListener("input", renderExerciseList);
  $("#s-ex-groups").addEventListener("click", (ev) => {
    const g = ev.target.closest("[data-group]");
    if (g) { exGroup = g.dataset.group || null; renderExerciseList(); }
  });
  $("#s-ex-new").addEventListener("click", async () => {
    const ex = await newExercise($("#s-ex-q").value.trim());
    if (ex) { $("#s-ex-q").value = ex.name; renderExerciseList(); toast(`${ex.name} eklendi`); }
  });
  $("#s-exercises").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-edit-ex]");
    if (b) return editExercise(b.dataset.editEx);
    const o = ev.target.closest("[data-open-ex]");
    if (o) { showView("workout"); go("exercise", { exId: o.dataset.openEx, dayId: null }); }
  });

  applyTheme(localStorageGet("theme"));
  $("#s-themes").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-theme-pick]");
    if (b) { localStorageSet("theme", b.dataset.themePick); applyTheme(b.dataset.themePick); }
  });
  renderMode();
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
