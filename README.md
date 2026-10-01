# Fitness Log

Antrenmanını, beslenmeni ve vücut ölçülerini takip eden, telefonda çalışan kişisel bir uygulama.
Hesap ve sunucu yok. Kayıtların sadece senin telefonunda durur, internetsiz de çalışır.

**Adres:** https://alpbayramoglu.github.io/fitness_tracker/

## Neler var

| Sekme | Ne yaparsın |
|---|---|
| **Antrenman** | Programlarını (PPL, Upper/Lower…) ve günlerini kurarsın. Harekete dokunup set girersin: kg, tekrar, RIR. Geçen seferin setleri ve bir sonraki kilo/tekrar önerisi görünür, dinlenme sayacı kendiliğinden başlar. Bir hareketi ⇄ ile muadiliyle değiştirebilirsin. |
| **Günlük** | Kalori, protein, karbonhidrat, yağ, adım ve notlar. Kalori hesaplayıcı cut, koruma ya da bulk hedefi önerir. |
| **Ölçüler** | Kilo ve çevre ölçüleri. Bel ve boyundan yağ oranı otomatik hesaplanır (Navy yöntemi). Ön, yan ve arka ilerleme fotoğrafları. |
| **İlerleme** | Son 7 günün karnesi, hedefler, takvim, dönem özeti, cut/bulk dönemleri, hareket gelişimi, vücut kompozisyonu, grafikler ve rozetler. |
| **Ayarlar** | Profil, tema, yedekleme ve sürüm notları. |

750'den fazla hazır hareket var. Kütüphane [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain) ile genişletildi.

## iPhone'a kurulum

1. Adresi **Safari**'de aç.
2. **Paylaş**'a bas (alt çubukta yoksa adres çubuğundaki **•••** menüsünde).
3. **Ana Ekrana Ekle**'yi seç, **Ekle**'ye bas.
4. Uygulamayı hep **ana ekrandaki ikondan** aç.

Safari sekmesinde de çalışır ama önerilmez: Safari, 7 gün açılmayan sitelerin verisini silebilir ve sekmenin verisi
ana ekran uygulamasıyla paylaşılmaz. Android'de Chrome → menü → **Ana ekrana ekle**.

## Verilerin ve yedek

- Kayıtlar telefonun tarayıcı hafızasında durur, hiçbir yere gönderilmez.
- **Ana ekrandaki ikonu silersen içindeki veri de silinir.** Düzenli yedek al.
- **Yedek almak:** Ayarlar → **Dışa aktar**. Oluşan `.json` dosyasını Dosyalar'a, iCloud Drive'a ya da bilgisayarına kaydet.
- **Geri yüklemek:** Ayarlar → **Yedekten geri yükle**. Kayıtlar birleştirilir, hiçbir şey silinmez. Telefon değiştirirken de bu yolu kullan.
- İlerleme fotoğrafları yedeğe girmez. Telefonun Fotoğraflar uygulamasında da sakla.
- Üstteki rozet yedeklenmemiş kayıt sayısını gösterir; bir haftayı geçince kırmızıya döner.

## Claude Code ile koçluk (isteğe bağlı)

