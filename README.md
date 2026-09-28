# Fitness Log

Antrenman, beslenme ve vücut ölçülerini takip eden, telefonda çalışan kişisel bir uygulama.
Hesap ve sunucu yok. Kayıtların sadece senin telefonunda durur, internetsiz de çalışır.

**Adres:** https://alpbayramoglu.github.io/fitness_tracker/

## Neler var

- **Antrenman:** Günlerini (Push, Pull, Legs…) ve içindeki hareketleri kurarsın. Her hareketin hedefini
  set, tekrar aralığı, RIR ve dinlenme süresiyle girersin. Set girerken geçen seferin değerleri görünür.
  Uygulama bir sonraki kilo/tekrarı önerir, dinlenme sayacı kendiliğinden başlar.
- **Günlük:** Kalori, makrolar, adım ve notlar. Kalori hesaplayıcıdan cut, koruma ya da bulk hedefi seçebilirsin.
- **Ölçüler:** Kilo, yağ oranı ve çevre ölçüleri. Boy ve cinsiyet girersen yağ oranı bel ve boyundan
  otomatik hesaplanır (Navy yöntemi).
- **İlerleme:** Takvim, dönem özeti, vücut kompozisyonu, grafikler, rozetler ve seviyeler.
- 750'den fazla hazır hareket. Kütüphane [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
  (public domain) ile genişletildi.

## iPhone'a kurulum

1. Adresi **Safari**'de aç.
2. **Paylaş** butonuna bas. Alt çubukta yoksa adres çubuğundaki **•••** menüsünden Paylaş'ı seç.
3. **Ana Ekrana Ekle**'yi seç. "Web Uygulaması Olarak Aç" seçeneği varsa açık kalsın. **Ekle**'ye bas.
4. Uygulamayı hep **ana ekrandaki ikondan** aç.

Safari sekmesinde de çalışır, ama önerilmez. Safari 7 gün açılmayan sitelerin verisini silebilir.
Sekmenin verisi ana ekran uygulamasıyla da paylaşılmaz. Uygulama Safari sekmesinde açıldığında
üstte uyarı gösterir.

Android'de Chrome → menü → **Ana ekrana ekle** ile aynı şekilde kurulur.

## Veri ve yedekleme

- Kayıtlar telefonun tarayıcı hafızasında (IndexedDB) durur. Hiçbir sunucuya gönderilmez.
- **Ana ekrandaki ikonu silersen içindeki veri de silinir.**
- Yedek almak için: **Ayarlar → Dışa aktar**. Oluşan `.json` dosyasını Dosyalar'a, iCloud Drive'a ya da
  bilgisayarına kaydet. Dosya bütün kayıtlarını içerir.
- Geri yüklemek için: **Ayarlar → Yedekten geri yükle** ile dosyayı seç. Kayıtlar mevcut verilerle
  birleştirilir, hiçbir şey silinmez. Telefon değiştirirken de bu yolu kullan.
- Üstteki rozet yedeklenmemiş kayıt sayısını gösterir. Bir haftayı geçince kırmızıya döner.

## Güncellemeler

Uygulama açıldığında yeni sürümü arka planda indirir. "Yeni sürüm yüklendi" yazınca uygulamayı
kapatıp tekrar aç. Verilerin güncellemeden etkilenmez.

## Geliştirme

Düz HTML, CSS ve JavaScript. Derleme adımı ve bağımlılık yok.

- `index.html`, `app.js`, `style.css`: uygulama
- `library.js`: hazır hareket kütüphanesi
- `sw.js`: çevrimdışı çalışma. Her sürümde içindeki `CACHE` numarasını bir artır, yoksa telefonlar eski dosyaları kullanmaya devam eder.

Yerelde denemek için klasörde `python3 -m http.server` çalıştırıp `http://localhost:8000` adresini aç.
