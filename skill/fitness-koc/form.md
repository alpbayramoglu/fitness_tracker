# Tanışma formu

Amaç: kişiyi tanımak, riskleri ayıklamak, programı kısıtlara göre kurmak.

## Nasıl sorulur

- Bölümleri sırayla sor. Her turda en fazla 4 soru, mümkünse seçmeli (AskUserQuestion), kısa ve sade.
  Serbest metin gereken yerde (ağrı, kan değeri) tek soru sor.
- Uygulamada olanı sorma: yaş, cinsiyet, boy (profile), kilo/yağ oranı (ölçümler), günlük adım,
  mevcut program ve en iyi kaldırışlar `analiz.py kaynak/ozet/beslenme/program` çıktısından gelir. Sadece eksikse sor.
- Her bölümden sonra cevapları profil dosyasına yaz (aşağıdaki biçim). Yarım kalırsa kaldığın yerden devam et.
- Bir sonraki formda sadece değişmiş olabilecekleri sor ("Uyku düzenin hâlâ 6–7 saat mi?").

## 1. Güvenlik taraması (PAR-Q+'tan esinlenen, en başta)

Evet / Hayır:
1. Bir doktor kalp rahatsızlığın ya da yüksek tansiyonun olduğunu söyledi mi?
2. Dinlenirken, günlük işlerde ya da egzersizde göğüs ağrısı hissediyor musun?
3. Son 12 ayda baş dönmesi yüzünden dengeni kaybettin ya da bayıldın mı?
4. Kalp/tansiyon dışında tanı konmuş kronik bir hastalığın var mı (diyabet, astım, eklem hastalığı…)?
5. Kronik bir rahatsızlık için düzenli ilaç kullanıyor musun?
6. Egzersizle kötüleşebilecek bir kemik, eklem ya da yumuşak doku sorunun var mı?
7. Bir doktor sadece gözetim altında egzersiz yapmanı söyledi mi?

Herhangi biri "Evet" ise: değerlendirmeye devam et, ama raporun en başına "Programa başlamadan önce hekim onayı al" yaz,
programı temkinli kur (tükenişe yakın çalışma yok, ilerleme yavaş). Resmi form: https://eparmedx.com

## 2. Spor geçmişi

- Düzenli ağırlık antrenmanı kaç yıldır? (0–6 ay / 6 ay–2 yıl / 2–5 yıl / 5+ yıl)
- Son 1 yılda 1 aydan uzun ara verdin mi?
- Başka spor geçmişi (takım sporu, dövüş, koşu…)?
- En iyi kaldırışlar (uygulamada yoksa): bench, squat, deadlift, overhead press, barfiks — kg × tekrar.

## 3. Hedef

- Ana hedef: estetik/klasik fizik · men's physique · vücut geliştirme · güç (powerlifting) · strongman ·
  atletik performans · yağ kaybı · genel sağlık · "harekette bereket var" (hepsinden biraz)
- Öncelikli bölgeler (en fazla 3) ve geri planda kalabilecekler.
- Hedef tarih var mı (yaz, yarışma, düğün…)?
- Şu anki dönem: cut / koruma / bulk / karar vermedim.

## 4. Zaman ve imkân

- Haftada kaç gün? (2 / 3 / 4 / 5 / 6)
- Antrenman başına kaç dakika? (45 / 60 / 75 / 90+)
- Nerede? (tam donanımlı salon / sınırlı salon / ev)
- Ekipman kısıtı: olmayan ya da her zaman dolu olan aletler.
- Program tipi tercihi: full body · upper/lower · PPL (3 gün) · PPL (6 gün) · PPL + upper/lower · torso/limbs ·
  Arnold split · bro split (her gün bir kas grubu) · güç/powerlifting · "bana bırak". Şu an ne kullandığını da sor
  (uygulamadaki günlerin adlarından çoğu zaman anlaşılır).
- Sevdiğin ve asla yapmak istemediğin hareketler.

## 5. Yorgunluk profili