`skill/fitness-koc/` klasörü, verini okuyup yorumlayan bir [Claude Code](https://claude.com/claude-code) skill'i.
Verini sadece okur, hiçbir şeyi değiştirmez ve hiçbir yere göndermez. Önerileri, kaynakları tek tek doğrulanmış bilimsel
çalışmalara dayanan bir rehbere göre yapar. Tanı koymaz, ilaç ya da doz önermez.

### Kurulum

1. `skill/fitness-koc/` klasörünü bilgisayarında `~/.claude/skills/fitness-koc/` altına kopyala.
2. Telefonda Ayarlar → **Dışa aktar** ile aldığın dosyayı bilgisayarının **İndirilenler** klasörüne koy.
   Skill en yeni `fitness-export-*.json` dosyasını kendisi bulur.
3. Claude Code'u aç ve aşağıdaki komutlardan birini yaz.

### Ne sorabilirsin

| Komut | Ne yapar |
|---|---|
| `/fitness-koc form` | Tanışma formu. Önce kısa bir sağlık taraması, sonra hedef, haftada kaç gün ve kaç dakika, sakatlıklar, uyku, kardiyo, takviyeler. İstersen kan tahlili değerlerini de not eder. Cevaplar sadece bilgisayarında saklanır. **İlk kez kullanıyorsan buradan başla.** |
| `/fitness-koc değerlendir` | Son dönemin değerlendirmesi: kas grubu başına haftalık set, ilerleyen ve duran hareketler, kalori ve kilo eğilimi, tahmini koruma kalorisi, notların ve 3 somut öneri. |
| `/fitness-koc program` | Mevcut programının analizi: eksik ya da fazla çalışan bölgeler, itme/çekme dengesi, seans süresi. |
| `/fitness-koc plato` | Duran hareketler ve olası sebepleri. Programdan çıkardığın ya da değiştirdiğin hareketleri plato saymaz. |
| `/fitness-koc deload` | Dinlenme haftası zamanı gelmiş mi? |
| `/fitness-koc program-yaz` | Sana özel program. Önce tablo olarak gösterir, onaylarsan uygulamaya yüklenecek bir dosya üretir. |

Komut yazmak zorunda değilsin, normal cümleyle de sorabilirsin. Örnekler:

- *"Beni değerlendir. Temmuz ortasından beri cut yapıyorum, kilo veriyor muyum, kas kaybım var mı?"*
- *"Son 3 ayda hangi hareketlerde ilerledim, hangilerinde takıldım?"*
- *"Haftada 4 gün, 60 dakika çalışabiliyorum. Belimde fıtık var, ağır squat yapamıyorum. Bana program yaz."*
- *"Biceps'i haftada 2 gün 3'er set mi, 3 gün 2'şer set mi çalışayım?"*
- *"Bench'te 3 haftadır 70 kg'da takıldım, ne yapayım?"*

Antrenman, hareket ve günlük notların da değerlendirmeye girer. Mesela bir seansa "sağ omuz ağrıdı, hafif çalıştım"
yazarsan, o günkü düşüşü plato saymaz ve tekrarlayan ağrıyı ayrıca belirtir.

### Yazdığı programı telefona almak

1. Skill programı `~/Downloads/fitness-program-YYYYMMDD.json` olarak kaydeder.
2. Dosyayı AirDrop ile telefona gönder, Dosyalar'a kaydet.
3. Uygulamada Ayarlar → **Yedekten geri yükle** ile seç.
4. Yeni program Antrenman sekmesinde en üstte açılır. Eski programın silinmez, "Önceki programlar" altına iner.

## Güncellemeler

Uygulama açıldığında yeni sürümü arka planda indirir. "Yeni sürüm yüklendi" yazınca uygulamayı kapatıp tekrar aç.
Hangi sürümde olduğun ve son değişiklikler Ayarlar'ın en üstünde yazar. Verilerin güncellemeden etkilenmez.

## Geliştirme

Düz HTML, CSS ve JavaScript. Derleme adımı ve bağımlılık yok.

- `index.html`, `app.js`, `style.css`: uygulama
- `insights.js`: İlerleme sekmesindeki karne, hedefler, dönemler ve hareket gelişimi
- `photos.js`: ilerleme fotoğrafları
- `library.js`: hazır hareketler · `tips.js`: günün bilgisi (kaynaklı)
- `skill/fitness-koc/`: Claude Code koçluk skill'i
- `sw.js`: çevrimdışı çalışma. Her sürümde `sw.js`'teki `VERSION` ile `app.js`'teki `APP_VERSION`'ı birlikte bir artır
  ve `CHANGELOG`'a bir satır ekle; yoksa telefonlar eski dosyaları kullanmaya devam eder.

Yerelde denemek için klasörde `python3 -m http.server` çalıştırıp `http://localhost:8000` adresini aç.
