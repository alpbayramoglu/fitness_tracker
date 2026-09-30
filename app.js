"use strict";

// ---------- IndexedDB ----------
const TABLES = ["exercises", "workouts", "sets", "nutrition", "metrics", "measurements", "days", "day_exercises", "exercise_notes", "profile", "programs"];
let db;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("fitness", 4);
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

// every day belongs to a program; days from before programs existed (or from old files) go to "Programım"
async function ensurePrograms() {
  const progIds = new Set(cache.programs.map((p) => p.id));
  const orphans = cache.days.filter((d) => !progIds.has(d.program_id));
  if (!orphans.length) return;
  if (!progIds.has("prog-main")) {
    const old = await getOne("programs", "prog-main");
    await save("programs", { ...(old || {}), id: "prog-main", name: old?.name || "Programım", created_at: old?.created_at || 1, deleted: 0 });
  }
  for (const d of orphans) await save("days", { ...d, program_id: "prog-main" });
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
  await ensurePrograms();
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

// ---------- date navigator (Antrenman, Günlük, Ölçüler) ----------
// ‹ [Bugün] › — the label reads "Bugün"/"Dün"/"Pzt, 21 Eyl"; tapping it swaps in the native picker
const DATE_NAVS = {
  w: { get: () => W.date, set: (d) => setWorkoutDate(d), refresh: () => renderWorkout() },
  n: { get: () => $("#n-date").value, set: (d) => { $("#n-date").value = d; renderNutrition(); }, refresh: () => { $("#n-date-nav").innerHTML = dateNav("n"); } },
  m: { get: () => $("#m-date").value, set: (d) => { $("#m-date").value = d; renderMeasure(); }, refresh: () => { $("#m-date-nav").innerHTML = dateNav("m"); } },
};
let datePicking = null;
const dayLabel = (d) => (d === today() ? "Bugün" : d === shiftDate(today(), -1) ? "Dün" : `${weekday(d)}, ${fmtDate(d)}`);
const dayWord = (d) => (d === today() ? "bugün" : d === shiftDate(today(), -1) ? "dün" : fmtDate(d)); // inside titles
function dateNav(key) {
  const v = DATE_NAVS[key].get(), other = v !== today();
  return `<div class="date-nav ${other ? "other" : ""}" data-dn="${key}">
    <button type="button" class="step" data-dn-act="prev" aria-label="Önceki gün">‹</button>
    ${datePicking === key
      ? `<input type="date" class="date-input" data-dn-act="pick" value="${v}" max="${today()}" aria-label="Tarih seç">`
      : `<button type="button" class="date-label" data-dn-act="open" aria-label="Tarihi değiştir">${dayLabel(v)}</button>`}
    <button type="button" class="step" data-dn-act="next" aria-label="Sonraki gün" ${other ? "" : "disabled"}>›</button>
    ${other ? `<button type="button" class="step today-btn" data-dn-act="today">Bugün</button>` : ""}
  </div>`;
}
function onDateNavClick(ev) {
  const el = ev.target.closest("[data-dn-act]");
  const host = el?.closest("[data-dn]");
  if (!el || !host || el.dataset.dnAct === "pick") return;
  const nav = DATE_NAVS[host.dataset.dn], v = nav.get();
  const act = el.dataset.dnAct;
  if (act === "prev") return nav.set(shiftDate(v, -1));
  if (act === "next") return nav.set(shiftDate(v, 1));
  if (act === "today") return nav.set(today());
  if (act === "open") {
    datePicking = host.dataset.dn;
    nav.refresh();
    const input = document.querySelector(`[data-dn="${datePicking}"] .date-input`);
    input?.focus();
    try { input?.showPicker?.(); } catch { /* not supported: the visible field is enough */ }
  }
}
function onDateNavChange(ev) {
  if (ev.target.dataset.dnAct !== "pick") return;
  const key = ev.target.closest("[data-dn]").dataset.dn;
  const v = ev.target.value;
  datePicking = null;
  if (v) DATE_NAVS[key].set(v > today() ? today() : v); // iOS "Sıfırla" clears the value: keep the current date
  else DATE_NAVS[key].refresh();
}
function onDateNavBlur(ev) {
  if (ev.target.dataset?.dnAct !== "pick") return;
  setTimeout(() => { // closed without choosing
    if (datePicking && document.activeElement !== ev.target) { const k = datePicking; datePicking = null; DATE_NAVS[k].refresh(); }
  }, 300);
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

// programs, most recently used first: the one trained last (or created last) is the current one
function sortedPrograms(lastDone) {
  const used = (p) => Math.max(p.created_at || 0, ...sortedDays().filter((d) => d.program_id === p.id).map((d) => (lastDone[d.id] ? Date.parse(lastDone[d.id]) : 0)));
  return [...cache.programs].sort((a, b) => used(b) - used(a));
}

function renderDays() {
  const wmap = workoutById();
  const lastDone = {};
  for (const w of cache.workouts) if (w.day_id && (!lastDone[w.day_id] || w.date > lastDone[w.day_id])) {
    if (cache.sets.some((s) => s.workout_id === w.id)) lastDone[w.day_id] = w.date;
  }
  const todayDay = wmap[workoutId(today())]?.day_id;
  const card = (d) => {
    const n = dayItems(d.id).length;
    const last = lastDone[d.id];
    return `<button type="button" class="day-card ${dayTint(d.id)} ${d.id === todayDay ? "today" : ""}" data-act="open-day" data-id="${esc(d.id)}">
      <span><span class="day-name">${esc(d.name)}</span>
      <span class="meta">${n} hareket${last ? ` · son: ${fmtDate(last)}` : ""}${d.id === todayDay ? " · bugün" : ""}</span></span>
      <span class="chev">›</span></button>`;
  };
  const progs = sortedPrograms(lastDone);
  if (!progs.length) return `<p class="hint empty-state">Henüz program yok. PPL, Full Body, Upper/Lower gibi bir program ekle, sonra içine günlerini koy.</p>` +
    `<button type="button" class="wide ghost" data-act="new-program">+ Yeni program</button>`;
  const section = (p, i) => {
    const days = sortedDays().filter((d) => d.program_id === p.id);
    const last = days.map((d) => lastDone[d.id]).filter(Boolean).sort().pop();
    const editing = W.progEdit === p.id;
    // while editing, each day gets its own delete; the program itself can go only once it is empty
    const row = (d) => editing ? `<div class="day-edit-row">${card(d)}<button type="button" class="icon-btn danger" data-act="delete-day-row" data-id="${esc(d.id)}" aria-label="${esc(d.name)} gününü sil">✕</button></div>` : card(d);
    const body = (days.length ? `<div class="day-list">${days.map(row).join("")}</div>` : `<p class="hint empty-state">Bu programda gün yok.</p>`) +
      (editing ? `<div class="row prog-actions">
          <button type="button" class="ghost grow" data-act="rename-program" data-id="${esc(p.id)}">Adını değiştir</button>
          ${days.length ? "" : `<button type="button" class="ghost grow danger-text" data-act="delete-program" data-id="${esc(p.id)}">Programı sil</button>`}</div>
          ${days.length ? `<p class="hint prog-hint">Programı silmek için önce günlerini sil ya da başka programa taşı.</p>` : ""}` : "") +
      `<button type="button" class="wide ghost" data-act="new-day" data-id="${esc(p.id)}">+ Gün ekle</button>`;
    const meta = `${days.length} gün${last ? ` · son: ${fmtDate(last)}` : ""}`;
    const head = `<span class="prog-name">${esc(p.name)}</span><span class="prog-meta">${meta}</span>`;
    const edit = `<button type="button" class="prog-edit" data-act="prog-edit" data-id="${esc(p.id)}" aria-label="Programı düzenle">${editing ? "Bitti" : "Düzenle"}</button>`;
    // the current program is always open; older ones fold away
    return i === 0
      ? `<section class="prog current"><div class="prog-head"><div>${head}</div>${edit}</div>${body}</section>`
      : `<details class="prog" ${editing || W.progOpen?.has(p.id) ? "open" : ""} data-prog="${esc(p.id)}"><summary class="prog-head"><div>${head}</div>${edit}</summary>${body}</details>`;
  };
  return progs.map((p, i) => (i === 1 ? `<div class="prog-older">Önceki programlar</div>` : "") + section(p, i)).join("") +
    `<button type="button" class="wide ghost" data-act="new-program">+ Yeni program</button>`;
}

function renderDay() {
  const items = dayItems(W.dayId);
  const exMap = exerciseById();
  const w = cache.workouts.find((x) => x.id === workoutId(W.date));
  let html = W.editMode
    ? `<div class="toolbar"><span class="hint">Sıra, hedef ve hareketleri düzenle</span>
       <button type="button" class="primary small" data-act="edit-toggle">Bitti</button></div>`
    : `<div class="toolbar">${dateNav("w")}</div>`;

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
    ${cache.programs.length > 1 ? `<label class="day-prog">Program<select id="w-day-prog">${cache.programs.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === cache.days.find((d) => d.id === W.dayId)?.program_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : ""}
    <div class="row">
      <button type="button" class="ghost grow" data-act="rename-day">Adını değiştir</button>
      <button type="button" class="ghost grow danger-text" data-act="delete-day">Günü sil</button>
    </div>`;
  } else {
    html += `<button type="button" class="wide ghost" data-act="edit-toggle">✎ Günü düzenle</button>`;
    html += `<div class="card"><h2>Antrenman notları · ${dayWord(W.date)}</h2>${noteBlock("day", w?.notes)}</div>`;
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
    ${dateNav("w")}
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
      <button type="button" class="primary grow" data-act="add-set">${editing ? `${editing.set_no}. seti güncelle` : "Seti kaydet"}</button>
      ${editing ? `<button type="button" class="ghost" data-act="cancel-edit">Vazgeç</button>` : ""}
    </div>
    <div class="note-wrap"><div class="field-label">Hareket notları · ${dayWord(W.date)}</div>${noteBlock("ex", exNote(W.date, exId))}</div>
    </div>`;

  const vol = todays.reduce((t, s) => t + (s.weight_kg || 0) * (s.reps || 0), 0);
  const prs = personalRecords();
  const today_ = todays.length
    ? `<div class="card"><h2>${W.date === today() ? "Bugün" : `${weekday(W.date)}, ${fmtDate(W.date)} setleri`}</h2>` + todays.map((s) => {
        const prev = last?.sets[s.set_no - 1];
        return `<div class="set-row ${s.id === W.editingSetId ? "editing" : ""}" data-act="edit-set" data-id="${esc(s.id)}">
          <span class="set-main"><span class="setno">${s.set_no}</span><span>${setText(s)}${prs.has(s.id) ? ` <span class="pr" title="${esc(prs.get(s.id))}">🏆</span>` : ""}${prev ? `<br><span class="meta">geçen: ${setShort(prev)}</span>` : ""}</span></span>
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

  // set entry first; what was done before sits underneath
  return form + nextCard(it, todays.length) + today_ + `<div class="card">${lastBox}</div>` + history;
}

function prefillForm() {
  const kg = $("#w-kg");
  if (!kg) return;
  const todays = setsFor(W.exId, W.date);
  const last = lastSession(W.exId, W.date);
  const editing = W.editingSetId && cache.sets.find((s) => s.id === W.editingSetId);
  // today's last set wins (weight already chosen today), otherwise last session's first set
  const it = dayItem(W.dayId, W.exId);
  // the suggestion only shapes the first set of the day; later sets follow what was actually lifted today
  const sug = !editing && !todays.length && suggestionsOn() ? suggestion(W.exId, it, W.date) : null;
  const ref = editing || todays[todays.length - 1] || last?.sets[0];
  kg.value = sug?.kg ?? ref?.weight_kg ?? "";
  $("#w-reps").value = sug?.reps ?? ref?.reps ?? "";
  $("#w-rir").value = (sug && it?.target_rir != null ? it.target_rir : ref?.rir) ?? "";
  const target = last?.sets[todays.length];
  const hints = [];
  if (sug) hints.push(`<span class="sug sug-${sug.kind}">${esc(sug.text)}</span>`);
  if (!editing && target) hints.push(esc(`Geçen sefer ${todays.length + 1}. set: ${setText(target)}`));
  if (it?.target_sets && it.rep_max) hints.push(esc(`Hedef: ${it.target_sets}×${repRange(it)}${it.target_rir != null ? " @ RIR " + fmt(it.target_rir) : ""}`));
  $("#w-next-hint").innerHTML = hints.join("<br>");
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
    const saved = await save("sets", { id: uid(), workout_id: workoutId(W.date), exercise_id: W.exId, set_no: n, weight_kg: kg, reps, rir, notes: "", created_at: Date.now() });
    const it = dayItem(W.dayId, W.exId);
    const pr = personalRecords().get(saved.id);
    if (it?.rest_sec && W.date === today()) startRest(it.rest_sec, cache.exercises.find((e) => e.id === W.exId)?.name || "");
    toast(pr ? `🏆 Yeni rekor: ${pr}` : `${n}. set kaydedildi`);
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

async function newDay(programId) {
  const name = prompt("Gün adı (ör. Push-A, Pull-A, Legs, Upper):");
  if (!name || !name.trim()) return;
  const order = Math.max(0, ...cache.days.map((d) => d.sort_order ?? 0)) + 1;
  const d = await save("days", { id: uid(), name: name.trim(), sort_order: order, program_id: programId });
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
    case "new-day": return newDay(id);
    case "new-program": {
      const name = prompt("Program adı (ör. PPL, Full Body, Upper/Lower):");
      if (!name || !name.trim()) return;
      const p = await save("programs", { id: uid(), name: name.trim(), created_at: Date.now() });
      return newDay(p.id);
    }
    case "prog-edit": ev.preventDefault(); W.progEdit = W.progEdit === id ? null : id; return renderWorkout();
    case "rename-program": {
      const p = cache.programs.find((x) => x.id === id);
      const name = p && prompt("Yeni ad:", p.name);
      if (name && name.trim()) { await save("programs", { ...p, name: name.trim() }); renderWorkout(); }
      return;
    }
    case "delete-day-row": {
      const d = cache.days.find((x) => x.id === id);
      if (!d || !confirm(`"${d.name}" silinsin mi? Bu günde yaptığın setler silinmez.`)) return;
      for (const it of dayItems(d.id)) await remove("day_exercises", it.id);
      await remove("days", d.id);
      return renderWorkout();
    }
    case "delete-program": {
      const p = cache.programs.find((x) => x.id === id);
      if (!p || cache.days.some((d) => d.program_id === id)) return;
      if (!confirm(`"${p.name}" programı silinsin mi?`)) return;
      await remove("programs", id);
      W.progEdit = null;
      return renderWorkout();
    }
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
  $("#n-date-nav").innerHTML = dateNav("n");
  renderTargets();
  $("#n-notes-title").textContent = `Notlar · ${dayWord(date)}`;
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
          <span class="nut-top"><b>${weekday(n.date)}, ${fmtDate(n.date)}${onTarget(n) ? ` <span class="hit" title="Hedefte">✓</span>` : ""}</b><span>${macros}</span></span>
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
// ---------- tip of the day (tips.js) ----------
let tipShift = 0;
function renderTip() {
  if (typeof TIPS === "undefined" || !TIPS.length) return;
  const d = new Date();
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const tip = TIPS[(dayOfYear + tipShift) % TIPS.length];
  $("#n-tip").innerHTML = `<div class="tip-head"><span>💡 Günün bilgisi · ${esc(tip.c)}</span>
      <button type="button" class="tip-next" id="n-tip-next">Sonraki ›</button></div>
    <p class="tip-text">${esc(tip.t)}</p>
    <a class="tip-src" href="https://doi.org/${esc(tip.d)}" target="_blank" rel="noopener">Kaynak: ${esc(tip.s)} ↗</a>`;
}

// ---------- daily targets ----------
const onTarget = (n, pr = profile()) => pr.target_kcal && n.kcal != null && Math.abs(n.kcal - pr.target_kcal) <= pr.target_kcal * 0.1 && (!pr.target_protein || (n.protein_g || 0) >= pr.target_protein * 0.9);
function renderTargets() {
  const pr = profile(), box = $("#n-target");
  if (!pr.target_kcal) { box.innerHTML = `<p class="hint">Günlük hedef yok. Alttaki kalori hesaplayıcıdan bir hedef seçebilirsin.</p>`; return; }
  const row = nutRow($("#n-date").value) || {};
  const bar = (label, val, target, unit) => {
    const pct = target ? Math.min(100, Math.round(((val || 0) / target) * 100)) : 0;
    const state = val == null ? "" : Math.abs(val - target) <= target * 0.1 ? "ok" : val > target ? "over" : "";
    return `<div class="tbar"><div class="tbar-top"><span>${label}</span><span><b>${val != null ? Math.round(val).toLocaleString("tr-TR") : "–"}</b> / ${target.toLocaleString("tr-TR")} ${unit}</span></div>
      <span class="bar"><i class="${state}" style-w="${pct}"></i></span></div>`;
  };
  box.innerHTML = `<div class="field-label">Hedef · ${esc(pr.goal || "")}</div>` + bar("Kalori", row.kcal, pr.target_kcal, "kcal") +
    (pr.target_protein ? bar("Protein", row.protein_g, pr.target_protein, "g") : "") +
    `<p class="hint">Karbonhidrat ${pr.target_carb ?? "–"} g · yağ ${pr.target_fat ?? "–"} g</p>`;
  box.querySelectorAll("[style-w]").forEach((el) => { el.style.width = el.getAttribute("style-w") + "%"; });
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
      const chosen = pr.goal === name && pr.target_kcal === k;
      return `<div class="calc-row ${name === "Koruma" ? "main" : ""}"><div><b>${name}</b><span class="meta">${note}</span>
        <button type="button" class="goal-btn ${chosen ? "on" : ""}" data-goal="${name}" data-k="${k}" data-p="${P}" data-c="${C}" data-f="${F}">${chosen ? "✓ Hedefin" : "Hedef yap"}</button></div>
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
  $("#m-date-nav").innerHTML = dateNav("m");
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
const RANGES = [["90", "3 ay"], ["180", "6 ay"], ["365", "1 yıl"], ["0", "Tümü"], ["custom", "Özel"]];
const rangeKey = () => localStorageGet("range") ?? "90";
// "" start means "since the first record"
function rangeStart() {
  const k = rangeKey();
  if (k === "custom") return localStorageGet("rangeFrom") || shiftDate(today(), -90);
  return Number(k) ? shiftDate(today(), -Number(k)) : "";
}
const rangeEnd = () => (rangeKey() === "custom" ? localStorageGet("rangeTo") || today() : today());
const inRange = (pts) => { const a = rangeStart(), b = rangeEnd(); return pts.filter((p) => p[0] >= a && p[0] <= b); };
const inRangeDate = (d) => d >= rangeStart() && d <= rangeEnd();

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
  let t0 = rangeStart() ? Date.parse(rangeStart()) : Math.min(...ts);
  let t1 = Date.parse(rangeEnd());
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
  $("#p-range").innerHTML = RANGES.map(([v, l]) => `<button type="button" data-range="${v}" class="${rangeKey() === v ? "active" : ""}">${l}</button>`).join("");
  const custom = rangeKey() === "custom";
  $("#p-range-custom").classList.toggle("hidden", !custom);
  if (custom) { $("#p-from").value = rangeStart(); $("#p-to").value = rangeEnd(); $("#p-from").max = $("#p-to").max = today(); }
  renderCalendar();
  renderSummary();
  renderBodyComp();
  renderBadges();

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

// ---------- coaching: suggestions, records, next exercise ----------
const suggestionsOn = () => profile().suggest !== 0;
const incrementFor = (ex) => (/dumbbell|\bdb\b|kettlebell|cable/i.test(ex?.name || "") ? 2.5 : 5); // barbell & machine 5; dumbbell & cable 2.5
// every session of an exercise, oldest first
function sessionsAsc(exId) {
  const wmap = workoutById();
  const by = {};
  for (const s of cache.sets) { const w = wmap[s.workout_id]; if (s.exercise_id === exId && w) (by[w.date] ||= []).push(s); }
  return Object.keys(by).sort().map((date) => {
    const sets = by[date].sort((a, b) => a.set_no - b.set_no);
    return { date, sets, top: Math.max(0, ...sets.map((x) => x.weight_kg || 0)), vol: sets.reduce((t, x) => t + (x.weight_kg || 0) * (x.reps || 0), 0),
      best: Math.max(0, ...sets.map((x) => e1rm(x.weight_kg, x.reps, x.rir) || 0)) };
  });
}
// double progression: all target sets at the top of the range → add weight; below the range → hold; 3 falling sessions → fatigue
function suggestion(exId, it, beforeDate) {
  if (!it?.rep_max || !it.rep_min) return null;
  const hist = sessionsAsc(exId).filter((x) => x.date < beforeDate);
  if (!hist.length) return null;
  const last = hist[hist.length - 1];
  const n = it.target_sets || last.sets.length;
  const work = last.sets.slice(0, n);
  const w = Math.max(0, ...work.map((x) => x.weight_kg || 0));
  if (!w) return null;
  const inc = incrementFor(cache.exercises.find((e) => e.id === exId));
  const b = hist.map((x) => x.best), k = b.length;
  if (k >= 4 && b[k - 1] < b[k - 2] && b[k - 2] < b[k - 3] && b[k - 3] < b[k - 4]) {
    return { kind: "warn", kg: w, reps: it.rep_min, text: "Son 3 seansta performans üst üste düştü. Uyku, beslenme ve toparlanmaya bak; gerekirse bir hafta yükü azalt (deload)." };
  }
  if (work.length >= n && work.every((x) => x.reps >= it.rep_max && (x.weight_kg || 0) >= w)) {
    return { kind: "up", kg: w + inc, reps: it.rep_min, text: `Öneri: ${fmt(w + inc)} kg × ${it.rep_min}. Geçen sefer ${n} sette ${it.rep_max} tekrara ulaştın (+${fmt(inc)} kg).` };
  }
  if (work.some((x) => x.reps < it.rep_min)) {
    return { kind: "hold", kg: w, reps: it.rep_min, text: `Öneri: ${fmt(w)} kg'da kal, bütün setlerde ${it.rep_min} tekrara ulaşmayı hedefle.` };
  }
  const reps = Math.min(it.rep_max, (work[0]?.reps || it.rep_min) + 1);
  return { kind: "reps", kg: w, reps, text: `Öneri: ${fmt(w)} kg, geçen seferden bir tekrar fazlası (hedef ${it.rep_max} tekrar).` };
}
// set id → description for sets that beat everything before them (heaviest weight, or more reps at that weight or heavier)
function personalRecords() {
  const wmap = workoutById();
  const byEx = {};
  for (const s of cache.sets) { const w = wmap[s.workout_id]; if (w && s.reps) (byEx[s.exercise_id] ||= []).push({ ...s, date: w.date }); }
  const out = new Map();
  for (const list of Object.values(byEx)) {
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || 0) - (b.created_at || 0) || a.set_no - b.set_no);
    const firstDate = list[0].date;
    const seen = []; // [kg, reps]
    for (const s of list) {
      const kg = s.weight_kg || 0;
      if (s.date !== firstDate) { // the very first session sets the baseline, it is not a record
        const maxKg = Math.max(0, ...seen.map((x) => x[0]));
        const bestRepsHere = Math.max(0, ...seen.filter((x) => x[0] >= kg).map((x) => x[1]));
        if (kg > maxKg) out.set(s.id, `${fmt(kg)} kg (en ağır)`);
        else if (s.reps > bestRepsHere) out.set(s.id, `${fmt(kg)} kg × ${s.reps} (en çok tekrar)`);
      }
      seen.push([kg, s.reps]);
    }
  }
  return out;
}
// after the target sets are done, point to the next unfinished exercise of the day
function nextCard(it, doneCount) {
  if (!W.dayId || !it?.target_sets || doneCount < it.target_sets || W.editingSetId) return "";
  const items = dayItems(W.dayId);
  const idx = items.findIndex((x) => x.id === it.id);
  const unfinished = (x) => setsFor(x.exercise_id, W.date).length < (x.target_sets || 1);
  const next = items.slice(idx + 1).find(unfinished) || items.slice(0, idx).find(unfinished);
  const exName = (id) => esc(cache.exercises.find((e) => e.id === id)?.name || "");
  return `<div class="card next-card"><div><b>Hedef setler tamam ✓</b>
    <span class="meta">${next ? "Sıradaki hareket" : "Günün bütün hareketleri tamam 🎉"}</span></div>
    ${next ? `<button type="button" class="next-btn" data-act="open-ex" data-id="${esc(next.exercise_id)}">${exName(next.exercise_id)} ›</button>` : ""}</div>`;
}

// ---------- İlerleme: calendar of the last two months ----------
// state of a date: null (no training), "done" (every program exercise reached its target sets) or "part"
function dayStatus(date) {
  const w = cache.workouts.find((x) => x.id === workoutId(date));
  if (!w || !cache.sets.some((s) => s.workout_id === w.id)) return null;
  const items = w.day_id ? dayItems(w.day_id) : [];
  const missing = items.filter((it) => setsFor(it.exercise_id, date).length < (it.target_sets || 1));
  const done = cache.sets.filter((s) => s.workout_id === w.id).length;
  const target = items.reduce((a, it) => a + (it.target_sets || 0), 0);
  return { state: missing.length ? "part" : "done", dayName: cache.days.find((d) => d.id === w.day_id)?.name || "", done, target,
    missing: missing.map((it) => cache.exercises.find((e) => e.id === it.exercise_id)?.name).filter(Boolean) };
}
function monthGrid(y, m) {
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const iso = (d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let cells = "";
  for (let i = 0; i < lead; i++) cells += `<span></span>`;
  for (let d = 1; d <= days; d++) {
    const ds = iso(d), st = ds <= today() ? dayStatus(ds) : null;
    cells += `<button type="button" class="cal-d ${st ? st.state : ""} ${ds === today() ? "today" : ""} ${ds > today() ? "future" : ""}" data-cal="${ds}">${d}</button>`;
  }
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  return `<div class="cal-m"><b>${months[m]}</b><div class="cal-g">${["P", "S", "Ç", "P", "C", "C", "P"].map((x) => `<i>${x}</i>`).join("")}${cells}</div></div>`;
}
function renderCalendar() {
  const [y, m] = today().split("-").map(Number);
  const prev = m === 1 ? [y - 1, 11] : [y, m - 2];
  $("#p-cal").innerHTML = `<div class="cal">${monthGrid(prev[0], prev[1])}${monthGrid(y, m - 1)}</div>
    <div class="cal-legend"><span><i class="done"></i>tamamlandı</span><span><i class="part"></i>eksik kaldı</span></div>
    <p class="hint cal-info" id="p-cal-info">Bir güne dokun, o günün özetini gör.</p>`;
}
function onCalendarClick(ev) {
  const b = ev.target.closest("[data-cal]");
  if (!b) return;
  document.querySelectorAll(".cal-d.sel").forEach((x) => x.classList.remove("sel"));
  b.classList.add("sel");
  const d = b.dataset.cal, st = dayStatus(d);
  $("#p-cal-info").textContent = !st ? `${weekday(d)}, ${fmtDate(d)} · antrenman yok`
    : `${weekday(d)}, ${fmtDate(d)}${st.dayName ? " · " + st.dayName : ""} · ${st.done}${st.target ? "/" + st.target : ""} set` +
      (st.missing.length ? ` · eksik: ${st.missing.join(", ")}` : " · tamamlandı ✓");
}

// ---------- İlerleme: summary for the chosen period ----------
function workoutDatesInRange() {
  const wmap = workoutById();
  const dates = new Map(); // date → day_id
  for (const s of cache.sets) { const w = wmap[s.workout_id]; if (w && inRangeDate(w.date)) dates.set(w.date, w.day_id); }
  return dates;
}
function renderSummary() {
  const dates = workoutDatesInRange();
  const box = $("#p-summary");
  if (!dates.size) { $("#p-summary-title").textContent = "Özet"; box.innerHTML = `<p class="hint">Bu dönemde antrenman kaydı yok.</p>`; return; }
  const first = [...dates.keys()].sort()[0];
  // preset ranges start at the first session (no empty lead-in); a custom range keeps the dates you picked
  const from = rangeKey() === "custom" || rangeStart() > first ? rangeStart() : first, to = rangeEnd();
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  $("#p-summary-title").textContent = `Özet · ${fmtDate(from)} – ${fmtDate(to)}`;
  const wmap = workoutById(), exMap = exerciseById();
  const done = {}, planned = {};
  const detail = {}; // group → exercise → { done, target, dates }
  const row = (g, ex) => ((detail[g] ||= {})[ex] ||= { done: 0, target: 0, dates: {} });
  let sets = 0, vol = 0;
  for (const s of cache.sets) {
    const w = wmap[s.workout_id];
    if (!w || !dates.has(w.date)) continue;
    const g = exMap[s.exercise_id]?.muscle_group || "Diğer";
    done[g] = (done[g] || 0) + 1; sets++; vol += (s.weight_kg || 0) * (s.reps || 0);
    const r = row(g, s.exercise_id); r.done++; r.dates[w.date] = (r.dates[w.date] || 0) + 1;
  }
  // the program's target sets for the days that were actually trained
  for (const [date, dayId] of dates) {
    for (const it of dayId ? dayItems(dayId) : []) {
      const g = exMap[it.exercise_id]?.muscle_group || "Diğer";
      planned[g] = (planned[g] || 0) + (it.target_sets || 0);
      const r = row(g, it.exercise_id); r.target += it.target_sets || 0; (r.planDates ||= []).push(date);
    }
  }
  const breakdown = (g) => Object.entries(detail[g] || {}).sort((a, b) => b[1].done - a[1].done).map(([ex, r]) => {
    const name = esc(exMap[ex]?.name || "?");
    const when = Object.entries(r.dates).sort().map(([d, n]) => `${fmtDate(d)} ${n}`).join(", ");
    const missed = (r.planDates || []).filter((d) => !r.dates[d]).map(fmtDate);
    return `<div class="bd-row"><span><b>${name}</b><small>${when ? when + " set" : ""}${missed.length ? `${when ? " · " : ""}yapılmadı: ${missed.join(", ")}` : ""}${!r.target ? " · programda yok" : ""}</small></span><span>${r.done}${r.target ? ` / ${r.target}` : ""}</span></div>`;
  }).join("");
  const prs = [...personalRecords().keys()].filter((id) => { const s = cache.sets.find((x) => x.id === id); return s && dates.has(wmap[s.workout_id]?.date); }).length;
  const weeks = days / 7;
  const order = (g) => MUSCLE_GROUPS.indexOf(g) + 1 || 99;
  const groups = [...new Set([...Object.keys(done), ...Object.keys(planned)])].sort((a, b) => order(a) - order(b));
  const nut = cache.nutrition.filter((n) => inRangeDate(n.date));
  const avg = (f) => { const v = nut.filter((n) => n[f] != null).map((n) => n[f]); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const kcal = avg("kcal"), prot = avg("protein_g"), steps = avg("steps");
  const ton = vol / 1000;
  const food = [kcal && `${kcal.toLocaleString("tr-TR")} kcal`, prot && `${prot} g protein`, steps && `${steps.toLocaleString("tr-TR")} adım`].filter(Boolean);
  box.innerHTML = `
    <div class="stats">
      <div><b>${dates.size}</b><span>antrenman</span></div>
      <div><b>${sets}</b><span>set</span></div>
      <div><b>${prs}</b><span>rekor</span></div>
      <div><b>${ton >= 10 ? Math.round(ton) : fmt(Math.round(ton * 10) / 10)}</b><span>ton</span></div>
    </div>
    <p class="sum-line">${days} günlük dönem.${weeks >= 2 ? ` Haftada ortalama <b>${(dates.size / weeks).toFixed(1).replace(".", ",")}</b> antrenman.` : ""}</p>
    <div class="sum-head"><b>Programına göre setler</b><span>Yaptığın set / o günlerdeki programının hedefi. Satıra dokun, hangi hareketten ve hangi günden geldiğini gör.</span></div>
    ${groups.map((g) => {
      const d = done[g] || 0, pl = planned[g] || 0;
      if (!pl) return `<details class="bd"><summary class="bar-row"><span class="bar-label">${esc(g)}</span><span class="bar-note">planda yok</span><span class="bar-val">${d} set</span></summary>${breakdown(g)}</details>`;
      const pct = Math.round((d / pl) * 100);
      const perWeek = weeks >= 2 ? `<small>haftada ${Math.round(d / weeks)} set</small>` : "";
      return `<details class="bd"><summary class="bar-row"><span class="bar-label">${esc(g)}${perWeek}</span><span class="bar"><i class="${pct >= 80 ? "ok" : pct >= 50 ? "low" : "over"}" style-w="${Math.min(100, pct)}"></i></span><span class="bar-val">${d} / ${pl}<small>%${pct}</small></span></summary>${breakdown(g)}</details>`;
    }).join("")}
    ${food.length ? `<p class="sum-line spaced">Günlük ortalama: ${food.join(" · ")}.</p>` : ""}`;
  // widths via CSSOM so the strict CSP (no inline styles) holds
  box.querySelectorAll("[style-w]").forEach((el) => { el.style.width = el.getAttribute("style-w") + "%"; });
}

// ---------- İlerleme: body composition ----------
// pairs each weight with a body fat reading from the same day (or up to 3 days away)
function bodyCompSeries() {
  const ser = (mid) => cache.measurements.filter((m) => m.metric_id === mid && m.value != null).sort((a, b) => a.date.localeCompare(b.date)).map((m) => [m.date, m.value]);
  const weight = ser("metric-weight"), bf = ser("metric-body_fat");
  const near = (d) => {
    let best = null;
    for (const [bd, v] of bf) { const gap = Math.abs(Date.parse(bd) - Date.parse(d)) / 86400000; if (gap <= 3 && (!best || gap < best[0])) best = [gap, v]; }
    return best?.[1];
  };
  const lean = [], fat = [];
  for (const [d, w] of weight) { const b = near(d); if (b != null) { lean.push([d, Math.round(w * (1 - b / 100) * 10) / 10]); fat.push([d, Math.round(w * b / 100 * 10) / 10]); } }
  return { weight, bf, lean, fat };
}
// least squares slope in units per day
function slopePerDay(pts) {
  if (pts.length < 2) return null;
  const xs = pts.map((p) => Date.parse(p[0]) / 86400000), ys = pts.map((p) => p[1]);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : null;
}
function renderBodyComp() {
  const box = $("#p-body");
  const all = bodyCompSeries();
  const w = inRange(all.weight), bf = inRange(all.bf), lean = inRange(all.lean), fat = inRange(all.fat);
  if (w.length < 2) { box.innerHTML = `<p class="hint">Bu dönemde en az 2 kilo ölçümü gerekiyor. Yağ oranı da girersen yağsız kütle ve yağ kütlesi hesaplanır.</p>`; return; }
  const d = (pts) => (pts.length > 1 ? Math.round((pts[pts.length - 1][1] - pts[0][1]) * 10) / 10 : null);
  const sign = (x) => (x > 0 ? "+" : "") + fmt(x);
  const tile = (label, pts, unit) => pts.length ? `<div><span>${label}</span><b>${fmt(pts[pts.length - 1][1])}${unit}</b><em class="${d(pts) == null ? "" : d(pts) < 0 ? "down" : d(pts) > 0 ? "up" : ""}">${d(pts) == null ? "–" : sign(d(pts)) + unit}</em></div>` : "";
  const slope = slopePerDay(w); // kg/day
  const weekly = slope * 7;
  const nut = cache.nutrition.filter((n) => n.kcal != null && inRangeDate(n.date));
  const avgK = nut.length ? Math.round(nut.reduce((a, n) => a + n.kcal, 0) / nut.length) : null;
  const span = (Date.parse(w[w.length - 1][0]) - Date.parse(w[0][0])) / 86400000;
  const lines = [];
  lines.push(`Kilo haftada ${sign(Math.round(weekly * 100) / 100)} kg değişiyor (${sign(Math.round((weekly / w[0][1]) * 1000) / 10)}%).`);
  if (avgK && nut.length >= 7 && span >= 14) {
    const maint = Math.round((avgK - slope * 7700) / 10) * 10; // ~7700 kcal per kg of body weight
    lines.push(Math.abs(weekly) < 0.1
      ? `Kilon sabit: bu dönemin ortalaması <b>${avgK.toLocaleString("tr-TR")} kcal</b> koruma kalorine çok yakın.`
      : `Ortalama ${avgK.toLocaleString("tr-TR")} kcal ile bu hız, tahmini koruma kalorin: <b>${maint.toLocaleString("tr-TR")} kcal</b>.`);
  } else if (avgK) {
    lines.push(`Ortalama ${avgK.toLocaleString("tr-TR")} kcal (${nut.length} gün). Koruma kalorisi tahmini için en az 14 günlük süre ve 7 gün kalori kaydı gerekiyor.`);
  } else lines.push("Bu dönemde kalori kaydı yok; kalori girersen koruma kalorin hesaplanır.");
  const dl = d(lean), df = d(fat);
  if (dl != null && df != null) {
    if (df < -0.3 && dl > 0.3) lines.push("Rekompozisyon: yağ kütlesi azalırken yağsız kütle artıyor.");
    else if (df < -0.3 && dl >= -0.5) lines.push("Temiz cut: yağ kütlesi azalıyor, yağsız kütle korunuyor.");
    else if (df < 0 && dl < -0.5) lines.push("Yağsız kütle de düşüyor: protein alımını ve antrenman yoğunluğunu kontrol et.");
    else if (dl > 0.3 && df <= dl) lines.push("Temiz bulk: artışın çoğu yağsız kütle.");
    else if (df > 0.3 && df > dl) lines.push("Bulk: artışın çoğu yağ; kalori fazlasını biraz azaltmayı düşün.");
    else lines.push("Vücut kompozisyonu bu dönemde yatay.");
  }
  box.innerHTML = `<div class="tiles">${tile("Kilo", w, " kg")}${tile("Yağ oranı", bf, "%")}${tile("Yağsız kütle", lean, " kg")}${tile("Yağ kütlesi", fat, " kg")}</div>
    <div class="chart" id="p-body-chart"></div>
    <p class="hint spaced">${lines.join(" ")}</p>
    ${bf.length ? `<p class="hint">Yağ oranı mezura ile tahmin edildiği için tek tek ölçümler oynaktır; eğilime bak.</p>` : ""}`;
  const shift = (p) => p.map(([dd, v]) => [dd, Math.round((v - p[0][1]) * 10) / 10]);
  lineChart($("#p-body-chart"), [
    { points: shift(w), cls: "c0", label: "Kilo", dots: w.length < 25 },
    ...(lean.length > 1 ? [{ points: shift(lean), cls: "c2", label: "Yağsız kütle", dots: lean.length < 25 }, { points: shift(fat), cls: "c1", label: "Yağ kütlesi", dots: fat.length < 25 }] : []),
  ], { h: 170, legend: true, zero: true, caption: "Dönem başına göre değişim (kg)" });
}

// ---------- İlerleme: badges ----------
function consecutiveRun(values, pred, need) {
  // index of the first element that completes `need` consecutive pred(prev, cur) steps, or -1
  let run = 0;
  for (let i = 1; i < values.length; i++) { run = pred(values[i - 1], values[i]) ? run + 1 : 0; if (run >= need) return i; }
  return -1;
}
function groupProgressBadge(groups, metric, need = 3) {
  // earliest session where some exercise of these groups rose `need` times in a row
  let best = null, bestRun = 0;
  for (const ex of cache.exercises.filter((e) => groups.includes(e.muscle_group))) {
    const ss = sessionsAsc(ex.id);
    if (ss.length < 2) continue;
    const i = consecutiveRun(ss, (a, b) => metric(b) > metric(a), need);
    if (i >= 0 && (!best || ss[i].date < best)) best = ss[i].date;
    let run = 0; for (let k = 1; k < ss.length; k++) { run = metric(ss[k]) > metric(ss[k - 1]) ? run + 1 : 0; bestRun = Math.max(bestRun, run); }
  }
  return { date: best, progress: `${Math.min(bestRun, need)}/${need}` };
}
function weekKey(ds) { const d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
function computeBadges() {
  const wmap = workoutById(), exMap = exerciseById();
  const workoutDates = [...new Set(cache.sets.map((s) => wmap[s.workout_id]?.date).filter(Boolean))].sort();
  const nth = (n) => ({ date: workoutDates[n - 1] || null, progress: `${Math.min(workoutDates.length, n)}/${n}` });
  // a program day done in full: every exercise reached its target sets
  const complete = workoutDates.filter((d) => {
    const dayId = wmap[workoutId(d)]?.day_id, items = dayId ? dayItems(dayId) : [];
    return items.length && items.every((it) => setsFor(it.exercise_id, d).length >= (it.target_sets || 1));
  });
  // weeks with at least 3 sessions, 4 in a row
  const perWeek = {}; for (const d of workoutDates) perWeek[weekKey(d)] = (perWeek[weekKey(d)] || 0) + 1;
  const weeks = Object.keys(perWeek).sort();
  let clock = null, run = 0, bestRun = 0;
  for (let i = 0; i < weeks.length; i++) {
    const consecutive = i > 0 && (Date.parse(weeks[i]) - Date.parse(weeks[i - 1])) === 7 * 86400000;
    run = perWeek[weeks[i]] >= 3 ? (consecutive && run ? run + 1 : 1) : 0;
    bestRun = Math.max(bestRun, run);
    if (run >= 4 && !clock) clock = weeks[i];
  }
  // biceps: same top weight, more volume, three weeks in a row
  let special = null, specialRun = 0;
  for (const ex of cache.exercises.filter((e) => e.muscle_group === "Biceps")) {
    const byWeek = {};
    for (const s of sessionsAsc(ex.id)) { const k = weekKey(s.date); const cur = byWeek[k] ||= { top: 0, vol: 0, date: s.date }; cur.top = Math.max(cur.top, s.top); cur.vol += s.vol; cur.date = s.date; }
    const ws = Object.keys(byWeek).sort();
    let r = 0;
    for (let i = 1; i < ws.length; i++) {
      const a = byWeek[ws[i - 1]], b = byWeek[ws[i]];
      r = (Date.parse(ws[i]) - Date.parse(ws[i - 1]) === 7 * 86400000 && b.top === a.top && b.vol > a.vol) ? r + 1 : 0;
      specialRun = Math.max(specialRun, r);
      if (r >= 3 && (!special || b.date < special)) special = b.date;
    }
  }
  // legs every week for 8 weeks
  const legWeeks = new Set(cache.sets.filter((s) => ["Quadriceps", "Hamstring"].includes(exMap[s.exercise_id]?.muscle_group) && wmap[s.workout_id]).map((s) => weekKey(wmap[s.workout_id].date)));
  const lw = [...legWeeks].sort(); let legRun = 0, legBest = 0, legDate = null;
  for (let i = 0; i < lw.length; i++) { legRun = i && Date.parse(lw[i]) - Date.parse(lw[i - 1]) === 7 * 86400000 ? legRun + 1 : 1; legBest = Math.max(legBest, legRun); if (legRun >= 8 && !legDate) legDate = lw[i]; }
  // 10+ sets for every big muscle group in one week
  const bigGroups = ["Göğüs", "Sırt", "Omuz", "Quadriceps", "Hamstring"];
  const wg = {};
  for (const s of cache.sets) { const w = wmap[s.workout_id]; const g = exMap[s.exercise_id]?.muscle_group; if (w && bigGroups.includes(g)) { const k = weekKey(w.date); (wg[k] ||= {})[g] = (wg[k][g] || 0) + 1; } }
  const olympia = Object.keys(wg).sort().find((k) => bigGroups.every((g) => (wg[k][g] || 0) >= 10)) || null;
  const olympiaBest = Math.max(0, ...Object.values(wg).map((m) => bigGroups.filter((g) => (m[g] || 0) >= 10).length));
  // records
  const prDates = [...personalRecords().keys()].map((id) => { const s = cache.sets.find((x) => x.id === id); return wmap[s.workout_id]?.date; }).filter(Boolean).sort();
  // steps: 10k a day, 7 days in a row
  const stepDays = cache.nutrition.filter((n) => (n.steps || 0) >= 10000).map((n) => n.date).sort();
  let sRun = 0, sBest = 0, walker = null;
  for (let i = 0; i < stepDays.length; i++) { sRun = i && shiftDate(stepDays[i - 1], 1) === stepDays[i] ? sRun + 1 : 1; sBest = Math.max(sBest, sRun); if (sRun >= 7 && !walker) walker = stepDays[i]; }
  // protein target hit 7 days in a row
  const tp = profile().target_protein;
  const protDays = tp ? cache.nutrition.filter((n) => (n.protein_g || 0) >= tp * 0.95).map((n) => n.date).sort() : [];
  let pRun = 0, pBest = 0, protein = null;
  for (let i = 0; i < protDays.length; i++) { pRun = i && shiftDate(protDays[i - 1], 1) === protDays[i] ? pRun + 1 : 1; pBest = Math.max(pBest, pRun); if (pRun >= 7 && !protein) protein = protDays[i]; }

  const top = (s) => s.top, vol = (s) => s.vol, topOrVol = (s) => s.top * 100000 + s.vol;
  // per-session totals
  const sess = {};
  for (const s of cache.sets) { const w = wmap[s.workout_id]; if (w) { const x = sess[w.date] ||= { vol: 0, ex: new Set(), first: Infinity, last: 0 }; x.vol += (s.weight_kg || 0) * (s.reps || 0); x.ex.add(s.exercise_id); if (s.created_at > 1e12) { x.first = Math.min(x.first, s.created_at); x.last = Math.max(x.last, s.created_at); } } }
  const sessDates = Object.keys(sess).sort();
  const firstWhere = (f) => sessDates.find((d) => f(sess[d], d)) || null;
  const hourOf = (ms) => new Date(ms).getHours();
  let tons = 0, tonsDate = { 100: null, 1000: null };
  for (const d of sessDates) { tons += sess[d].vol / 1000; for (const k of [100, 1000]) if (!tonsDate[k] && tons >= k) tonsDate[k] = d; }
  // comeback after 14+ days
  const comeback = sessDates.find((d, i) => i && (Date.parse(d) - Date.parse(sessDates[i - 1])) / 86400000 >= 14) || null;
  // Saturday and Sunday of the same week
  const weekend = sessDates.find((d) => new Date(d + "T12:00:00").getDay() === 0 && sess[shiftDate(d, -1)]) || null;
  // most sessions of one exercise, distinct exercises tried
  const exCount = {}; const exFirst = {};
  for (const d of sessDates) for (const e of sess[d].ex) { exCount[e] = (exCount[e] || 0) + 1; if (exCount[e] === 20 && !exFirst.loyal) exFirst.loyal = d; }
  let distinct = new Set(), explorer = null;
  for (const d of sessDates) { for (const e of sess[d].ex) distinct.add(e); if (!explorer && distinct.size >= 30) explorer = d; }
  // records in one session
  const prByDate = {}; for (const d of prDates) prByDate[d] = (prByDate[d] || 0) + 1;
  const yeah = Object.keys(prByDate).sort().find((d) => prByDate[d] >= 3) || null;
  // 20+ reps in one quad set
  const platz = cache.sets.filter((s) => (s.reps || 0) >= 20 && exMap[s.exercise_id]?.muscle_group === "Quadriceps" && wmap[s.workout_id]).map((s) => wmap[s.workout_id].date).sort()[0] || null;
  // bench press with at least body weight
  const bw = latestMeasure("metric-weight")?.value;
  const benchIds = cache.exercises.filter((e) => /bench press/i.test(e.name) && !/dumbbell|\bdb\b|close|incline|decline|smith|machine/i.test(e.name)).map((e) => e.id);
  const bodyBench = bw ? cache.sets.filter((s) => benchIds.includes(s.exercise_id) && (s.weight_kg || 0) >= bw && wmap[s.workout_id]).map((s) => wmap[s.workout_id].date).sort()[0] || null : null;
  const benchBest = Math.max(0, ...cache.sets.filter((s) => benchIds.includes(s.exercise_id)).map((s) => s.weight_kg || 0));
  // nutrition logging streak and a very generous day
  const kcalDays = cache.nutrition.filter((n) => n.kcal != null).map((n) => n.date).sort();
  const tk = profile().target_kcal;
  const cheat = tk ? cache.nutrition.filter((n) => n.kcal != null && n.kcal >= tk * 1.3).map((n) => n.date).sort()[0] || null : null;
  const longest = Math.max(0, ...sessDates.map((d) => (sess[d].last - sess[d].first) / 60000));
  // strength clubs: heaviest set of the main lifts, found by name
  const idsWhere = (re, not) => cache.exercises.filter((e) => re.test(e.name) && !(not && not.test(e.name))).map((e) => e.id);
  const liftIds = {
    bench: benchIds,
    squat: idsWhere(/\bsquat\b/i, /hack|split|goblet|pendulum|belt|sissy|smith|v-squat|jump|front|box|pistol|dumbbell|overhead|zercher|safety/i),
    dead: idsWhere(/deadlift/i, /romanian|stiff|single|dumbbell|rack|deficit|snatch/i),
    pull: idsWhere(/pull-?up|chin-?up/i, /assisted|band|machine|kipping/i),
    dip: idsWhere(/\bdips?\b/i, /bench|machine|assisted/i),
  };
  const firstSet = (ids, ok) => cache.sets.filter((s) => ids.includes(s.exercise_id) && wmap[s.workout_id] && ok(s)).map((s) => wmap[s.workout_id].date).sort()[0] || null;
  const bestOf = (ids, f) => Math.max(0, ...cache.sets.filter((s) => ids.includes(s.exercise_id)).map(f));
  const heavy = (s) => s.weight_kg || 0, reps = (s) => s.reps || 0;
  const club = (e, n, d, ids, kg) => ({ e, n, d, date: firstSet(ids, (s) => heavy(s) >= kg), progress: `${fmt(bestOf(ids, heavy))}/${kg} kg` });
  const ratio = (e, n, d, ids, x) => bw
    ? { e, n, d: `${d} (${fmt(Math.round(bw * x))} kg).`, date: firstSet(ids, (s) => heavy(s) >= bw * x), progress: `${fmt(bestOf(ids, heavy))}/${fmt(Math.round(bw * x))} kg` }
    : { e, n, d: `${d} (önce kilonu gir).`, date: null, progress: "–" };
  const repsIn = (e, n, d, ids, r) => ({ e, n, d, date: firstSet(ids, (s) => reps(s) >= r), progress: `${bestOf(ids, reps)}/${r}` });
  // longest run of weight increases on any exercise
  let ladderBest = 0; const ladder = {};
  for (const ex of cache.exercises) {
    const ss = sessionsAsc(ex.id); let r = 0;
    for (let i = 1; i < ss.length; i++) { r = ss[i].top > ss[i - 1].top ? r + 1 : 0; ladderBest = Math.max(ladderBest, r); for (const k of [3, 5, 10]) if (r >= k && (!ladder[k] || ss[i].date < ladder[k])) ladder[k] = ss[i].date; }
  }
  return [
    { e: "🥚", n: "İlk Adım", d: "İlk antrenmanını kaydet.", ...nth(1) },
    { e: "🔥", n: "Isındık", d: "10 antrenman.", ...nth(10) },
    { e: "🧱", n: "Demirbaş", d: "50 antrenman.", ...nth(50) },
    { e: "💯", n: "Yüzler Kulübü", d: "100 antrenman.", ...nth(100) },
    { e: "✅", n: "Eksiksiz", d: "Bir antrenman gününün bütün hareketlerinde hedef setleri tamamla.", date: complete[0] || null, progress: `${Math.min(complete.length, 1)}/1` },
    { e: "🎯", n: "Mükemmeliyetçi", d: "10 antrenmanı eksiksiz tamamla.", date: complete[9] || null, progress: `${Math.min(complete.length, 10)}/10` },
    { e: "⏰", n: "Saat Gibi", d: "4 hafta üst üste haftada en az 3 antrenman.", date: clock, progress: `${Math.min(bestRun, 4)}/4` },
    { e: "📈", n: "Merdiven", d: "Herhangi bir harekette 3 antrenman üst üste ağırlık artır.", date: ladder[3] || null, progress: `${Math.min(ladderBest, 3)}/3` },
    { e: "🪜", n: "Yürüyen Merdiven", d: "Bir harekette 5 antrenman üst üste ağırlık artır.", date: ladder[5] || null, progress: `${Math.min(ladderBest, 5)}/5` },
    { e: "🚀", n: "Asansör", d: "Bir harekette 10 antrenman üst üste ağırlık artır.", date: ladder[10] || null, progress: `${Math.min(ladderBest, 10)}/10` },
    club("🏋️", "100 kg Bench Kulübü", "Bench press'te 100 kg kaldır.", liftIds.bench, 100),
    club("🦍", "140 kg Squat Kulübü", "Squat'ta 140 kg kaldır.", liftIds.squat, 140),
    club("🐂", "180 kg Deadlift Kulübü", "Deadlift'te 180 kg kaldır.", liftIds.dead, 180),
    ratio("🦵", "Bir Buçuk Kat", "Squat'ta vücut ağırlığının 1.5 katı", liftIds.squat, 1.5),
    ratio("🏗️", "İki Kat", "Deadlift'te vücut ağırlığının 2 katı", liftIds.dead, 2),
    repsIn("🧗", "Barfiks 10", "Tek sette 10 barfiks (pull-up ya da chin-up).", liftIds.pull, 10),
    repsIn("🐒", "Barfiks 20", "Tek sette 20 barfiks. Artık maymunsun.", liftIds.pull, 20),
    repsIn("🤸", "Dips 20", "Tek sette 20 dips.", liftIds.dip, 20),
    { e: "🦵", n: "Quad Canavarı", d: "Bir quad hareketinde 3 antrenman üst üste hacim ya da ağırlık artır.", ...groupProgressBadge(["Quadriceps"], topOrVol) },
    { e: "💪", n: "Kol Mimarı", d: "Bir biceps hareketinde aynı ağırlıkla 3 hafta üst üste hacim artır.", date: special, progress: `${Math.min(specialRun, 3)}/3` },
    { e: "🦅", n: "Kanat Açtı", d: "Bir sırt hareketinde 3 antrenman üst üste hacim artır.", ...groupProgressBadge(["Sırt"], vol) },
    { e: "🛡️", n: "Zırh Göğüs", d: "Bir göğüs hareketinde 3 antrenman üst üste ağırlık artır.", ...groupProgressBadge(["Göğüs"], top) },
    { e: "🥥", n: "Gülle Omuzlar", d: "Bir omuz hareketinde 3 antrenman üst üste hacim artır.", ...groupProgressBadge(["Omuz"], vol) },
    { e: "🦿", n: "Bacak Günü Kaçmaz", d: "8 hafta üst üste her hafta bacak çalış.", date: legDate, progress: `${Math.min(legBest, 8)}/8` },
    { e: "🏆", n: "Rekor Avcısı", d: "10 kişisel rekor kır.", date: prDates[9] || null, progress: `${Math.min(prDates.length, 10)}/10` },
    { e: "👑", n: "Salonun Kralı", d: "Bir haftada göğüs, sırt, omuz, quad ve hamstring'in her birinde 10+ set.", date: olympia, progress: `${olympiaBest}/5` },
    { e: "🚶", n: "Yürüyen Adam", d: "7 gün üst üste 10.000 adım.", date: walker, progress: `${Math.min(sBest, 7)}/7` },
    { e: "🐦", n: "Erkenci Kuş", d: "Saat 08:00'den önce antrenman yap.", date: firstWhere((x) => x.first < Infinity && hourOf(x.first) < 8), progress: "0/1" },
    { e: "🦉", n: "Gece Kuşu", d: "Saat 22:00'den sonra antrenman yap.", date: firstWhere((x) => x.last && hourOf(x.last) >= 22), progress: "0/1" },
    { e: "🗓️", n: "Hafta Sonu Savaşçısı", d: "Aynı hafta sonu hem cumartesi hem pazar antrenman yap.", date: weekend, progress: "0/1" },
    { e: "🔁", n: "Geri Döndüm", d: "14 günden uzun bir aradan sonra salona dön.", date: comeback, progress: "0/1" },
    { e: "🚛", n: "Ton Kaldıran", d: "Tek antrenmanda 10 ton hacim.", date: firstWhere((x) => x.vol >= 10000), progress: `${Math.min(10, Math.floor(Math.max(0, ...Object.values(sess).map((x) => x.vol)) / 1000))}/10 ton` },
    { e: "🏗️", n: "Vinç", d: "Toplamda 100 ton kaldır.", date: tonsDate[100], progress: `${Math.min(100, Math.floor(tons))}/100 ton` },
    { e: "🚢", n: "Tanker", d: "Toplamda 1.000 ton kaldır.", date: tonsDate[1000], progress: `${Math.min(1000, Math.floor(tons))}/1000 ton` },
    { e: "⏳", n: "Maraton", d: "Tek antrenman 2 saatten uzun sürsün (ilk setten son sete).", date: firstWhere((x) => x.last - x.first >= 7200000), progress: `${Math.min(120, Math.round(longest))}/120 dk` },
    { e: "🌧️", n: "Rekor Yağmuru", d: "Tek antrenmanda 3 rekor kır.", date: yeah, progress: `${Math.min(3, Math.max(0, ...Object.values(prByDate)))}/3` },
    { e: "🔥", n: "Yirmilik Bacak", d: "Bir quad hareketinde tek sette 20+ tekrar.", date: platz, progress: "0/1" },
    { e: "⚖️", n: "Kendi Ağırlığın", d: bw ? `Bench press'te vücut ağırlığın kadar kaldır (${fmt(bw)} kg).` : "Bench press'te vücut ağırlığın kadar kaldır (önce kilonu gir).", date: bodyBench, progress: bw ? `${fmt(benchBest)}/${fmt(bw)} kg` : "–" },
    { e: "💍", n: "Sadakat", d: "Aynı hareketi 20 seans çalış.", date: exFirst.loyal || null, progress: `${Math.min(20, Math.max(0, ...Object.values(exCount)))}/20` },
    { e: "🧪", n: "Deneyci", d: "30 farklı hareket dene.", date: explorer, progress: `${Math.min(30, distinct.size)}/30` },
    { e: "📒", n: "Günlükçü", d: "30 gün kalori kaydı gir.", date: kcalDays[29] || null, progress: `${Math.min(30, kcalDays.length)}/30` },
    { e: "🍕", n: "Cheat Day", d: tk ? "Kalori hedefinin %30 üstüne çık. Bir kereden bir şey olmaz." : "Kalori hedefi seçince açılır: hedefin %30 üstüne çık.", date: cheat, progress: "0/1" },
    ...extraBadges(sess, sessDates, wmap, exMap),
    { e: "🥩", n: "Protein Canavarı", d: tp ? `7 gün üst üste protein hedefine (${tp} g) ulaş.` : "Kalori hesaplayıcıdan bir hedef seçince açılır: 7 gün üst üste protein hedefi.", date: protein, progress: `${Math.min(pBest, 7)}/7` },
  ];
}
function extraBadges(sess, sessDates, wmap, exMap) {
  const dow = (d) => new Date(d + "T12:00:00").getDay();
  // chest on four Mondays in a row
  const chestMondays = [...new Set(cache.sets.filter((s) => exMap[s.exercise_id]?.muscle_group === "Göğüs" && wmap[s.workout_id] && dow(wmap[s.workout_id].date) === 1).map((s) => wmap[s.workout_id].date))].sort();
  let cm = 0, cmBest = 0, chestDay = null;
  for (let i = 0; i < chestMondays.length; i++) { cm = i && shiftDate(chestMondays[i - 1], 7) === chestMondays[i] ? cm + 1 : 1; cmBest = Math.max(cmBest, cm); if (cm >= 4 && !chestDay) chestDay = chestMondays[i]; }
  // 12 sessions in one calendar month
  const months = {}; for (const d of sessDates) (months[d.slice(0, 7)] ||= []).push(d);
  const bestMonth = Math.max(0, ...Object.values(months).map((l) => l.length));
  const athlete = Object.keys(months).sort().map((m) => months[m]).find((l) => l.length >= 12)?.[11] || null;
  // five or more muscle groups in one session
  const groupsIn = (d) => new Set(cache.sets.filter((s) => wmap[s.workout_id]?.date === d).map((s) => exMap[s.exercise_id]?.muscle_group).filter((g) => g && g !== "Diğer")).size;
  const fullBody = sessDates.find((d) => groupsIn(d) >= 5) || null;
  // measurements and body fat
  const measureDays = [...new Set(cache.measurements.filter((m) => m.value != null).map((m) => m.date))].sort();
  const bfDate = (lim) => cache.measurements.filter((m) => m.metric_id === "metric-body_fat" && m.value != null && m.value < lim).map((m) => m.date).sort()[0] || null;
  const bfNow = latestMeasure("metric-body_fat")?.value;
  // sets taken to failure (RIR 0)
  const failure = cache.sets.filter((s) => s.rir === 0 && wmap[s.workout_id]).map((s) => wmap[s.workout_id].date).sort();
  // dates
  const onDay = (mmdd, span = 0) => sessDates.find((d) => { const md = d.slice(5); return span ? md >= mmdd && md <= span : md === mmdd; }) || null;
  const firstS = sessDates[0], lastS = sessDates[sessDates.length - 1];
  const tenure = firstS ? (Date.parse(lastS) - Date.parse(firstS)) / 86400000 : 0;
  const after = (days) => (firstS && tenure >= days ? sessDates.find((d) => (Date.parse(d) - Date.parse(firstS)) / 86400000 >= days) : null);
  // body weight and lean mass change
  const w = cache.measurements.filter((m) => m.metric_id === "metric-weight" && m.value != null).sort((a, b) => a.date.localeCompare(b.date));
  let peak = -Infinity, down5 = null;
  for (const m of w) { peak = Math.max(peak, m.value); if (!down5 && peak - m.value >= 5) down5 = m.date; }
  const lean = bodyCompSeries().lean;
  const leanGain = lean.length > 1 ? lean.find((p) => p[1] - lean[0][1] >= 3)?.[0] || null : null;
  const leanNow = lean.length > 1 ? Math.round((lean[lean.length - 1][1] - lean[0][1]) * 10) / 10 : 0;
  return [
    { e: "🍗", n: "Pazartesi Göğüs Günü", d: "4 pazartesi üst üste göğüs çalış. Salonların yazılı olmayan kuralı.", date: chestDay, progress: `${Math.min(cmBest, 4)}/4` },
    { e: "🥇", n: "Ayın Sporcusu", d: "Bir takvim ayında 12 antrenman.", date: athlete, progress: `${Math.min(bestMonth, 12)}/12` },
    { e: "🧩", n: "Tam Vücut", d: "Tek antrenmanda 5 farklı kas grubu çalış.", date: fullBody, progress: `${Math.min(5, Math.max(0, ...sessDates.map(groupsIn)))}/5` },
    { e: "💀", n: "Sona Kadar", d: "RIR 0 ile 50 set, yani tükenişe kadar.", date: failure[49] || null, progress: `${Math.min(failure.length, 50)}/50` },
    { e: "📏", n: "Mezura Ustası", d: "10 farklı günde ölçüm gir.", date: measureDays[9] || null, progress: `${Math.min(measureDays.length, 10)}/10` },
    { e: "✂️", n: "15 Altı", d: "Yağ oranın %15'in altına insin.", date: bfDate(15), progress: bfNow != null ? `%${fmt(bfNow)}` : "–" },
    { e: "🔪", n: "Tek Haneli", d: "Yağ oranın %10'un altına insin.", date: bfDate(10), progress: bfNow != null ? `%${fmt(bfNow)}` : "–" },
    { e: "🪶", n: "5 Kilo Gitti", d: "En yüksek kilondan 5 kg aşağı in.", date: down5, progress: w.length ? `${fmt(Math.max(0, Math.round((peak - w[w.length - 1].value) * 10) / 10))}/5 kg` : "–" },
    { e: "🧱", n: "Kas Kazanımı", d: "Yağsız kütlen ilk ölçümüne göre 3 kg artsın (kilo + yağ oranından).", date: leanGain, progress: `${fmt(Math.max(0, leanNow))}/3 kg` },
    { e: "🎆", n: "Yeni Yıl, Yeni Ben", d: "Yılın ilk haftasında (1–7 Ocak) antrenman yap.", date: onDay("01-01", "01-07"), progress: "0/1" },
    { e: "🇹🇷", n: "Cumhuriyet Kası", d: "29 Ekim'de antrenman yap.", date: onDay("10-29"), progress: "0/1" },
    { e: "🌗", n: "Yarım Yıl", d: "İlk antrenmanından 6 ay sonra hâlâ salondasın.", date: after(182), progress: `${Math.min(182, Math.round(tenure))}/182 gün` },
    { e: "🎂", n: "Bir Yıl Oldu", d: "İlk antrenmanından 1 yıl sonra hâlâ salondasın.", date: after(365), progress: `${Math.min(365, Math.round(tenure))}/365 gün` },
  ];
}

// ---------- tiered medals and level ----------
const TIERS = [[50, "🥉", "Bronz"], [100, "🥈", "Gümüş"], [250, "🥇", "Altın"], [500, "💎", "Elmas"], [1000, "👑", "Efsane"]];
const MEDAL_NAMES = ["Bronz", "Gümüş", "Altın", "Elmas", "Efsane"], MEDAL_EMOJI = ["🥉", "🥈", "🥇", "💎", "👑"];
// families with their own thresholds; value → { cur, next }
function tierState(value, steps) {
  const i = steps.filter((t) => value >= t).length;
  return { value, level: i, cur: i ? [steps[i - 1], MEDAL_EMOJI[i - 1], MEDAL_NAMES[i - 1]] : null, next: i < steps.length ? [steps[i], MEDAL_EMOJI[i], MEDAL_NAMES[i]] : null };
}
function trainingTotals() {
  const wmap = workoutById();
  const sess = {};
  let reps = 0, kg = 0;
  for (const s of cache.sets) {
    const w = wmap[s.workout_id]; if (!w) continue;
    reps += s.reps || 0; kg += (s.weight_kg || 0) * (s.reps || 0);
    const x = sess[w.date] ||= { first: Infinity, last: 0 };
    if (s.created_at > 1e12) { x.first = Math.min(x.first, s.created_at); x.last = Math.max(x.last, s.created_at); }
  }
  const hours = Object.values(sess).reduce((a, x) => a + (x.last > x.first ? x.last - x.first : 0), 0) / 3600000;
  // weeks in a row with at least 2 sessions
  const per = {}; for (const d of Object.keys(sess)) per[weekKey(d)] = (per[weekKey(d)] || 0) + 1;
  const wk = Object.keys(per).filter((k) => per[k] >= 2).sort();
  let run = 0, best = 0;
  for (let i = 0; i < wk.length; i++) { run = i && Date.parse(wk[i]) - Date.parse(wk[i - 1]) === 7 * 86400000 ? run + 1 : 1; best = Math.max(best, run); }
  // best bench + squat + deadlift
  const best1 = (re, not) => Math.max(0, ...cache.sets.filter((s) => { const n = cache.exercises.find((e) => e.id === s.exercise_id)?.name || ""; return re.test(n) && !not.test(n); }).map((s) => s.weight_kg || 0));
  const big3 = best1(/bench press/i, /dumbbell|\bdb\b|close|incline|decline|smith|machine/i) +
    best1(/\bsquat\b/i, /hack|split|goblet|pendulum|belt|sissy|smith|v-squat|jump|front|box|pistol|dumbbell|overhead|zercher|safety/i) +
    best1(/deadlift/i, /romanian|stiff|single|dumbbell|rack|deficit|snatch/i);
  return { tons: kg / 1000, reps, hours, streak: best, big3 };
}
function medalFamilies() {
  const t = trainingTotals();
  return [
    { title: "Kas grubu setleri", note: "50 / 100 / 250 / 500 / 1000 set", rows: setMilestones().map((m) => ({ label: m.g, st: tierState(m.n, [50, 100, 250, 500, 1000]), unit: "set", date: m.date })) },
    { title: "Toplamlar", note: "Kariyer boyunca", rows: [
      { label: "Hacim", st: tierState(Math.floor(t.tons), [50, 100, 250, 500, 1000]), unit: "ton" },
      { label: "Tekrar", st: tierState(t.reps, [1000, 5000, 10000, 25000, 50000]), unit: "tekrar" },
      { label: "Salon saati", st: tierState(Math.floor(t.hours), [10, 25, 50, 100, 250]), unit: "saat" },
      { label: "Haftalık seri", st: tierState(t.streak, [4, 8, 12, 26, 52]), unit: "hafta", hint: "üst üste en az 2 antrenmanlı hafta" },
      { label: "Big 3", st: tierState(t.big3, [250, 300, 400, 500, 600]), unit: "kg", hint: "bench + squat + deadlift en iyileri" },
    ] },
  ];
}
const LEVEL_TITLES = [[1, "Çaylak"], [3, "Salon Tanıdığı"], [5, "Demir Çırağı"], [7, "Müdavim"], [9, "Demirci"], [11, "Pump Avcısı"], [13, "Kanatlı"], [15, "Heykel"], [17, "Titan"], [19, "Olimpos"], [20, "Efsane"]];
const levelNeed = (n) => 50 * n * (n - 1); // XP needed to reach level n (1 → 0, 2 → 100, 3 → 300 …)
function levelOf(xp) {
  let n = 1; while (n < 20 && xp >= levelNeed(n + 1)) n++;
  const title = [...LEVEL_TITLES].reverse().find(([l]) => n >= l)[1];
  return { n, title, next: n < 20 ? levelNeed(n + 1) : null, base: levelNeed(n) };
}
// one row per muscle group: current medal, date it was reached and how far the next one is
function setMilestones() {
  const wmap = workoutById(), exMap = exerciseById();
  const byGroup = {};
  for (const s of cache.sets) { const w = wmap[s.workout_id]; const g = exMap[s.exercise_id]?.muscle_group; if (w && g && g !== "Diğer") (byGroup[g] ||= []).push(w.date); }
  return MUSCLE_GROUPS.filter((g) => g !== "Diğer").map((g) => {
    const dates = (byGroup[g] || []).sort(), n = dates.length;
    const reached = TIERS.filter(([t]) => n >= t);
    const cur = reached[reached.length - 1], next = TIERS.find(([t]) => n < t);
    return { g, n, cur, next, date: cur ? dates[cur[0] - 1] : null };
  });
}
let badgeCache = [];
function renderBadges() {
  const list = computeBadges();
  const got = list.filter((b) => b.date);
  const fams = medalFamilies();
  const medals = fams.reduce((a, f) => a + f.rows.reduce((x, r) => x + r.st.level, 0), 0);
  // XP: every set 1, every record 10, every badge 50, every medal step 25
  const xp = cache.sets.length + personalRecords().size * 10 + got.length * 50 + medals * 25;
  const lv = levelOf(xp);
  $("#p-badges-count").textContent = `Seviye ${lv.n} · ${got.length}/${list.length} rozet · ${medals} madalya`;
  const ordered = [...got.sort((a, b) => b.date.localeCompare(a.date)), ...list.filter((b) => !b.date)];
  badgeCache = ordered.map((b) => ({ ...b, info: `${b.e} ${b.n}: ${b.d}${b.date ? ` Kazanıldı: ${fmtDate(b.date)}.` : ` Durum: ${b.progress}.`}` }));
  const famTiles = fams.map((f) => f.rows.map((r) => {
    const st = r.st, val = st.value.toLocaleString("tr-TR");
    badgeCache.push({ e: st.cur ? st.cur[1] : "🔒", n: r.label, date: st.cur ? (r.date || "x") : null, progress: st.next ? `${val}/${st.next[0].toLocaleString("tr-TR")}` : val,
      info: `${r.label}: ${val} ${r.unit}${r.hint ? ` (${r.hint})` : ""}.${st.cur ? ` ${st.cur[2]} madalya.` : ""} ${st.next ? `Sıradaki ${st.next[2]} ${st.next[1]}: ${st.next[0].toLocaleString("tr-TR")} ${r.unit}.` : "Bütün madalyalar tamam."}` });
    return badgeCache.length - 1;
  }));
  const tile = (i) => { const b = badgeCache[i]; const sub = b.date && b.date !== "x" ? fmtDate(b.date) : b.progress;
    return `<button type="button" class="btile ${b.date ? "on" : ""}" data-badge="${i}"><span class="bt-e">${b.e}</span><b>${esc(b.n)}</b><span>${esc(sub)}</span></button>`; };
  const pct = lv.next ? Math.round(((xp - lv.base) / (lv.next - lv.base)) * 100) : 100;
  $("#p-badges").innerHTML = `
    <div class="level"><div><b>Seviye ${lv.n} · ${lv.title}</b><span>${xp.toLocaleString("tr-TR")} XP${lv.next ? ` · sonraki seviye ${lv.next.toLocaleString("tr-TR")} XP` : " · en yüksek seviye"}</span></div>
      <span class="bar"><i class="ok" style-w="${pct}"></i></span>
      <small>Her set 1, her rekor 10, her rozet 50, her madalya 25 XP.</small></div>
    <p class="hint badge-info" id="p-badge-info">Bir rozete dokun, nasıl kazanıldığını gör.</p>
    <div class="bgrid">${ordered.map((_, i) => tile(i)).join("")}</div>
    ${fams.map((f, k) => `<div class="field-label badge-sub">${f.title} · ${f.note}</div><div class="bgrid">${famTiles[k].map(tile).join("")}</div>`).join("")}`;
  $("#p-badges").querySelectorAll("[style-w]").forEach((el) => { el.style.width = el.getAttribute("style-w") + "%"; });
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
  $("#s-suggest").checked = suggestionsOn();
  renderExerciseList();
}
function renderExerciseList() {
  const groups = MUSCLE_GROUPS.filter((g) => cache.exercises.some((e) => e.muscle_group === g))
    .concat([...new Set(cache.exercises.map((e) => e.muscle_group).filter((g) => g && !MUSCLE_GROUPS.includes(g)))]);
  if (exGroup && !groups.includes(exGroup)) exGroup = null;
  $("#s-ex-groups").innerHTML = []
    .concat(groups.map((g) => `<button type="button" class="chip ${exGroup === g ? "on all" : ""}" data-group="${esc(g)}">${esc(g)}</button>`)).join("");
  const q = $("#s-ex-q").value;
  if (!q.trim() && !exGroup) { // 700+ exercises: show nothing until the list is narrowed
    $("#s-ex-count").textContent = `${cache.exercises.length} hareket`;
    $("#s-exercises").innerHTML = `<p class="hint">Bir bölge seç ya da ara.</p>`;
    return;
  }
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
  await ensurePrograms();
  for (const id of ["#n-date", "#m-date"]) $(id).value = today();
  document.addEventListener("click", onDateNavClick);
  document.addEventListener("change", onDateNavChange);
  document.addEventListener("focusout", onDateNavBlur);
  try {
    const r = JSON.parse(localStorageGet("route") || "null"); // reopen where the app was left (iOS may kill it mid-workout)
    if (r) Object.assign(W, { screen: r.screen || "days", dayId: r.dayId, exId: r.exId });
  } catch { /* ignore */ }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  const wr = $("#w-root");
  wr.addEventListener("click", onWorkoutClick);
  wr.addEventListener("keydown", onWorkoutKey);
  wr.addEventListener("change", async (ev) => {
    if (ev.target.id !== "w-day-prog") return;
    const d = cache.days.find((x) => x.id === W.dayId);
    if (d) { await save("days", { ...d, program_id: ev.target.value }); toast("Gün taşındı"); }
  });
  // remember which older programs are unfolded across re-renders
  wr.addEventListener("toggle", (ev) => {
    const id = ev.target.dataset?.prog;
    if (!id) return;
    W.progOpen = W.progOpen || new Set();
    ev.target.open ? W.progOpen.add(id) : W.progOpen.delete(id);
  }, true);
  wr.addEventListener("input", (ev) => {
    if (ev.target.id !== "w-add-q") return;
    W.addQuery = ev.target.value;
    W.addExId = null;
    renderAddResults();
  });
  $("#back-btn").addEventListener("click", goBack);
  $("#rest-minus").addEventListener("click", () => {
    if (!rest.end || rest.done) return;
    rest.end = Math.max(Date.now(), rest.end - 30000); // under 30 s left: ends the rest now
    localStorageSet("rest", JSON.stringify(rest));
    tickRest();
  });
  $("#rest-plus").addEventListener("click", () => { if (rest.end) { rest.end = Math.max(rest.end, Date.now()) + 30000; rest.total = Math.max(rest.total || 0, rest.end - Date.now()); rest.done = false; localStorageSet("rest", JSON.stringify(rest)); requestWake(); tickRest(); } });
  $("#rest-skip").addEventListener("click", stopRest);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (openedOn !== today()) {
      openedOn = today(); W.date = today(); W.editingSetId = null;
      for (const id of ["#n-date", "#m-date"]) $(id).value = today();
      renderAll();
    } // midnight passed while the app was in background
    if (rest.end) { requestWake(); tickRest(); }
  });
  $("#n-save").addEventListener("click", saveNutrition);
  renderTip();
  $("#n-tip").addEventListener("click", (ev) => { if (ev.target.id === "n-tip-next") { tipShift++; renderTip(); } });
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
    const g = ev.target.closest("[data-goal]");
    if (g) {
      const d = g.dataset;
      await save("profile", { ...profile(), id: "profile", goal: d.goal, target_kcal: +d.k, target_protein: +d.p, target_carb: +d.c, target_fat: +d.f });
      computeCalc();
      renderTargets();
      return toast(`Günlük hedef: ${d.goal} · ${Number(d.k).toLocaleString("tr-TR")} kcal, ${d.p} g protein`);
    }
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
  $("#s-suggest").addEventListener("change", async (ev) => {
    await save("profile", { ...profile(), id: "profile", suggest: ev.target.checked ? 1 : 0 });
    toast(ev.target.checked ? "Öneriler açık" : "Öneriler kapalı");
  });
  const setCustom = () => {
    const a = $("#p-from").value, b = $("#p-to").value;
    if (!a || !b) return;
    localStorageSet("rangeFrom", a <= b ? a : b);
    localStorageSet("rangeTo", a <= b ? b : a);
    renderProgress();
  };
  $("#p-from").addEventListener("change", setCustom);
  $("#p-cal").addEventListener("click", onCalendarClick);
  $("#p-badges").addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-badge]");
    if (!t) return;
    document.querySelectorAll(".btile.sel").forEach((x) => x.classList.remove("sel"));
    t.classList.add("sel");
    $("#p-badge-info").textContent = badgeCache[+t.dataset.badge]?.info || "";
  });
  $("#p-to").addEventListener("change", setCustom);
  $("#s-restore").addEventListener("change", (e) => { if (e.target.files[0]) restoreFile(e.target.files[0]); e.target.value = ""; });
  $("#sync-badge").addEventListener("click", () => showView("settings"));
  $("#mode-banner").addEventListener("click", () => showView("settings"));
  $("#s-ex-q").addEventListener("input", renderExerciseList);
  $("#s-ex-groups").addEventListener("click", (ev) => {
    const g = ev.target.closest("[data-group]");
    if (g) { exGroup = exGroup === g.dataset.group ? null : g.dataset.group || null; renderExerciseList(); } // tap again to clear
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