- Seni en çok yoran hareketler? (squat / deadlift / bench / overhead press / barfiks / diğer)
- Ağır bacak ya da deadlift gününden sonra kaç günde toparlanıyorsun? (1 / 2 / 3+ gün)
- Belirtiler: ertesi gün halsizlik · uyku bozulması · sonraki antrenmanlarda güç düşüşü · isteksizlik · eklem ağrısı
- Bu hareketleri seviyor musun? (seviyorum, kalsın / nötr / çıkarılabilir)

Uygulamada yeterli veri varsa `analiz.py yorgunluk` sonucunu burada kullanıcıyla paylaş ("ağır günlerden sonra performans %5 düşük görünüyor").

## 6. Toparlanma ve yaşam

- Uyku süresi (<6 / 6–7 / 7–8 / 8+) ve kalitesi (iyi / orta / kötü).
- Stres düzeyi (düşük / orta / yüksek).
- İş: masa başı / ayakta / fiziksel ağır.
- Alkol (hiç / haftada 1–3 / daha sık), sigara (evet / hayır).

## 7. Kardiyo

- Şu an ne yapıyorsun, haftada kaç dakika?
- Tercih: yürüyüş / bisiklet / koşu / yüzme / HIIT / sevmiyorum.
- Kardiyo hedefi: kalp sağlığı / yağ kaybı / kondisyon / bir yarış.

## 8. Sağlık, ağrı ve sakatlık

- Geçmiş ve mevcut sakatlıklar, ameliyatlar, sürekli ağrıyan bölgeler (serbest metin).
- Mevcut ağrı varsa: hangi harekette, 0–10 şiddet. Ağrılı bölgeye yük bindiren hareketi programa koyma,
  "bir fizyoterapist ya da hekime göster" de, alternatif öner.

## 9. Kan değerleri (isteğe bağlı)

Sadece kullanıcı verirse: ferritin, D vitamini, B12, hemoglobin, lipid profili, açlık şekeri/HbA1c, TSH, testosteron.
Değer ve referans aralığıyla birlikte kaydet. Yorum `rehber.md` → "Kan değerleri" ilkelerine göre: tanı yok, doz yok,
aralık dışı her değer için "doktorunla konuş".

## 10. Takviyeler

Kullandıkları (kreatin, protein tozu, kafein/ön antrenman, omega-3, D vitamini, diğer). Performans artırıcı maddeler (PED)
konu dışı: soru gelirse "bu konuda yardımcı olamam, bir hekimle konuş" de.

## Profil dosyası

Yol: `~/.claude/fitness-koc/profil.md` (repo dışında, sadece bu bilgisayarda).

```markdown
# Fitness koç profili
Son güncelleme: YYYY-MM-DD

## Güvenlik
PAR-Q: tümü hayır | ya da: 4 evet (astım, ilaçla kontrol altında) → hekim onayı önerildi

## Geçmiş
Antrenman yaşı: 2–5 yıl · Son uzun ara: yok · Diğer sporlar: …

## Hedef
Ana: estetik · Öncelik: omuz, sırt · Dönem: cut · Hedef tarih: 2027-06

## İmkân
4 gün × 75 dk · tam salon · Tip tercihi: upper/lower · Sevmediği: … · Sevdiği: squat, deadlift

## Yorgunluk
En yoran: squat, deadlift · Toparlanma: 3 gün · Belirti: sonraki antrenmanda güç düşüşü · Hareketleri seviyor: evet

## Yaşam
Uyku 6–7 saat, orta · Stres yüksek · Masa başı · Alkol haftada 1–3 · Sigara yok

## Kardiyo
Haftada 60 dk yürüyüş · Tercih bisiklet · Hedef: kalp sağlığı

## Sağlık
Sağ omuz: bench'te 3/10 ağrı (2026-09) …

## Kan değerleri
2026-08: ferritin 28 µg/L (ref 30–400) → doktora yönlendirildi …

## Takviyeler
Kreatin 5 g, protein tozu

## Değerlendirme geçmişi
- YYYY-MM-DD: özet (1–2 satır), verilen program dosyası adı
```
