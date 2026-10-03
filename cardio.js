"use strict";
// Cardio: run, walk, bike, swim. Entered by hand after the session (no GPS in a web app).
// Loaded after app.js; the Antrenman screen calls cardioTiles() and renderCardio().

const CARDIO = {
  run: { name: "Koşu", icon: "🏃", unit: "km", pace: "km" },
  walk: { name: "Yürüyüş", icon: "🚶", unit: "km", pace: "km", incline: true },
  bike: { name: "Bisiklet", icon: "🚴", unit: "km", speed: true },
  swim: { name: "Yüzme", icon: "🏊", unit: "m", pace: "100m" },
};
const C = { kind: null, edit: null };

// ---------- energy estimate ----------
// MET by speed from the Compendium of Physical Activities (Ainsworth 2011, 2024 update by Herrmann), interpolated.
const MET_TABLE = {
  run: [[6.4, 6.0], [8.0, 8.3], [9.7, 9.8], [11.3, 11.0], [12.9, 11.8], [14.5, 12.8], [16.1, 14.5]],   // km/h → MET
  walk: [[3.2, 2.8], [4.0, 3.0], [4.8, 3.5], [5.6, 4.3], [6.4, 5.0], [7.2, 7.0]],
  bike: [[12, 4.0], [17.5, 6.8], [21, 8.0], [24, 10.0], [28, 12.0], [32, 15.8]],
  swim: [[30, 5.8], [46, 8.3], [61, 10.0]],                                                          // m/min → MET
};
function interp(tbl, x) {
  if (x <= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) if (x <= tbl[i][0]) { const [a, ma] = tbl[i - 1], [b, mb] = tbl[i]; return ma + ((x - a) / (b - a)) * (mb - ma); }
  return tbl[tbl.length - 1][1];
}
function cardioMet(c) {
  if (!c.duration_s || !c.distance) return null;
  if (c.kind === "swim") return interp(MET_TABLE.swim, c.distance / (c.duration_s / 60));
  const kmh = c.distance / (c.duration_s / 3600);
  let met = interp(MET_TABLE[c.kind], kmh);
  if (c.kind === "walk" && c.incline) met += c.incline >= 6 ? 3 : 1.5; // uphill walking costs more (Compendium: graded walking)
  return met;
}
// resting kcal per hour for this person: Katch-McArdle with body fat, else Mifflin-St Jeor, else 1 kcal/kg/h
function restingPerHour() {
  const last = (mid) => cache.measurements.filter((m) => m.metric_id === mid && m.value != null).sort((a, b) => b.date.localeCompare(a.date))[0]?.value;
  const w = last("metric-weight"), bf = last("metric-body_fat");
  if (!w) return null;
  const pr = profile();
  const age = pr.birth_year ? new Date().getFullYear() - pr.birth_year : null;
  let bmr = null;
  if (bf != null && bf > 2 && bf < 60) bmr = 370 + 21.6 * w * (1 - bf / 100);
  else if (pr.height_cm && age && pr.sex) bmr = 10 * w + 6.25 * pr.height_cm - 5 * age + (pr.sex === "m" ? 5 : -161);
  return bmr ? bmr / 24 : w; // the textbook MET assumes 1 kcal/kg/h
}
// active calories: (MET − 1) × own resting rate × hours, so resting burn is not counted twice
function cardioKcal(c) {
  const met = cardioMet(c), rh = restingPerHour();
  return met && rh ? Math.round((met - 1) * rh * (c.duration_s / 3600)) : null;
}

