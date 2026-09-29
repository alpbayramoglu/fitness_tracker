#!/usr/bin/env python3
"""Fitness Log verisini salt okunur analiz eder. Hiçbir dosyaya ya da veritabanına yazmaz
(tek istisna: `program-yaz`, istenen yere yeni bir içe aktarma dosyası oluşturur).

Kaynak sırası: --kaynak ile verilen dosya (.db ya da .json) → ~/fitness-tracker/fitness.db →
~/Downloads içindeki en yeni fitness-export-*.json / fitness-backup-*.json.

Komutlar (çıktı JSON):
  kaynak                      veri nereden okunuyor, ne kadar güncel
  ozet [--gun 28]             antrenman sıklığı, kas grubu başına haftalık set, hareket bazında ilerleme, plato
  beslenme [--gun 28]         kalori/protein ortalaması, kilo eğilimi, tahmini koruma kalorisi, kompozisyon
  program                     programdaki günler, hedefler, haftalık planlanan set
  yorgunluk [--gun 56]        ağır squat/deadlift günlerinden sonraki antrenmanlarda performans farkı
  program-yaz SPEC [--cikti]  program tanımından uygulamaya yüklenebilir içe aktarma dosyası üretir
"""
import argparse
import glob
import json
import os
import re
import sqlite3
import statistics
import sys
import time
import unicodedata
import uuid
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.realpath(__file__))
DB_DEFAULT = os.path.expanduser("~/fitness-tracker/fitness.db")
TABLES = ["exercises", "workouts", "sets", "nutrition", "metrics", "measurements",
          "days", "day_exercises", "exercise_notes", "profile"]
HEAVY = re.compile(r"\bsquat\b|deadlift", re.I)
NOT_HEAVY = re.compile(r"hack|split|goblet|pendulum|belt|sissy|smith|v-squat|jump|pistol|romanian|stiff|single|"
                       r"dumbbell|\bdb\b|rack|leg press", re.I)


# ---------- loading ----------

def find_source(path=None):
    if path:
        return os.path.expanduser(path)
    if os.path.exists(DB_DEFAULT):
        with sqlite3.connect(f"file:{DB_DEFAULT}?mode=ro", uri=True) as c:
            try:
                if c.execute("SELECT COUNT(*) FROM sets").fetchone()[0]:
                    return DB_DEFAULT
            except sqlite3.Error:
                pass
    files = glob.glob(os.path.expanduser("~/Downloads/fitness-export-*.json")) + \
        glob.glob(os.path.expanduser("~/Downloads/fitness-backup-*.json"))
    if files:
        return max(files, key=os.path.getmtime)
    return DB_DEFAULT if os.path.exists(DB_DEFAULT) else None


def load(path):
    """Returns ({table: [rows without deleted]}, meta)."""
    data = {t: [] for t in TABLES}
    meta = {"kaynak": path}
    if path.endswith(".db"):
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)  # read-only
        conn.row_factory = sqlite3.Row
        have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for t in TABLES:
            if t in have:
                data[t] = [dict(r) for r in conn.execute(f"SELECT * FROM {t} WHERE deleted = 0")]
        if "imports" in have:
            last = conn.execute("SELECT MAX(at) FROM imports").fetchone()[0]
            meta["son_guncelleme"] = last
        conn.close()
    else:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
        if payload.get("format") != "fitness-export":
            sys.exit("Bu dosya bir Fitness Log export dosyası değil.")
        for t in TABLES:
            data[t] = [r for r in payload.get("tables", {}).get(t, []) if not r.get("deleted")]
        if payload.get("exported_at"):
            meta["son_guncelleme"] = datetime.fromtimestamp(payload["exported_at"] / 1000).isoformat(timespec="seconds")
    return data, meta


# ---------- helpers ----------

def e1rm(kg, reps, rir):
    if not kg or not reps:
        return 0.0
    return kg * (1 + (reps + (rir or 0)) / 30)


def week_key(ds):
    d = date.fromisoformat(ds)
    return (d - timedelta(days=d.weekday())).isoformat()


def fold(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c)).replace("ı", "i")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-")


