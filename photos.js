"use strict";
// Progress photos: kept only on this phone (IndexedDB "photos" store), never in exports.
// Loaded after app.js; uses its helpers ($, tx, getAll, putRaw, uid, fmtDate, toast, esc).

const POSES = [["front", "Ön"], ["side", "Yan"], ["back", "Arka"]];
const PH = { pose: "front", a: null, b: null, picked: false, urls: [], view: null };

async function shrinkImage(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((res) => c.toBlob((b) => res({ blob: b, w: c.width, h: c.height }), "image/jpeg", 0.85));
}
async function addPhotos(files) {
  const date = $("#m-date").value || today();
  let n = 0;
  for (const f of files) {
    try {
      const { blob, w, h } = await shrinkImage(f);
      await putRaw("photos", { id: uid(), date, pose: PH.pose, blob, w, h, created_at: Date.now() });
      n++;
    } catch { toast("Bir fotoğraf okunamadı"); }
  }
  if (n) toast(`${n} fotoğraf eklendi · ${fmtDate(date)}`);
  renderPhotos();
}
const urlFor = (p) => { const u = URL.createObjectURL(p.blob); PH.urls.push(u); return u; };

async function renderPhotos() {
  const root = $("#ph-root");
  if (!root) return;
  PH.urls.forEach((u) => URL.revokeObjectURL(u)); PH.urls = [];
  const all = (await getAll("photos")).sort((x, y) => x.date.localeCompare(y.date) || x.created_at - y.created_at);
  const poseList = all.filter((p) => p.pose === PH.pose);
  const dates = [...new Set(poseList.map((p) => p.date))];
  // by default compare the first and the latest date; keep the user's own picks while they are valid
  if (!PH.picked || !dates.includes(PH.a) || !dates.includes(PH.b)) { PH.a = dates[0] || null; PH.b = dates[dates.length - 1] || null; PH.picked = false; }
  const pick = (d) => poseList.filter((p) => p.date === d).pop();
  const opt = (sel) => dates.map((d) => `<option value="${d}" ${d === sel ? "selected" : ""}>${fmtDate(d)}</option>`).join("");
  const side = (d, label) => { const p = d && pick(d); return `<figure>${p ? `<img src="${urlFor(p)}" alt="${label}" data-ph-open="${esc(p.id)}">` : `<div class="ph-empty">Fotoğraf yok</div>`}<figcaption><select data-ph-side="${label}">${opt(d)}</select></figcaption></figure>`; };
  const byDate = {};
  for (const p of all) (byDate[p.date] ||= []).push(p);
  const poseName = Object.fromEntries(POSES);
  root.innerHTML = `
    <div class="seg small">${POSES.map(([k, l]) => `<button type="button" data-ph-pose="${k}" class="${PH.pose === k ? "active" : ""}">${l}</button>`).join("")}</div>
    ${dates.length >= 2 ? `<div class="ph-compare">${side(PH.a, "a")}${side(PH.b, "b")}</div>` : dates.length === 1 ? `<p class="hint">Karşılaştırma için bu pozda ikinci bir tarih gerekiyor.</p>` : ""}
    <label class="wide ghost ph-add">+ ${poseName[PH.pose]} fotoğraf ekle (${fmtDate($("#m-date").value || today())})<input type="file" accept="image/*" multiple id="ph-file" hidden></label>
    ${Object.keys(byDate).sort().reverse().map((d) => `<div class="ph-day"><div class="hint">${fmtDate(d)}</div><div class="ph-thumbs">${byDate[d].map((p) =>
      `<img src="${urlFor(p)}" alt="${poseName[p.pose] || ""}" data-ph-open="${esc(p.id)}"><span class="ph-tag">${poseName[p.pose] || ""}</span>`).join("")}</div></div>`).join("")}
    <p class="hint spaced">Fotoğraflar sadece bu telefonda, uygulamanın içinde durur; dışa aktarılan yedeğe girmez. Uygulamayı ana ekrandan silersen onlar da silinir, bu yüzden telefonun Fotoğraflar'ında da sakla. Tarih: Ölçüler'de seçili gün. Hep aynı ışık, aynı poz ve aynı saatte çekmek karşılaştırmayı kolaylaştırır.</p>
    ${PH.view ? `<div class="ph-viewer" data-ph-close><img src="${urlFor(all.find((p) => p.id === PH.view) || { blob: new Blob() })}" alt="">
      <div class="row"><button type="button" class="ghost danger-text" data-ph-del="${esc(PH.view)}">Sil</button><button type="button" class="primary grow" data-ph-close>Kapat</button></div></div>` : ""}`;
}

const phRoot = $("#ph-root");
phRoot.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-ph-pose],[data-ph-open],[data-ph-del],[data-ph-close]");
  if (!el) return;
  const d = el.dataset;
  if (d.phPose) { PH.pose = d.phPose; PH.picked = false; return renderPhotos(); }
  if (d.phOpen) { PH.view = d.phOpen; return renderPhotos(); }
  if (d.phDel) {
    if (!confirm("Fotoğraf silinsin mi? Geri alınamaz.")) return;
    await tx("photos", "readwrite", (s) => s.delete(d.phDel));
    PH.view = null; return renderPhotos();
  }
  if (d.phClose !== undefined && (ev.target === el || el.tagName === "BUTTON")) { PH.view = null; return renderPhotos(); }
});
phRoot.addEventListener("change", (ev) => {
  if (ev.target.id === "ph-file" && ev.target.files.length) { addPhotos([...ev.target.files]); ev.target.value = ""; }
  if (ev.target.dataset.phSide) { PH[ev.target.dataset.phSide] = ev.target.value; PH.picked = true; renderPhotos(); }
});
// refresh when the Ölçüler date changes (the add button shows that date)
document.addEventListener("change", (ev) => { if (ev.target.id === "m-date") renderPhotos(); });
