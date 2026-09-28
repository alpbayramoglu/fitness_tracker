"use strict";

// ---------- IndexedDB ----------
const TABLES = ["exercises", "workouts", "sets", "nutrition", "metrics", "measurements"];
let db;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("fitness", 1);
    req.onupgradeneeded = () => {
      for (const t of TABLES) req.result.createObjectStore(t, { keyPath: "id" });
      req.result.createObjectStore("meta");
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
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("#view-title").textContent = TITLES[name];
  if (name === "progress") renderProgress();
  if (name === "settings") { renderSettings(); updateBadge(); }
}

// ---------- workout ----------
let editingSetId = null;
const workoutId = (d) => "w-" + d;

function renderExerciseOptions() {
  const sel = $("#w-exercise");
  const current = sel.value || localStorageGet("lastExercise");
  const opts = [...cache.exercises].sort(byName);
  sel.innerHTML = opts.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("");
  if (current && opts.some((e) => e.id === current)) sel.value = current;
}

function setsFor(exId, date) {
  const wmap = workoutById();
  return cache.sets
    .filter((s) => s.exercise_id === exId && wmap[s.workout_id] && wmap[s.workout_id].date === date)
    .sort((a, b) => a.set_no - b.set_no);
}

function lastSession(exId, beforeDate) {
  const wmap = workoutById();
  let best = null;
  for (const s of cache.sets) {
    const w = wmap[s.workout_id];
    if (s.exercise_id !== exId || !w || w.date >= beforeDate) continue;
    if (!best || w.date > best) best = w.date;
  }
  return best ? { date: best, sets: setsFor(exId, best) } : null;
}

function renderLastHint() {
  const exId = $("#w-exercise").value;
  const date = $("#w-date").value;
  const last = exId && lastSession(exId, date);
  $("#w-last").textContent = last
    ? `Son sefer ${last.date}: ` + last.sets.map((s) => `${fmt(s.weight_kg)}×${fmt(s.reps)}${s.rir != null ? " @" + fmt(s.rir) : ""}`).join(", ")
    : "Bu hareket için önceki kayıt yok.";
}

function prefillForm() {
  if (editingSetId) return;
  const exId = $("#w-exercise").value;
  const date = $("#w-date").value;
  const todays = setsFor(exId, date);
  const ref = todays[todays.length - 1] || lastSession(exId, date)?.sets[todays.length] || lastSession(exId, date)?.sets[0];
  $("#w-kg").value = ref?.weight_kg ?? "";
  $("#w-reps").value = ref?.reps ?? "";
  $("#w-rir").value = ref?.rir ?? "";
}

function renderWorkout() {
  const date = $("#w-date").value;
  const w = cache.workouts.find((x) => x.id === workoutId(date));
  const notes = $("#w-notes");
  if (document.activeElement !== notes) notes.value = w?.notes || "";
  renderLastHint();

  const exMap = exerciseById();
  const todays = cache.sets.filter((s) => s.workout_id === workoutId(date));
  const groups = {};
  for (const s of todays) (groups[s.exercise_id] ||= []).push(s);
  const html = Object.entries(groups)
    .sort((a, b) => Math.min(...a[1].map((s) => s.created_at || s.updated_at)) - Math.min(...b[1].map((s) => s.created_at || s.updated_at)))
    .map(([exId, sets]) => {
      sets.sort((a, b) => a.set_no - b.set_no);
      const vol = sets.reduce((t, s) => t + (s.weight_kg || 0) * (s.reps || 0), 0);
      return `<div class="card ex-group"><h3>${esc(exMap[exId]?.name || "?")}</h3>` +
        sets.map((s) => {
          const e = e1rm(s.weight_kg, s.reps, s.rir);
          return `<div class="set-row ${s.id === editingSetId ? "editing" : ""}" data-id="${esc(s.id)}">
            <span><b>${s.set_no}.</b> ${fmt(s.weight_kg)} kg × ${fmt(s.reps)}${s.rir != null ? ` · RIR ${fmt(s.rir)}` : ""}</span>
            <span><span class="meta">${e ? "1RM≈" + fmt(Math.round(e)) : ""}</span>
            <button class="icon-btn" data-del="${esc(s.id)}" aria-label="Sil">✕</button></span></div>`;
        }).join("") +
        `<div class="set-row"><span class="meta">Hacim</span><span class="meta">${fmt(Math.round(vol))} kg</span></div></div>`;
    }).join("");
  $("#w-list").innerHTML = html;
}