# the app's 15 starter exercises (ids from app.js SEED_EXERCISES)
STARTERS = {"bench": ("Bench Press", "Göğüs"), "incline_db": ("Incline Dumbbell Press", "Göğüs"), "squat": ("Squat", "Quadriceps"),
            "deadlift": ("Deadlift", "Sırt"), "rdl": ("Romanian Deadlift", "Hamstring"), "leg_press": ("Leg Press", "Quadriceps"),
            "ohp": ("Overhead Press", "Omuz"), "lateral": ("Lateral Raise", "Omuz"), "pullup": ("Pull-up", "Sırt"),
            "row": ("Barbell Row", "Sırt"), "lat_pd": ("Lat Pulldown", "Sırt"), "curl": ("Biceps Curl", "Biceps"),
            "triceps_pd": ("Triceps Pushdown", "Triceps"), "leg_curl": ("Leg Curl", "Hamstring"), "calf_raise": ("Calf Raise", "Baldır")}


class Data:
    def __init__(self, data):
        self.d = data
        # names for ids the file itself does not carry: starters and the built-in library
        self.ex = {f"ex-{k}": {"id": f"ex-{k}", "name": n, "muscle_group": g} for k, (n, g) in STARTERS.items()}
        self.ex.update({i: {"id": i, "name": n, "muscle_group": g} for i, g, n in library_index().values()})
        self.ex.update({e["id"]: e for e in data["exercises"]})
        self.wo = {w["id"]: w for w in data["workouts"]}
        self.sets = []
        for s in data["sets"]:
            w = self.wo.get(s["workout_id"])
            if w and s.get("reps"):
                s = dict(s, date=w["date"], day_id=w.get("day_id"))
                s["group"] = (self.ex.get(s["exercise_id"]) or {}).get("muscle_group") or "Diğer"
                s["name"] = (self.ex.get(s["exercise_id"]) or {}).get("name") or "?"
                self.sets.append(s)
        self.sets.sort(key=lambda s: (s["date"], s.get("created_at") or 0, s.get("set_no") or 0))

    def sessions(self, ex_id, since=""):
        by = {}
        for s in self.sets:
            if s["exercise_id"] == ex_id and s["date"] >= since:
                by.setdefault(s["date"], []).append(s)
        out = []
        for d in sorted(by):
            ss = by[d]
            out.append({"tarih": d, "set": len(ss),
                        "en_agir": max((x.get("weight_kg") or 0) for x in ss),
                        "en_iyi_e1rm": round(max(e1rm(x.get("weight_kg"), x["reps"], x.get("rir")) for x in ss), 1),
                        "hacim": round(sum((x.get("weight_kg") or 0) * x["reps"] for x in ss)),
                        "setler": [f'{x.get("weight_kg") or 0}x{x["reps"]}' + (f'@{x["rir"]}' if x.get("rir") is not None else "") for x in ss]})
        return out

    def day_items(self, day_id):
        return sorted([i for i in self.d["day_exercises"] if i["day_id"] == day_id], key=lambda i: i.get("sort_order") or 0)

    def latest(self, metric):
        m = sorted([x for x in self.d["measurements"] if x["metric_id"] == metric and x.get("value") is not None], key=lambda x: x["date"])
        return m[-1] if m else None


def since_of(days):
    return (date.today() - timedelta(days=days - 1)).isoformat()


# ---------- commands ----------

def cmd_kaynak(D, meta):
    dates = sorted({s["date"] for s in D.sets})
    upd = meta.get("son_guncelleme")
    age = None
    if upd:
        age = (datetime.now() - datetime.fromisoformat(upd[:19])).days
    return {**meta, "guncellikten_bu_yana_gun": age, "antrenman_gunu": len(dates),
            "ilk_antrenman": dates[0] if dates else None, "son_antrenman": dates[-1] if dates else None,
            "set": len(D.sets), "olcum": len(D.d["measurements"]), "beslenme_gunu": len(D.d["nutrition"]),
            "uyari": ("Arşivde antrenman kaydı yok: telefondan export alıp Mac'e yükle ya da --kaynak ile dosya ver." if not D.sets
                      else "Veri {} gün önce güncellenmiş; telefondan yeni export almak iyi olur.".format(age)
                      if age is not None and age > 3 else None)}


