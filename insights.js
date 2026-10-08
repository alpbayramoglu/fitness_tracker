"use strict";
// İlerleme extras: last 7 days, weekly streak, goals, phases (cut/bulk), lift history.
// Loaded after app.js and uses its helpers ($, cache, save, remove, fmt, fmtDate, lineChart…).

const DAY = 86400000;
const epley = (kg, reps) => (kg && reps ? kg * (1 + reps / 30) : 0); // without RIR: RIR was not logged before Apr 2026
const pct = (a, b) => (a ? Math.round(((b - a) / a) * 1000) / 10 : null);
const signed = (x, unit = "") => (x == null ? "–" : Math.abs(x) < 0.05 ? `±0${unit}` : `${x > 0 ? "+" : ""}${fmt(x).replace(".", ",")}${unit}`);
const dec = (x) => fmt(Math.round(x * 10) / 10).replace(".", ",");
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const UI = { liftEx: null, goalForm: false, phaseForm: null };

// sessions with the best set by Epley (no RIR), oldest first
function liftSessions(exId) {
  return sessionsAsc(exId).map((s) => {
    const best = s.sets.reduce((b, x) => (epley(x.weight_kg, x.reps) > epley(b?.weight_kg, b?.reps) ? x : b), null);
    return { date: s.date, best, e: Math.round(epley(best?.weight_kg, best?.reps) * 10) / 10 };
  }).filter((s) => s.e);
}
const setTxt = (s) => (s ? `${fmt(s.weight_kg)}×${s.reps}` : "–");
function workoutDates() {
  const wmap = workoutById();
  return [...new Set(cache.sets.map((s) => wmap[s.workout_id]?.date).filter(Boolean))].sort();
}
function metricSeries(mid) {
  return cache.measurements.filter((m) => m.metric_id === mid && m.value != null).sort((a, b) => a.date.localeCompare(b.date)).map((m) => [m.date, m.value]);
}