async function addOrUpdateSet() {
  const date = $("#w-date").value;
  const exId = $("#w-exercise").value;
  const kg = num($("#w-kg").value), reps = num($("#w-reps").value), rir = num($("#w-rir").value);
  if (!date || !exId) return toast("Tarih ve hareket seç");
  if (reps == null) return toast("Tekrar sayısını gir");
  if (!cache.workouts.some((w) => w.id === workoutId(date))) {
    const old = await getOne("workouts", workoutId(date)); // may exist as deleted
    await save("workouts", { ...(old || {}), id: workoutId(date), date, notes: old?.notes || "", deleted: 0 });
  }
  if (editingSetId) {
    const s = await getOne("sets", editingSetId);
    await save("sets", { ...s, weight_kg: kg, reps, rir });
    cancelEdit();
    toast("Set güncellendi");
  } else {
    const n = setsFor(exId, date).length + 1;
    await save("sets", { id: uid(), workout_id: workoutId(date), exercise_id: exId, set_no: n, weight_kg: kg, reps, rir, notes: "", created_at: Date.now() });
    localStorageSet("lastExercise", exId);
    toast(`${n}. set eklendi`);
  }
  renderWorkout();
}

function startEdit(id) {
  const s = cache.sets.find((x) => x.id === id);
  if (!s) return;
  editingSetId = id;
  $("#w-exercise").value = s.exercise_id;
  $("#w-kg").value = s.weight_kg ?? "";
  $("#w-reps").value = s.reps ?? "";
  $("#w-rir").value = s.rir ?? "";
  $("#w-add").textContent = `${s.set_no}. seti güncelle`;
  $("#w-cancel").classList.remove("hidden");
  renderWorkout();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function cancelEdit() {
  editingSetId = null;
  $("#w-add").textContent = "Set ekle";
  $("#w-cancel").classList.add("hidden");
  prefillForm();
  renderWorkout();
}

async function deleteSet(id) {
  const s = cache.sets.find((x) => x.id === id);
  if (!s || !confirm(`${s.set_no}. set silinsin mi?`)) return;
  await remove("sets", id);
  // renumber remaining sets of that exercise
  const rest = cache.sets.filter((x) => x.workout_id === s.workout_id && x.exercise_id === s.exercise_id).sort((a, b) => a.set_no - b.set_no);
  for (let i = 0; i < rest.length; i++) if (rest[i].set_no !== i + 1) await save("sets", { ...rest[i], set_no: i + 1 });
  if (editingSetId === id) cancelEdit();
  renderWorkout();
}

const MUSCLE_GROUPS = ["Göğüs", "Sırt", "Omuz", "Bacak", "Kol", "Karın", "Diğer"];
async function newExercise() {
  const name = prompt("Hareket adı:");
  if (!name || !name.trim()) return;
  if (cache.exercises.some((e) => e.name.toLowerCase() === name.trim().toLowerCase())) return toast("Bu hareket zaten var");
  const g = prompt(`Kas grubu (${MUSCLE_GROUPS.join(", ")}):`, "Diğer") || "Diğer";
  const ex = await save("exercises", { id: uid(), name: name.trim(), muscle_group: g.trim() });
  renderExerciseOptions();
  $("#w-exercise").value = ex.id;
  onExerciseChange();
}

function onExerciseChange() {
  if (editingSetId) cancelEdit();
  renderLastHint();
  prefillForm();
}

let notesTimer;
function onNotesInput() {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(async () => {
    const date = $("#w-date").value;
    const old = await getOne("workouts", workoutId(date));
    const notes = $("#w-notes").value;
    if ((old?.notes || "") === notes) return;
    await save("workouts", { ...(old || {}), id: workoutId(date), date, notes, deleted: 0 });
  }, 600);
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
function renderMeasure() {
  const date = $("#m-date").value;
  const metrics = [...cache.metrics].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  const lastVal = (mid) => {
    const prev = cache.measurements.filter((m) => m.metric_id === mid && m.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
    return prev ? `son: ${fmt(prev.value)}` : "";
  };
  $("#m-fields").innerHTML = metrics.map((m) => {
    const cur = cache.measurements.find((x) => x.id === `m-${date}-${m.id}`);
    return `<label>${esc(m.name)} (${esc(m.unit)})
      <input type="number" inputmode="decimal" step="0.1" data-metric="${esc(m.id)}" value="${cur?.value ?? ""}" placeholder="${lastVal(m.id)}"></label>`;
  }).join("");
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
function lineChart(el, series, opts = {}) {
  // series: [{points:[[dateStr, value]], cls}]
  const all = series.flatMap((s) => s.points);
  if (all.length < 1) { el.innerHTML = `<div class="empty">Grafik için yeterli veri yok.</div>`; return; }
  const W = 340, H = 170, L = 40, R = 8, T = 10, B = 22;
  const ts = all.map((p) => Date.parse(p[0]));
  const vs = all.map((p) => p[1]);
  let t0 = Math.min(...ts), t1 = Math.max(...ts);
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
  const d0 = new Date(t0).toISOString().slice(5, 10), d1 = new Date(t1).toISOString().slice(5, 10);
  svg += `<text class="axis" x="${L}" y="${H - 6}">${d0}</text><text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${d1}</text>`;
  for (const s of series) {
    if (!s.points.length) continue;
    const pts = s.points.map((p) => `${x(Date.parse(p[0])).toFixed(1)},${y(p[1]).toFixed(1)}`);
    svg += `<polyline class="${s.cls}" points="${pts.join(" ")}"/>`;
    if (s.dots) for (const p of pts) { const [a, b] = p.split(","); svg += `<circle class="dot" cx="${a}" cy="${b}" r="2.5"/>`; }
  }
  svg += `</svg>`;
  if (opts.caption) svg += `<p class="hint">${opts.caption}</p>`;
  el.innerHTML = svg;
}

function renderProgress() {
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
  const exPts = Object.entries(best).sort().map(([d, v]) => [d, v]);
  const peak = exPts.length ? Math.max(...exPts.map((p) => p[1])) : null;
  lineChart($("#p-ex-chart"), [{ points: exPts, cls: "l1", dots: true }],
    { caption: peak ? `En iyi tahmini 1RM: ${fmt(Math.round(peak))} kg · 1RM = kg × (1 + (tekrar + RIR) / 30)` : "" });

  // metric chart with 7-day moving average
  const mSel = $("#p-metric");
  const prevM = mSel.value || "metric-weight";
  const metrics = [...cache.metrics].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  mSel.innerHTML = metrics.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.unit)})</option>`).join("");
  if (metrics.some((m) => m.id === prevM)) mSel.value = prevM;
  const mPts = cache.measurements.filter((m) => m.metric_id === mSel.value && m.value != null)
    .sort((a, b) => a.date.localeCompare(b.date)).map((m) => [m.date, m.value]);
  const avg = mPts.map(([d]) => {
    const t = Date.parse(d);
    const win = mPts.filter(([d2]) => { const t2 = Date.parse(d2); return t2 <= t && t2 > t - 7 * 86400000; });
    return [d, win.reduce((a, p) => a + p[1], 0) / win.length];
  });
  const first = mPts[0], lastP = mPts[mPts.length - 1];
  lineChart($("#p-metric-chart"), [{ points: mPts, cls: "l2", dots: true }, { points: avg, cls: "l1" }],
    { caption: mPts.length > 1 ? `Değişim: ${fmt(Math.round((lastP[1] - first[1]) * 10) / 10)} (${first[0]} → ${lastP[0]}) · düz çizgi = 7 günlük ortalama` : "" });

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
      wkKeys.map((wk) => `<tr><td>${wk.slice(5)}</td>${gList.map((g) => `<td>${weeks[wk][g] || "·"}</td>`).join("")}</tr>`).join("") + `</table>`
    : `<p class="hint">Henüz set kaydı yok.</p>`;

  // kcal last 14 days
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const kPts = cache.nutrition.filter((n) => n.date >= cutoff && n.kcal != null).sort((a, b) => a.date.localeCompare(b.date)).map((n) => [n.date, n.kcal]);
  const kAvg = kPts.length ? Math.round(kPts.reduce((a, p) => a + p[1], 0) / kPts.length) : null;
  lineChart($("#p-kcal-chart"), [{ points: kPts, cls: "l1", dots: true }], { caption: kAvg ? `Ortalama: ${kAvg} kcal/gün` : "" });
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
  renderExerciseOptions();
}

// ---------- misc ----------
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

function renderAll() {
  renderExerciseOptions();
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
  for (const id of ["#w-date", "#n-date", "#m-date"]) $(id).value = today();

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#w-date").addEventListener("change", () => { cancelEdit(); renderWorkout(); prefillForm(); });
  $("#w-exercise").addEventListener("change", onExerciseChange);
  $("#w-new-ex").addEventListener("click", newExercise);
  $("#w-add").addEventListener("click", addOrUpdateSet);
  $("#w-cancel").addEventListener("click", cancelEdit);
  $("#w-notes").addEventListener("input", onNotesInput);
  $("#w-list").addEventListener("click", (ev) => {
    const del = ev.target.closest("[data-del]");
    if (del) return deleteSet(del.dataset.del);
    const row = ev.target.closest(".set-row[data-id]");
    if (row) startEdit(row.dataset.id);
  });
  $("#n-date").addEventListener("change", renderNutrition);
  $("#n-save").addEventListener("click", saveNutrition);
  $("#m-date").addEventListener("change", renderMeasure);
  $("#m-save").addEventListener("click", saveMeasure);
  $("#m-new").addEventListener("click", newMetric);
  $("#p-exercise").addEventListener("change", renderProgress);
  $("#p-metric").addEventListener("change", renderProgress);
  $("#s-export").addEventListener("click", exportFile);
  $("#s-restore").addEventListener("change", (e) => { if (e.target.files[0]) restoreFile(e.target.files[0]); e.target.value = ""; });
  $("#sync-badge").addEventListener("click", () => showView("settings"));
  $("#s-exercises").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-edit-ex]");
    if (b) editExercise(b.dataset.editEx);
  });

  renderAll();
  prefillForm();
  updateBadge();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

main();