def cmd_ozet(D, days):
    since = since_of(days)
    ps = [s for s in D.sets if s["date"] >= since]
    dates = sorted({s["date"] for s in ps})
    # count weeks from the first session in the window, not from an empty lead-in
    start = max(since, dates[0]) if dates else since
    weeks = max(1.0, ((date.today() - date.fromisoformat(start)).days + 1) / 7)
    groups = {}
    for s in ps:
        groups[s["group"]] = groups.get(s["group"], 0) + 1
    per_week = {g: round(n / weeks, 1) for g, n in sorted(groups.items(), key=lambda x: -x[1])}
    exercises = []
    for ex_id in {s["exercise_id"] for s in ps}:
        hist = D.sessions(ex_id)
        recent = [h for h in hist if h["tarih"] >= since]
        if not recent:
            continue
        before = [h for h in hist if h["tarih"] < recent[-3]["tarih"]] if len(recent) >= 3 else []
        stalled = bool(before) and len(recent) >= 3 and max(h["en_iyi_e1rm"] for h in recent[-3:]) <= max(h["en_iyi_e1rm"] for h in before)
        b = [h["en_iyi_e1rm"] for h in hist]
        falling = len(b) >= 4 and b[-1] < b[-2] < b[-3] < b[-4]
        first, last = recent[0], recent[-1]
        exercises.append({
            "hareket": D.ex[ex_id]["name"], "grup": D.ex[ex_id].get("muscle_group"), "seans": len(recent),
            "ilk": {"tarih": first["tarih"], "en_agir": first["en_agir"], "e1rm": first["en_iyi_e1rm"]},
            "son": {"tarih": last["tarih"], "en_agir": last["en_agir"], "e1rm": last["en_iyi_e1rm"], "setler": last["setler"]},
            "e1rm_degisim_yuzde": round((last["en_iyi_e1rm"] / first["en_iyi_e1rm"] - 1) * 100, 1) if first["en_iyi_e1rm"] else None,
            "plato_3_seans": stalled, "3_seans_dusus": falling})
    exercises.sort(key=lambda x: -x["seans"])
    rir0 = [s for s in ps if s.get("rir") == 0]
    rirs = [s["rir"] for s in ps if s.get("rir") is not None]
    # planned sets of the program days that were trained
    planned, done_day = {}, {}
    for d in dates:
        day_id = next((s["day_id"] for s in ps if s["date"] == d and s.get("day_id")), None)
        for it in D.day_items(day_id) if day_id else []:
            g = (D.ex.get(it["exercise_id"]) or {}).get("muscle_group") or "Diğer"
            planned[g] = planned.get(g, 0) + (it.get("target_sets") or 0)
    return {"donem": {"baslangic": since, "bitis": date.today().isoformat(), "gun": days},
            "antrenman_gunu": len(dates), "haftada_antrenman": round(len(dates) / weeks, 1),
            "toplam_set": len(ps), "haftalik_set_kas_grubu": per_week,
            "planlanan_set_kas_grubu": planned, "yapilan_set_kas_grubu": groups,
            "rir_ortalama": round(statistics.mean(rirs), 2) if rirs else None,
            "rir0_orani_yuzde": round(len(rir0) / len(ps) * 100, 1) if ps else 0,
            "hareketler": exercises}


def cmd_beslenme(D, days):
    since = since_of(days)
    nut = [n for n in D.d["nutrition"] if n["date"] >= since]
    avg = lambda f: (round(statistics.mean([n[f] for n in nut if n.get(f) is not None])) if any(n.get(f) is not None for n in nut) else None)
    w = sorted([(m["date"], m["value"]) for m in D.d["measurements"] if m["metric_id"] == "metric-weight" and m.get("value") is not None and m["date"] >= since])
    slope = None
    if len(w) >= 2:
        xs = [date.fromisoformat(d).toordinal() for d, _ in w]
        ys = [v for _, v in w]
        mx, my = statistics.mean(xs), statistics.mean(ys)
        den = sum((x - mx) ** 2 for x in xs)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else None
    kcal = avg("kcal")
    span = (date.fromisoformat(w[-1][0]) - date.fromisoformat(w[0][0])).days if len(w) >= 2 else 0
    maint = round((kcal - slope * 7700) / 10) * 10 if kcal and slope is not None and span >= 14 and sum(1 for n in nut if n.get("kcal")) >= 7 else None
    weight = D.latest("metric-weight")
    bf = D.latest("metric-body_fat")
    prof = (D.d["profile"] or [{}])[0]
    prot = avg("protein_g")
    return {"donem_gun": days, "kayitli_gun": len(nut), "ortalama_kcal": kcal, "ortalama_protein_g": prot,
            "protein_g_kg": round(prot / weight["value"], 2) if prot and weight else None,
            "ortalama_adim": avg("steps"),
            "kilo_son": {"tarih": weight["date"], "kg": weight["value"]} if weight else None,
            "yag_orani_son": {"tarih": bf["date"], "yuzde": bf["value"]} if bf else None,
            "yagsiz_kutle_son": round(weight["value"] * (1 - bf["value"] / 100), 1) if weight and bf else None,
            "kilo_haftalik_degisim_kg": round(slope * 7, 2) if slope is not None else None,
            "kilo_haftalik_degisim_yuzde": round(slope * 7 / w[0][1] * 100, 2) if slope is not None else None,
            "tahmini_koruma_kcal": maint,
            "hedef": {k: prof.get(k) for k in ["goal", "target_kcal", "target_protein", "target_carb", "target_fat"]}}