// ---------- formatting ----------
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const hms = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} sa ${Math.round((s % 3600) / 60)} dk` : `${Math.round(s / 60)} dk`);
function paceText(c) {
  if (!c.duration_s || !c.distance) return "";
  const k = CARDIO[c.kind];
  if (k.speed) return `${fmt(Math.round((c.distance / (c.duration_s / 3600)) * 10) / 10).replace(".", ",")} km/sa`;
  if (k.pace === "100m") return `${mmss(c.duration_s / (c.distance / 100))} /100 m`;
  return `${mmss(c.duration_s / c.distance)} /km`;
}
const distText = (c) => (c.distance == null ? "" : c.kind === "swim" ? `${Math.round(c.distance)} m` : `${fmt(Math.round(c.distance * 100) / 100).replace(".", ",")} km`);
const cardioList = (kind) => cache.cardio.filter((c) => !kind || c.kind === kind).sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || 0) - (a.created_at || 0));
// guideline minutes: vigorous (MET ≥ 6) count double toward 150 moderate minutes (Bull 2020)
function cardioWeek(fromDate) {
  const list = cache.cardio.filter((c) => c.date >= fromDate);
  let min = 0, eq = 0, kcal = 0;
  for (const c of list) { const m = c.duration_s / 60, met = cardioMet(c); min += m; eq += met && met >= 6 ? m * 2 : m; kcal += cardioKcal(c) || 0; }
  return { n: list.length, min: Math.round(min), eq: Math.round(eq), kcal: Math.round(kcal) };
}

// ---------- tiles on the program list ----------
function cardioTiles() {
  const from = shiftDate(today(), -6);
  return `<div class="cardio-head">Kardiyo</div><div class="cardio-tiles">${Object.entries(CARDIO).map(([k, v]) => {
    const wk = cache.cardio.filter((c) => c.kind === k && c.date >= from);
    const last = cardioList(k)[0];
    const dist = wk.reduce((a, c) => a + (c.distance || 0), 0);
    return `<button type="button" class="cardio-tile" data-cact="open" data-kind="${k}"><span class="ct-icon">${v.icon}</span><b>${v.name}</b>
      <span class="meta">${wk.length ? `7 gün: ${k === "swim" ? Math.round(dist) + " m" : fmt(Math.round(dist * 10) / 10).replace(".", ",") + " km"}` : last ? `son: ${fmtDate(last.date)}` : "kayıt yok"}</span></button>`;
  }).join("")}</div>`;
}

// ---------- cardio screen ----------
function renderCardio() {
  const k = CARDIO[C.kind];
  const e = C.edit ? cache.cardio.find((c) => c.id === C.edit) : null;
  const v = (x) => (x == null ? "" : x);
  const list = cardioList(C.kind);
  const from = shiftDate(today(), -6);
  const wk = list.filter((c) => c.date >= from);
  const wkMin = Math.round(wk.reduce((a, c) => a + c.duration_s / 60, 0));
  const wkDist = wk.reduce((a, c) => a + (c.distance || 0), 0);
  // records
  const timed = list.filter((c) => c.duration_s && c.distance && (C.kind === "swim" ? c.distance >= 100 : c.distance >= 1));
  const longest = list.reduce((b, c) => ((c.distance || 0) > (b?.distance || 0) ? c : b), null);
  const fastest = timed.reduce((b, c) => (!b || c.distance / c.duration_s > b.distance / b.duration_s ? c : b), null);
  const form = `<div class="card">
    ${dateNav("w")}
    <div class="row three cardio-form">
      <label>Süre (dk)<input type="number" id="c-min" inputmode="numeric" min="0" value="${e ? Math.floor(e.duration_s / 60) : ""}"></label>
      <label>sn<input type="number" id="c-sec" inputmode="numeric" min="0" max="59" value="${e ? Math.round(e.duration_s % 60) || "" : ""}"></label>
      <label>Mesafe (${k.unit})<input type="number" id="c-dist" inputmode="decimal" step="${C.kind === "swim" ? 25 : 0.01}" min="0" value="${v(e?.distance)}"></label>
    </div>
    <div class="row three cardio-form">
      ${k.incline ? `<label>Eğim (%)<input type="number" id="c-incline" inputmode="decimal" min="0" value="${v(e?.incline)}"></label>` : ""}
      <label>Zorluk (1–10)<input type="number" id="c-rpe" inputmode="numeric" min="1" max="10" value="${v(e?.rpe)}"></label>
      <label>Ort. nabız<input type="number" id="c-hr" inputmode="numeric" min="30" max="230" value="${v(e?.hr)}"></label>
    </div>
    <label>Not<input type="text" id="c-note" value="${esc(e?.notes || "")}" placeholder="ör. koşu bandı, rüzgârlı, havuz 25 m"></label>
    <p class="hint" id="c-live"></p>
    <div class="row"><button type="button" class="primary grow" data-cact="save">${e ? "Güncelle" : "Kaydet"}</button>${e ? `<button type="button" class="ghost" data-cact="cancel">Vazgeç</button>` : ""}</div>
  </div>`;
  const stats = `<div class="card"><h2>Özet</h2>
    <div class="ph-row"><span>Son 7 gün</span><span><b>${wk.length}</b> seans · ${C.kind === "swim" ? Math.round(wkDist) + " m" : fmt(Math.round(wkDist * 10) / 10).replace(".", ",") + " km"} · ${wkMin} dk</span></div>
    ${fastest ? `<div class="ph-row"><span>${k.speed ? "En yüksek hız" : "En hızlı tempo"}</span><span>${paceText(fastest)} · ${distText(fastest)} · ${fmtDate(fastest.date)}</span></div>` : ""}
    ${longest?.distance ? `<div class="ph-row"><span>En uzun</span><span>${distText(longest)} · ${hms(longest.duration_s)} · ${fmtDate(longest.date)}</span></div>` : ""}
    <div class="chart" id="c-chart"></div></div>`;
  const hist = list.length ? `<div class="card"><h2>Geçmiş</h2>${list.slice(0, 40).map((c) => {
    const kc = cardioKcal(c);
    return `<div class="set-row" data-cact="edit" data-id="${esc(c.id)}"><span class="set-main"><span>${fmtDate(c.date)} · <b>${distText(c)}</b> · ${hms(c.duration_s)}
      <br><span class="meta">${[paceText(c), kc ? `≈ ${kc} kcal` : "", c.rpe ? `zorluk ${c.rpe}` : "", c.hr ? `${c.hr} nabız` : "", c.incline ? `%${fmt(c.incline)} eğim` : "", c.notes ? esc(c.notes) : ""].filter(Boolean).join(" · ")}</span></span></span>
      <button type="button" class="icon-btn" data-cact="del" data-id="${esc(c.id)}" aria-label="Sil">✕</button></div>`;
  }).join("")}<p class="hint spaced">Kalori: aktivite ve hızın Compendium of Physical Activities değeri, kilon ve yağ oranından hesaplanan dinlenme harcamanla tahmin edilir; dinlenme harcaması düşülür. Kişi bazında ±%20–30 sapabilir, kalori hedefine eklenmez (koruma kalorisi zaten gerçek kilo değişiminden hesaplanıyor).</p></div>` : "";
  return form + stats + hist;
}
function drawCardioChart() {
  const el = $("#c-chart");
  if (!el) return;
  const k = CARDIO[C.kind];
  const pts = cardioList(C.kind).filter((c) => c.duration_s && c.distance).reverse().map((c) => [c.date,
    k.speed ? Math.round((c.distance / (c.duration_s / 3600)) * 10) / 10 : k.pace === "100m" ? Math.round((c.duration_s / (c.distance / 100) / 60) * 100) / 100 : Math.round((c.duration_s / c.distance / 60) * 100) / 100]);
  if (pts.length < 2) { el.innerHTML = ""; return; }
  lineChart(el, [{ points: pts, cls: "c0", dots: true, label: k.speed ? "Hız (km/sa)" : k.pace === "100m" ? "Tempo (dk / 100 m)" : "Tempo (dk / km)" }],
    { from: pts[0][0], to: today(), legend: true, h: 160, caption: k.speed ? "Yukarı = daha hızlı." : "Aşağı = daha hızlı." });
}
function readCardioForm() {
  const n = (id) => num($("#" + id)?.value);
  const dur = (n("c-min") || 0) * 60 + (n("c-sec") || 0);
  return { kind: C.kind, duration_s: dur || null, distance: n("c-dist"), incline: n("c-incline"), rpe: n("c-rpe"), hr: n("c-hr"), notes: $("#c-note").value.trim() };
}
function renderCardioLive() {
  const el = $("#c-live");
  if (!el) return;
  const c = readCardioForm();
  if (!c.duration_s || !c.distance) { el.textContent = ""; return; }
  const kc = cardioKcal(c);
  el.textContent = `${paceText(c)}${kc ? ` · ≈ ${kc} kcal (tahmini)` : ""}`;
}
async function saveCardio() {
  const c = readCardioForm();
  if (!c.duration_s) return toast("Süreyi gir");
  if (c.rpe != null && (c.rpe < 1 || c.rpe > 10)) return toast("Zorluk 1 ile 10 arasında olmalı");
  const old = C.edit ? cache.cardio.find((x) => x.id === C.edit) : null;
  await save("cardio", { ...(old || {}), ...c, id: old?.id || uid(), date: old ? (W.date || old.date) : W.date, created_at: old?.created_at || Date.now() });
  toast(C.edit ? "Güncellendi" : `${CARDIO[C.kind].name} kaydedildi`);
  C.edit = null;
  renderWorkout();
}
function afterCardioRender() { drawCardioChart(); renderCardioLive(); }

$("#w-root").addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-cact]");
  if (!el) return;
  const a = el.dataset.cact;
  if (a === "open") { C.kind = el.dataset.kind; C.edit = null; W.date = today(); return go("cardio"); }
  if (a === "save") return saveCardio();
  if (a === "cancel") { C.edit = null; return renderWorkout(); }
  if (a === "del") { ev.stopPropagation(); if (confirm("Bu kayıt silinsin mi?")) { await remove("cardio", el.dataset.id); if (C.edit === el.dataset.id) C.edit = null; renderWorkout(); } return; }
  if (a === "edit") { const c = cache.cardio.find((x) => x.id === el.dataset.id); if (c) { C.edit = c.id; W.date = c.date; renderWorkout(); window.scrollTo({ top: 0, behavior: "smooth" }); } }
});
$("#w-root").addEventListener("input", (ev) => { if (ev.target.closest(".cardio-form") || ev.target.id === "c-note") renderCardioLive(); });

// ---------- badges (appended to the badge grid) ----------
function cardioBadges() {
  const all = [...cache.cardio].sort((a, b) => a.date.localeCompare(b.date));
  const run5 = all.find((c) => c.kind === "run" && c.distance >= 5);
  const bestRun = Math.max(0, ...all.filter((c) => c.kind === "run").map((c) => c.distance || 0));
  // first day on which the trailing 7 days reached 150 guideline minutes / trailing 30 days reached 50 km (no swim)
  let week150 = null, month50 = null, bestEq = 0, bestKm = 0;
  for (const c of all) {
    const w7 = all.filter((x) => x.date <= c.date && x.date > shiftDate(c.date, -7));
    const eq = w7.reduce((a, x) => { const m = x.duration_s / 60, met = cardioMet(x); return a + (met && met >= 6 ? 2 * m : m); }, 0);
    bestEq = Math.max(bestEq, eq); if (!week150 && eq >= 150) week150 = c.date;
    const km = all.filter((x) => x.kind !== "swim" && x.date <= c.date && x.date > shiftDate(c.date, -30)).reduce((a, x) => a + (x.distance || 0), 0);
    bestKm = Math.max(bestKm, km); if (!month50 && km >= 50) month50 = c.date;
  }
  return [
    { e: "🏃", n: "İlk 5 km", d: "Tek seferde 5 km koş.", date: run5?.date || null, progress: `${fmt(Math.round(Math.min(bestRun, 5) * 10) / 10)}/5 km` },
    { e: "❤️", n: "150 Dakika", d: "7 gün içinde 150 dakika kardiyo (yüksek tempolu dakikalar 2 sayılır).", date: week150, progress: `${Math.round(Math.min(bestEq, 150))}/150 dk` },
    { e: "🛣️", n: "Ayda 50 km", d: "30 gün içinde yürüyüş, koşu ve bisikletle toplam 50 km.", date: month50, progress: `${Math.round(Math.min(bestKm, 50))}/50 km` },
  ];
}