// ---------- last 7 days + weekly streak ----------
// 7-day slices counted back from today, like the set table: not tied to calendar weeks
function streakInfo(dates, need = 3) {
  const now = Date.parse(today());
  const count = (i) => dates.filter((d) => { const k = Math.floor((now - Date.parse(d)) / (7 * DAY)); return k === i; }).length;
  const cur = count(0);
  let run = 0;
  for (let i = cur >= need ? 0 : 1; i < 520 && count(i) >= need; i++) run++;
  return { run, cur, need };
}
function renderWeek() {
  const box = $("#p-week");
  const from = shiftDate(today(), -6), prevFrom = shiftDate(today(), -13);
  const dates = workoutDates();
  const wk = dates.filter((d) => d >= from);
  const wmap = workoutById();
  const sets = cache.sets.filter((s) => (wmap[s.workout_id]?.date || "") >= from);
  const prs = [...personalRecords().keys()].filter((id) => sets.some((s) => s.id === id)).length;
  const nut = cache.nutrition.filter((n) => n.date >= from);
  const avg = (f, list = nut) => { const v = list.filter((n) => n[f] != null).map((n) => n[f]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const w = metricSeries("metric-weight");
  const wNow = w.filter(([d]) => d >= from).map((p) => p[1]), wPrev = w.filter(([d]) => d >= prevFrom && d < from).map((p) => p[1]);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const kg = w.length ? w[w.length - 1][1] : null;
  const prot = avg("protein_g"), kcal = avg("kcal"), steps = avg("steps");
  const dW = mean(wNow) != null && mean(wPrev) != null ? Math.round((mean(wNow) - mean(wPrev)) * 10) / 10 : null;
  const st = streakInfo(dates);
  const cell = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  const lines = [];
  if (kcal != null) lines.push(`Kalori ort. <b>${Math.round(kcal).toLocaleString("tr-TR")}</b>`);
  if (prot != null) lines.push(`protein <b>${Math.round(prot)} g</b>${kg ? ` (${dec(prot / kg)} g/kg)` : ""}`);
  if (steps != null) lines.push(`adım <b>${Math.round(steps).toLocaleString("tr-TR")}</b>`);
  if (dW != null) lines.push(`kilo ortalaması önceki 7 güne göre <b>${signed(dW, " kg")}</b>`);
  const cw = typeof cardioWeek === "function" ? cardioWeek(from) : null;
  const cardioLine = cw ? `<p class="sum-line">Kardiyo: <b>${cw.n}</b> seans, ${cw.min} dk · haftalık 150 dakika önerisinin <b>%${Math.round((cw.eq / 150) * 100)}</b>'i${cw.kcal ? ` · ≈ ${cw.kcal.toLocaleString("tr-TR")} kcal` : ""}.</p>` : "";
  box.innerHTML = `<div class="stats">${cell(wk.length, "antrenman")}${cell(sets.length, "set")}${cell(prs, "rekor")}${cell(st.run, "haftalık seri")}</div>
    ${lines.length ? `<p class="sum-line">${lines.join(" · ")}.</p>` : ""}
    ${cardioLine}
    <p class="hint">Seri: art arda kaç hafta en az ${st.need} antrenman yaptığın (7 günlük dilimler, bugünden geriye). Bu dilimde ${st.cur}/${st.need}.${st.cur >= st.need ? " Bu haftayı tamamladın." : ""}</p>`;
}

// ---------- goals ----------
const METRIC_DIR = { "metric-waist": -1, "metric-body_fat": -1, "metric-weight": 0 };
function liftTargetE(g) { return epley(g.target, g.reps || 1); }
function goalState(g) {
  if (g.kind === "lift") {
    const ss = liftSessions(g.exercise_id);
    const done = sessionsAsc(g.exercise_id).find((x) => x.sets.some((y) => (y.weight_kg || 0) >= g.target && (y.reps || 0) >= (g.reps || 1)));
    const recent = ss.slice(-3);
    const cur = recent.length ? Math.max(...recent.map((s) => s.e)) : null;
    const tgt = liftTargetE(g);
    const prog = g.start != null && cur != null && tgt > g.start ? (cur - g.start) / (tgt - g.start) : cur && cur >= tgt ? 1 : 0;
    const last8 = ss.slice(-8).map((s) => [s.date, s.e]);
    const slope = slopePerDay(last8);
    const eta = !done && slope > 0 && cur < tgt ? Math.ceil((tgt - cur) / slope / 7) : null;
    const name = cache.exercises.find((e) => e.id === g.exercise_id)?.name || "?";
    return { title: `${name} ${fmt(g.target)} kg × ${g.reps}`, now: recent.length ? `en iyi son: ${setTxt(recent.reduce((b, s) => (s.e > b.e ? s : b)).best)}` : "henüz kayıt yok",
      prog, done: done?.date, eta };
  }
  const ser = metricSeries(g.metric_id);
  const m = cache.metrics.find((x) => x.id === g.metric_id);
  const cur = ser.length ? ser[ser.length - 1][1] : null;
  const dir = g.target < (g.start ?? cur) ? -1 : 1;
  const prog = g.start != null && cur != null && g.target !== g.start ? (cur - g.start) / (g.target - g.start) : 0;
  const done = ser.find(([d, v]) => d >= localDate(g.created_at || 0) && (dir < 0 ? v <= g.target : v >= g.target));
  const recent = ser.filter(([d]) => d >= shiftDate(today(), -28));
  const slope = slopePerDay(recent);
  const eta = !done && slope && Math.sign(slope) === dir ? Math.ceil((g.target - cur) / slope / 7) : null;
  return { title: `${m?.name || "?"} ${dec(g.target)} ${m?.unit || ""}`, now: cur != null ? `şimdi ${dec(cur)} ${m?.unit || ""} · başlangıç ${dec(g.start)}` : "henüz ölçüm yok",
    prog, done: done?.[0], eta };
}
function renderGoals() {
  const box = $("#p-goals");
  const goals = [...cache.goals].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  const rows = goals.map((g) => {
    const s = goalState(g);
    const p = Math.max(0, Math.min(1, s.prog));
    const tail = s.done ? `<span class="goal-done">✓ ${fmtDate(s.done)}</span>` : s.eta ? `bu hızla ~${s.eta} hafta` : "gidişat henüz belli değil";
    return `<div class="goal"><div class="goal-top"><b>${esc(s.title)}</b><button type="button" class="icon-btn" data-goal-del="${esc(g.id)}" aria-label="Hedefi sil">✕</button></div>
      <div class="bar"><i class="${s.done ? "ok" : p >= 0.5 ? "ok" : "low"}" style-w="${Math.round((s.done ? 1 : p) * 100)}"></i></div>
      <div class="goal-meta"><span>${esc(s.now)}</span><span>${tail}</span></div></div>`;
  }).join("");
  const metricOpts = [...cache.metrics].sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99)).map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.unit)})</option>`).join("");
  const exIds = [...new Set(cache.sets.map((s) => s.exercise_id))];
  const exOpts = cache.exercises.filter((e) => exIds.includes(e.id)).sort(byName).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("");
  const form = UI.goalForm ? `<div class="goal-form">
      <div class="seg small" id="g-kind"><button type="button" data-gk="metric" class="${UI.goalForm === "metric" ? "active" : ""}">Ölçü</button><button type="button" data-gk="lift" class="${UI.goalForm === "lift" ? "active" : ""}">Hareket</button></div>
      ${UI.goalForm === "metric"
        ? `<label>Ölçü<select id="g-metric">${metricOpts}</select></label><label>Hedef değer<input type="number" inputmode="decimal" step="0.1" id="g-target"></label>`
        : `<label>Hareket<select id="g-ex">${exOpts}</select></label><div class="row"><label>kg<input type="number" inputmode="decimal" step="0.5" id="g-target"></label><label>Tekrar<input type="number" inputmode="numeric" id="g-reps" value="6"></label></div>`}
      <div class="row"><button type="button" class="primary grow" data-goal-save>Hedefi kaydet</button><button type="button" class="ghost" data-goal-cancel>Vazgeç</button></div></div>` : "";
  box.innerHTML = (rows || (UI.goalForm ? "" : `<p class="hint">Henüz hedef yok. Örnek: bel 82 cm, bench 75 kg × 6, yağ oranı %12.</p>`)) + form +
    (UI.goalForm ? "" : `<button type="button" class="wide ghost" data-goal-new>+ Hedef ekle</button>`);
  box.querySelectorAll("[style-w]").forEach((el) => { el.style.width = el.getAttribute("style-w") + "%"; });
}
async function saveGoal() {
  const target = num($("#g-target").value);
  if (target == null) return toast("Hedef değeri gir");
  let g;
  if (UI.goalForm === "metric") {
    const mid = $("#g-metric").value, ser = metricSeries(mid);
    g = { kind: "metric", metric_id: mid, target, start: ser.length ? ser[ser.length - 1][1] : null };
  } else {
    const ex = $("#g-ex").value, reps = num($("#g-reps").value) || 1, ss = liftSessions(ex).slice(-3);
    g = { kind: "lift", exercise_id: ex, target, reps, start: ss.length ? Math.max(...ss.map((s) => s.e)) : null };
  }
  await save("goals", { id: uid(), ...g, created_at: Date.now() });
  UI.goalForm = false;
  renderGoals();
}

// ---------- phases ----------
const PHASE_KIND = { cut: "Cut", bulk: "Bulk", maintain: "Koruma" };
function phaseStats(ph) {
  const from = ph.start, to = ph.end || today();
  const span = Math.max(1, daysBetween(from, to) + 1), weeks = span / 7;
  const pick = (mid) => metricSeries(mid).filter(([d]) => d >= from && d <= to);
  const w = pick("metric-weight"), waist = pick("metric-waist"), bf = pick("metric-body_fat");
  const se = (ser) => (ser.length >= 2 ? [ser[0][1], ser[ser.length - 1][1]] : null);
  const near = (d) => { let best = null; for (const [bd, v] of bf) { const g = Math.abs(daysBetween(bd, d)); if (g <= 3 && (!best || g < best[0])) best = [g, v]; } return best?.[1]; };
  const lean = w.map(([d, kg]) => { const b = near(d); return b == null ? null : [d, kg * (1 - b / 100)]; }).filter(Boolean);
  const kc = cache.nutrition.filter((n) => n.kcal != null && n.date >= from && n.date <= to).map((n) => n.kcal);
  const dates = workoutDates().filter((d) => d >= from && d <= to);
  // strength: first two vs last two sessions of the exercises trained most in the phase
  const counts = {};
  const wmap = workoutById();
  for (const s of cache.sets) { const d = wmap[s.workout_id]?.date; if (d && d >= from && d <= to) (counts[s.exercise_id] ||= new Set()).add(d); }
  const lifts = Object.entries(counts).filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size).slice(0, 5).map(([id]) => {
    const ss = liftSessions(id).filter((s) => s.date >= from && s.date <= to);
    const a = (ss[0].e + ss[1].e) / 2, b = (ss[ss.length - 1].e + ss[ss.length - 2].e) / 2;
    return { name: cache.exercises.find((e) => e.id === id)?.name || "?", first: ss[0].best, last: ss[ss.length - 1].best, change: pct(a, b) };
  });
  return { span, weeks, w: se(w), waist: se(waist), bf: se(bf), lean: se(lean), kcal: kc.length ? Math.round(kc.reduce((a, b) => a + b, 0) / kc.length) : null, kcalDays: kc.length,
    perWeek: dates.length / weeks, slope: slopePerDay(w), lifts };
}
function renderPhases() {
  const box = $("#p-phases");
  const list = [...cache.phases].sort((a, b) => b.start.localeCompare(a.start));
  const card = (ph) => {
    const s = phaseStats(ph);
    const row = (label, pair, unit, digits = 1) => pair ? `<div class="ph-row"><span>${label}</span><span>${dec(pair[0])} → <b>${dec(pair[1])}</b> ${unit} <em class="delta">${signed(Math.round((pair[1] - pair[0]) * 10) / 10)}</em></span></div>` : "";
    const rate = s.slope != null && s.w ? `${signed(Math.round(s.slope * 7 * 100) / 100, " kg")}/hf (${signed(Math.round((s.slope * 7 / s.w[0]) * 1000) / 10, "%")})` : "";
    return `<div class="phase ${esc(ph.kind)}"><div class="ph-head"><span class="ph-kind">${PHASE_KIND[ph.kind] || ""}</span><b>${esc(ph.name)}</b>
        <button type="button" class="link-btn" data-phase-edit="${esc(ph.id)}">Düzenle</button></div>
      <p class="hint">${fmtDate(ph.start)} – ${ph.end ? fmtDate(ph.end) : "devam ediyor"} · ${Math.round(s.weeks)} hafta · haftada ${dec(s.perWeek)} antrenman</p>
      ${row("Kilo", s.w, "kg")}${rate ? `<div class="ph-row"><span>Hız</span><span>${rate}</span></div>` : ""}
      ${row("Bel", s.waist, "cm")}${row("Yağ oranı", s.bf, "%")}${row("Yağsız kütle", s.lean, "kg")}
      ${s.kcal ? `<div class="ph-row"><span>Kalori ort.</span><span><b>${s.kcal.toLocaleString("tr-TR")}</b> (${s.kcalDays} gün)</span></div>` : ""}
      ${s.lifts.length ? `<div class="ph-lifts">${s.lifts.map((l) => `<div class="ph-row"><span>${esc(l.name)}</span><span>${setTxt(l.first)} → ${setTxt(l.last)} <em class="${l.change < -2 ? "down" : l.change > 2 ? "up" : "delta"}">${signed(l.change, "%")}</em></span></div>`).join("")}</div>` : ""}
    </div>`;
  };
  const f = UI.phaseForm;
  const form = f ? `<div class="goal-form">
      <div class="seg small">${Object.entries(PHASE_KIND).map(([k, l]) => `<button type="button" data-pk="${k}" class="${f.kind === k ? "active" : ""}">${l}</button>`).join("")}</div>
      <label>Ad<input type="text" id="ph-name" value="${esc(f.name || "")}" placeholder="ör. Cut-2, Kış bulk'u"></label>
      <div class="row"><label>Başlangıç<input type="date" id="ph-start" value="${esc(f.start || today())}"></label><label>Bitiş<input type="date" id="ph-end" value="${esc(f.end || "")}"></label></div>
      <p class="hint">Bitiş boşsa dönem devam ediyor sayılır.</p>
      <div class="row"><button type="button" class="primary grow" data-phase-save>Kaydet</button><button type="button" class="ghost" data-phase-cancel>Vazgeç</button>
      ${f.id ? `<button type="button" class="ghost danger-text" data-phase-del>Sil</button>` : ""}</div></div>` : "";
  box.innerHTML = (list.length ? list.map(card).join("") : f ? "" : `<p class="hint">Cut, bulk ya da koruma dönemlerini işaretle; her dönemin kilo, bel, yağ oranı ve güç değişimini burada görürsün.</p>`) +
    form + (f ? "" : `<button type="button" class="wide ghost" data-phase-new>+ Dönem ekle</button>`);
  if (f) box.querySelector(".goal-form").scrollIntoView({ block: "nearest" });
}
async function savePhase() {
  const f = UI.phaseForm;
  const name = $("#ph-name").value.trim() || PHASE_KIND[f.kind];
  const start = $("#ph-start").value, end = $("#ph-end").value || null;
  if (!start) return toast("Başlangıç tarihi gir");
  if (end && end < start) return toast("Bitiş başlangıçtan önce olamaz");
  await save("phases", { ...(cache.phases.find((p) => p.id === f.id) || {}), id: f.id || uid(), name, kind: f.kind, start, end });
  UI.phaseForm = null;
  renderPhases(); renderLift();
}

// ---------- lift history ----------
function renderLift() {
  const box = $("#p-lift");
  const counts = {};
  const wmap = workoutById();
  for (const s of cache.sets) { const d = wmap[s.workout_id]?.date; if (d) (counts[s.exercise_id] ||= new Set()).add(d); }
  const list = cache.exercises.filter((e) => counts[e.id]?.size >= 2).sort(byName);
  if (!list.length) { box.innerHTML = `<p class="hint">En az iki seansı olan bir hareket gerekiyor.</p>`; return; }
  if (!UI.liftEx || !counts[UI.liftEx]) UI.liftEx = Object.entries(counts).sort((a, b) => b[1].size - a[1].size)[0][0];
  const [rFrom, rTo] = crDates("lift", "0");
  const ss = liftSessions(UI.liftEx).filter((x) => x.date >= rFrom && x.date <= rTo);
  const pick = `<label class="lift-pick">Hareket<select id="lift-ex">${list.map((e) => `<option value="${esc(e.id)}" ${e.id === UI.liftEx ? "selected" : ""}>${esc(e.name)} (${counts[e.id].size})</option>`).join("")}</select></label>${crPicker("lift", "0")}`;
  if (ss.length < 2) { box.innerHTML = pick + `<p class="hint">Bu aralıkta bu hareketin en az iki seansı yok. Aralığı genişlet.</p>`; return; }
  const notes = cache.exercise_notes.filter((n) => n.exercise_id === UI.liftEx && n.notes && n.date >= rFrom && n.date <= rTo);
  const noted = new Set(notes.map((n) => n.date));
  const heaviest = ss.reduce((b, s) => ((s.best?.weight_kg || 0) > (b.best?.weight_kg || 0) ? s : b), ss[0]);
  const bestE = ss.reduce((b, s) => (s.e > b.e ? s : b), ss[0]);
  box.innerHTML = pick + `<div class="chart" id="lift-chart"></div>
    <div class="ph-row"><span>İlk seans</span><span>${fmtDate(ss[0].date)} · ${setTxt(ss[0].best)}</span></div>
    <div class="ph-row"><span>Son seans</span><span>${fmtDate(ss[ss.length - 1].date)} · ${setTxt(ss[ss.length - 1].best)}</span></div>
    <div class="ph-row"><span>En ağır</span><span>${fmt(heaviest.best.weight_kg)} kg × ${heaviest.best.reps} · ${fmtDate(heaviest.date)}</span></div>
    <div class="ph-row"><span>En iyi set (tahmini 1RM)</span><span>${setTxt(bestE.best)} ≈ ${dec(bestE.e)} kg · ${fmtDate(bestE.date)}</span></div>
    ${notes.length ? `<div class="lift-notes"><b>Notlu seanslar</b>${notes.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((n) => `<div class="hint">${fmtDate(n.date)} · ${esc(n.notes.split("\n")[0])}</div>`).join("")}</div>` : ""}`;
  const bands = cache.phases.map((p) => ({ from: p.start, to: p.end || today(), cls: p.kind }));
  lineChart($("#lift-chart"), [{ points: ss.map((s) => [s.date, s.e]), cls: "c0", label: "En iyi set (tahmini 1RM, kg)", dots: true, marks: noted }],
    { from: ss[0].date, to: rTo, bands, legend: true, h: 180,
      caption: `Her nokta bir seansın en iyi seti. ${bands.length ? "Arka plan: cut (turuncu), bulk (yeşil), koruma (gri). " : ""}${noted.size ? "Büyük noktalar notlu seans (ör. farklı makine)." : ""}` });
}

// ---------- wiring ----------
function renderInsights() {
  renderWeek(); renderGoals(); renderPhases(); renderLift();
}
$("#view-progress").addEventListener("click", async (ev) => {
  const el = ev.target.closest("button");
  if (!el) return;
  const d = el.dataset;
  if (d.goalNew !== undefined) { UI.goalForm = "metric"; return renderGoals(); }
  if (d.gk) { UI.goalForm = d.gk; return renderGoals(); }
  if (d.goalCancel !== undefined) { UI.goalForm = false; return renderGoals(); }
  if (d.goalSave !== undefined) return saveGoal();
  if (d.goalDel) { if (confirm("Hedef silinsin mi?")) { await remove("goals", d.goalDel); renderGoals(); } return; }
  if (d.phaseNew !== undefined) { UI.phaseForm = { kind: "cut" }; return renderPhases(); }
  if (d.phaseEdit) { UI.phaseForm = { ...cache.phases.find((p) => p.id === d.phaseEdit) }; return renderPhases(); }
  if (d.pk) { UI.phaseForm = { ...UI.phaseForm, kind: d.pk, name: $("#ph-name").value, start: $("#ph-start").value, end: $("#ph-end").value }; return renderPhases(); }
  if (d.phaseCancel !== undefined) { UI.phaseForm = null; return renderPhases(); }
  if (d.phaseSave !== undefined) return savePhase();
  if (d.phaseDel !== undefined) { if (confirm("Dönem silinsin mi? Kayıtların silinmez.")) { await remove("phases", UI.phaseForm.id); UI.phaseForm = null; renderPhases(); renderLift(); } return; }
});
$("#view-progress").addEventListener("change", (ev) => {
  if (ev.target.id === "lift-ex") { UI.liftEx = ev.target.value; renderLift(); }
});