def cmd_program(D):
    since = since_of(28)
    trained = {}
    for w in D.d["workouts"]:
        if w.get("day_id") and w["date"] >= since and any(s["workout_id"] == w["id"] for s in D.sets):
            trained[w["day_id"]] = trained.get(w["day_id"], 0) + 1
    days, weekly = [], {}
    for day in sorted(D.d["days"], key=lambda d: d.get("sort_order") or 0):
        per_week = round(trained.get(day["id"], 0) / 4, 2)
        items = []
        for it in D.day_items(day["id"]):
            ex = D.ex.get(it["exercise_id"]) or {}
            g = ex.get("muscle_group") or "Diğer"
            weekly[g] = round(weekly.get(g, 0) + (it.get("target_sets") or 0) * (per_week or 1), 1)
            items.append({"hareket": ex.get("name"), "grup": g, "set": it.get("target_sets"),
                          "tekrar": [it.get("rep_min"), it.get("rep_max")], "rir": it.get("target_rir"), "dinlenme_sn": it.get("rest_sec")})
        days.append({"gun": day["name"], "son_4_haftada_yapilma": trained.get(day["id"], 0), "hareketler": items})
    return {"gunler": days, "haftalik_planlanan_set_kas_grubu": weekly,
            "not": "Haftalık set, günlerin son 4 haftada yapılma sıklığıyla çarpıldı; hiç yapılmayan gün haftada 1 kabul edildi."}


def cmd_yorgunluk(D, days):
    """Relative performance (e1RM vs the exercise's median) in the 3 days after a heavy squat/deadlift day vs other days."""
    since = since_of(days)
    heavy_days = sorted({s["date"] for s in D.sets if s["date"] >= since and HEAVY.search(s["name"]) and not NOT_HEAVY.search(s["name"])})
    med = {}
    for ex_id in {s["exercise_id"] for s in D.sets}:
        vals = [h["en_iyi_e1rm"] for h in D.sessions(ex_id) if h["en_iyi_e1rm"]]
        if len(vals) >= 3:
            med[ex_id] = statistics.median(vals)
    after, other = [], []
    for ex_id, m in med.items():
        if ex_id in {s["exercise_id"] for s in D.sets if HEAVY.search(s["name"]) and not NOT_HEAVY.search(s["name"])}:
            continue  # the heavy lifts themselves are not the outcome
        for h in D.sessions(ex_id, since):
            d = date.fromisoformat(h["tarih"])
            near = any(0 < (d - date.fromisoformat(x)).days <= 3 for x in heavy_days)
            (after if near else other).append(h["en_iyi_e1rm"] / m)
    diff = round((statistics.mean(after) / statistics.mean(other) - 1) * 100, 1) if after and other else None
    return {"agir_gunler": heavy_days, "sonraki_3_gun_seans": len(after), "diger_seans": len(other),
            "goreli_performans_farki_yuzde": diff,
            "yorum_icin_not": "Negatif değer, ağır squat/deadlift günlerinden sonraki 3 gün içinde diğer hareketlerde performansın düştüğünü gösterir. "
                              "Az seansla (<6) sonuç güvenilir değildir."}


def library_index():
    """name (folded) → (id, group) for the app's built-in library, matching the app's id scheme."""
    idx = {}
    path = os.path.join(HERE, "..", "..", "library.js")
    if not os.path.exists(path):
        return idx
    src = open(path, encoding="utf-8").read()
    m = re.search(r"const LIBRARY = (\{.*?\});", src, re.S)
    if m:
        lib = json.loads(re.sub(r",(\s*[\]}])", r"\1", m.group(1)))
        for g, names in lib.items():
            for n in names:
                idx[fold(n)] = ("ex-l-" + slug(n), g, n)
    m = re.search(r"const LIBRARY_EXTRA = (\[.*?\]);", src, re.S)
    if m:
        for n, g in json.loads(m.group(1)):
            idx.setdefault(fold(n), ("ex-l-" + slug(n), g, n))
    return idx


def cmd_program_yaz(D, spec_path, out_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    now = int(time.time() * 1000)
    in_file = {e["id"] for e in D.d["exercises"]}
    known = {fold(e["name"]): e for e in D.ex.values()}  # file + starters + built-in library
    lib = library_index()
    tables = {t: [] for t in TABLES}
    report = []
    for i, day in enumerate(spec["days"]):
        day_id = str(uuid.uuid4())
        tables["days"].append({"id": day_id, "name": day["name"], "sort_order": 100 + i, "updated_at": now, "deleted": 0})
        for k, ex in enumerate(day["exercises"]):
            key = fold(ex["name"])
            if key in known:
                ex_id = known[key]["id"]
                how = "mevcut" if ex_id in in_file else "kütüphane"  # every phone seeds the starters and the library
            else:
                if not ex.get("group"):
                    sys.exit(f'"{ex["name"]}" uygulamada yok; spec içinde "group" (kas grubu) ver.')
                ex_id = "ex-u-" + slug(ex["name"])
                tables["exercises"].append({"id": ex_id, "name": ex["name"], "muscle_group": ex["group"], "updated_at": now, "deleted": 0})
                how = "yeni"
            reps = ex.get("reps") or [None, None]
            reps = reps if isinstance(reps, list) else [reps, reps]
            tables["day_exercises"].append({"id": str(uuid.uuid4()), "day_id": day_id, "exercise_id": ex_id, "sort_order": k,
                                            "target_sets": ex.get("sets"), "rep_min": reps[0], "rep_max": reps[-1],
                                            "target_rir": ex.get("rir"), "rest_sec": ex.get("rest"), "updated_at": now, "deleted": 0})
            report.append(f'{day["name"]}: {ex["name"]} ({how})')
    out = {"format": "fitness-export", "version": 1, "exported_at": now, "source": "fitness-koc", "tables": tables}
    out_path = os.path.expanduser(out_path or f"~/Downloads/fitness-program-{date.today():%Y%m%d}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return {"dosya": out_path, "gun": len(spec["days"]), "hareketler": report,
            "yukleme": "Dosyayı telefona gönder (AirDrop), uygulamada Ayarlar → Yedekten geri yükle. Mevcut günlerin silinmez; eskileri istersen Günü düzenle → Günü sil."}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("komut", choices=["kaynak", "ozet", "beslenme", "program", "yorgunluk", "program-yaz"])
    ap.add_argument("spec", nargs="?")
    ap.add_argument("--kaynak")
    ap.add_argument("--gun", type=int)
    ap.add_argument("--cikti")
    a = ap.parse_args()
    src = find_source(a.kaynak)
    if not src or not os.path.exists(src):
        sys.exit("Veri bulunamadı. Telefondan export alıp ~/Downloads'a koy ya da --kaynak ile dosya ver.")
    data, meta = load(src)
    D = Data(data)
    if a.komut == "kaynak":
        out = cmd_kaynak(D, meta)
    elif a.komut == "ozet":
        out = cmd_ozet(D, a.gun or 28)
    elif a.komut == "beslenme":
        out = cmd_beslenme(D, a.gun or 28)
    elif a.komut == "program":
        out = cmd_program(D)
    elif a.komut == "yorgunluk":
        out = cmd_yorgunluk(D, a.gun or 56)
    else:
        if not a.spec:
            sys.exit("program-yaz için spec JSON dosyası gerekli.")
        out = cmd_program_yaz(D, a.spec, a.cikti)
    print(json.dumps(out, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
