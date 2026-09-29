"use strict";
// Short daily tips for the Günlük tab. Every source was checked against the Crossref registry (title, first author, journal, DOI).
// c: topic, t: text, s: short citation, d: DOI
const TIPS = [
 {
  "c": "Yağlar",
  "t": "Ayçiçek yağı ve zeytinyağı gramda aynı kaloriyi verir (~9 kcal). Fark içerikte: sızma zeytinyağı tekli doymamış yağ ve polifenoller açısından zengindir. Sızma zeytinyağıyla zenginleştirilmiş Akdeniz diyeti, büyük bir randomize çalışmada kalp-damar olaylarında yaklaşık %30 azalmayla ilişkilendirildi.",
  "s": "Estruch ve ark., 2018 · NEJM",
  "d": "10.1056/nejmoa1800389"
 },
 {
  "c": "Yağlar",
  "t": "Ayçiçek yağındaki linoleik asit (omega-6) sık sık kötülenir. Oysa meta-analiz, doymuş yağın yerine linoleik asit tüketmenin koroner kalp hastalığı riskinde azalmayla ilişkili olduğunu gösteriyor.",
  "s": "Farvid ve ark., 2014 · Circulation",
  "d": "10.1161/circulationaha.114.010236"
 },
 {
  "c": "Yağlar",
  "t": "Yüksek doz omega-3 (EPA) trigliseritleri düşürür. Trigliseridi yüksek, statin kullanan hastalarda yapılan büyük bir çalışmada kalp-damar olaylarında belirgin azalma görüldü. Kas gelişimine doğrudan etkisi ise net değil.",
  "s": "Bhatt ve ark., 2019 · NEJM",
  "d": "10.1056/nejmoa1812792"
 },
 {
  "c": "Hormonlar",
  "t": "Yağ dokusundaki aromataz enzimi testosteronun bir kısmını östrojene çevirir. Obezite erkeklerde düşük testosteronla ilişkilidir; meta-analize göre kilo vermek testosteron seviyesini yükseltebiliyor.",
  "s": "Corona ve ark., 2013 · Eur J Endocrinol",
  "d": "10.1530/eje-12-0955"
 },
 {
  "c": "Protein",
  "t": "Kas ve güç kazanımında protein takviyesinin faydası günde yaklaşık 1.6 g/kg'da plato yapıyor. Üstü zararlı değil ama ek fayda sınırlı görünüyor.",
  "s": "Morton ve ark., 2017 · Br J Sports Med",
  "d": "10.1136/bjsports-2017-097608"
 },
 {
  "c": "Protein",
  "t": "Proteini güne yay: öğün başına yaklaşık 0.4 g/kg, en az 4 öğüne bölünerek alındığında kas yapımı için makul bir dağılım olarak öneriliyor.",
  "s": "Schoenfeld ve ark., 2018 · JISSN",
  "d": "10.1186/s12970-018-0215-1"
 },
 {
  "c": "Protein",
  "t": "\"Antrenmandan sonraki 30 dakikalık anabolik pencere\" abartılı bir inanış. Toplam günlük protein eşitlendiğinde zamanlamanın kas gelişimine belirgin bir etkisi bulunmadı.",
  "s": "Schoenfeld ve ark., 2013 · JISSN",
  "d": "10.1186/1550-2783-10-53"
 },
 {
  "c": "Protein",
  "t": "Cut döneminde, özellikle yağ oranı düşükken, kas kaybını sınırlamak için protein ihtiyacı artabilir. İnceleme yağsız kütle başına 2.3–3.1 g/kg aralığını öneriyor.",
  "s": "Helms ve ark., 2014 · IJSNEM",
  "d": "10.1123/ijsnem.2013-0054"
 },
 {
  "c": "Protein",
  "t": "Protein en doyurucu makro besindir. Yüksek proteinli beslenme tokluğu artırır ve kilo verirken yağsız kütleyi korumaya yardımcı olur.",
  "s": "Leidy ve ark., 2015 · Am J Clin Nutr",
  "d": "10.3945/ajcn.114.084038"
 },
 {
  "c": "Protein",
  "t": "Yatmadan önce yaklaşık 30 g kazein proteini (süzme yoğurt, lor gibi), 12 haftalık antrenman çalışmasında daha fazla kas ve güç kazanımıyla ilişkilendirildi.",
  "s": "Snijders ve ark., 2015 · J Nutr",
  "d": "10.3945/jn.114.208371"
 },
 {
  "c": "Cut",
  "t": "Cut'ta haftada vücut ağırlığının %0.5–1'i kadar kayıp, kas kütlesini korumak için makul bir hız olarak öneriliyor. Daha hızlı kayıp daha fazla kas kaybı riski taşır.",
  "s": "Helms ve ark., 2014 · JISSN",
  "d": "10.1186/1550-2783-11-20"
 },
 {
  "c": "Cut",
  "t": "Diyet molası işe yarayabilir: 2 hafta diyet, 2 hafta koruma kalorisi şeklinde ilerleyen erkekler, kesintisiz diyet yapanlara göre daha verimli yağ kaybetti.",
  "s": "Byrne ve ark., 2017 · Int J Obes",
  "d": "10.1038/ijo.2017.206"
 },
 {
  "c": "Cut",
  "t": "Kontrollü bir çalışmada ultra işlenmiş gıdalarla beslenenler, işlenmemiş diyete göre kendiliğinden günde yaklaşık 500 kcal fazla yedi ve kilo aldı.",
  "s": "Hall ve ark., 2019 · Cell Metab",
  "d": "10.1016/j.cmet.2019.05.008"
 },
 {
  "c": "Cut",
  "t": "Şekerli içecekler tip 2 diyabet ve metabolik sendrom riskinde artışla ilişkili. Kalori açığı ararken en kolay kesilecek kalemlerden biri.",
  "s": "Malik ve ark., 2010 · Diabetes Care",
  "d": "10.2337/dc10-1079"
 },
 {
  "c": "Takviye",
  "t": "Kreatin monohidrat en çok çalışılmış ve güvenliği en iyi belgelenmiş takviyelerden biri. Günde 3–5 g, güç ve kas kazanımını destekliyor; yükleme fazı şart değil.",
  "s": "Kreider ve ark., 2017 · JISSN",
  "d": "10.1186/s12970-017-0173-z"
 },
 {
  "c": "Takviye",
  "t": "Kafein antrenmandan yaklaşık 60 dakika önce 3–6 mg/kg dozunda alındığında güç ve dayanıklılık performansını artırabiliyor.",
  "s": "Guest ve ark., 2021 · JISSN",
  "d": "10.1186/s12970-020-00383-4"
 },
 {
  "c": "Takviye",
  "t": "Beta-alanin, özellikle 30 saniye ile 10 dakika arası süren yüksek yoğunluklu eforlarda performansı artırabiliyor. Yaptığı karıncalanma zararsız bir yan etki.",
  "s": "Saunders ve ark., 2016 · Br J Sports Med",
  "d": "10.1136/bjsports-2016-096396"
 },
 {
  "c": "Uyku",
  "t": "Yatmadan 6 saat önce alınan 400 mg kafein bile uykuyu 1 saatten fazla kısalttı. Akşam antrenmanında ön antrenman takviyesine dikkat.",
  "s": "Drake ve ark., 2013 · J Clin Sleep Med",
  "d": "10.5664/jcsm.3170"
 },
 {
  "c": "Uyku",
  "t": "Diyette uyku kısıtlanırsa verilen kilonun daha büyük kısmı kastan gidiyor: 5.5 saat uyuyanlar, 8.5 saat uyuyanlara göre %55 daha az yağ kaybetti.",
  "s": "Nedeltcheva ve ark., 2010 · Ann Intern Med",
  "d": "10.7326/0003-4819-153-7-201010050-00006"
 },
 {
  "c": "Uyku",
  "t": "Bir hafta boyunca gecede 5 saat uyumak, genç ve sağlıklı erkeklerde gündüz testosteron seviyesini %10–15 düşürdü.",
  "s": "Leproult ve ark., 2011 · JAMA",
  "d": "10.1001/jama.2011.710"
 },
 {
  "c": "Uyku",
  "t": "Yetişkinler için önerilen uyku gecede en az 7 saat. Düzenli olarak bunun altında kalmak birçok sağlık sorunuyla ilişkili.",
  "s": "Watson ve ark., 2015 · Sleep",
  "d": "10.5665/sleep.4716"
 },
 {
  "c": "Toparlanma",
  "t": "Kronik stres toparlanmayı yavaşlatıyor: stresi yüksek kişilerde ağır antrenmandan sonraki 96 saatte kas işlevi daha geç toparlandı.",
  "s": "Stults-Kolehmainen ve ark., 2014 · J Strength Cond Res",
  "d": "10.1519/jsc.0000000000000335"
 },
 {
  "c": "Toparlanma",
  "t": "Tükenişe kadar yapılan setler toparlanma süresini belirgin şekilde uzatıyor. Ağır bileşik hareketlerde 1–2 tekrar kala durmak, sonraki antrenmanlara daha zinde girmeni sağlar.",
  "s": "Morán-Navarro ve ark., 2017 · Eur J Appl Physiol",
  "d": "10.1007/s00421-017-3725-7"
 },
 {
  "c": "Toparlanma",
  "t": "Antrenmandan hemen sonra buz banyosu, uzun vadede kas ve güç kazanımını azaltabiliyor. Amaç kas gelişimiyse buz banyosunu antrenmandan ayrı tut.",
  "s": "Roberts ve ark., 2015 · J Physiol",
  "d": "10.1113/jp270570"
 },
 {
  "c": "Toparlanma",
  "t": "Antrenman sonrası yüksek miktarda alkol, yanında protein alınsa bile kas protein sentezini yaklaşık %24 azalttı.",
  "s": "Parr ve ark., 2014 · PLoS One",
  "d": "10.1371/journal.pone.0088384"
 },
 {
  "c": "Antrenman",
  "t": "Haftalık set sayısı arttıkça kas gelişimi artıyor: kas grubu başına haftada 10+ set, 5 setin altına göre belirgin şekilde daha fazla kazanım sağladı.",
  "s": "Schoenfeld ve ark., 2016 · J Sports Sci",
  "d": "10.1080/02640414.2016.1210197"
 },
 {
  "c": "Antrenman",
  "t": "Bir kas grubunu haftada en az 2 kez çalıştırmak, aynı hacmi tek güne sıkıştırmaktan daha iyi kas gelişimi sağlıyor.",
  "s": "Schoenfeld ve ark., 2016 · Sports Med",
  "d": "10.1007/s40279-016-0543-8"
 },
 {
  "c": "Antrenman",
  "t": "Antrenmanlı erkeklerde 3 dakikalık set arası dinlenme, 1 dakikaya göre hem güç hem kas kazanımında daha iyi sonuç verdi. Dinlenmeyi aceleye getirme.",
  "s": "Schoenfeld ve ark., 2016 · J Strength Cond Res",
  "d": "10.1519/jsc.0000000000001272"
 },
 {
  "c": "Antrenman",
  "t": "Setler tükenişe yakın yapıldığında hafif (%30–60 1RM) ve ağır yükler benzer kas gelişimi sağlıyor. Güç kazanımında ise ağır yükler daha üstün.",
  "s": "Schoenfeld ve ark., 2017 · J Strength Cond Res",
  "d": "10.1519/jsc.0000000000002200"
 },
 {
  "c": "Antrenman",
  "t": "Tükenişe kadar gitmek, tükenişe yakın bırakmaya göre belirgin ek kas gelişimi sağlamıyor. Setleri 1–3 tekrar kala (RIR 1–3) bitirmek çoğu zaman yeterli ve daha az yorucu.",
  "s": "Refalo ve ark., 2022 · Sports Med",
  "d": "10.1007/s40279-022-01784-y"
 },
 {
  "c": "Antrenman",
  "t": "Kasın uzamış pozisyonunda çalışmak kas gelişimi için avantajlı görünüyor. Hareketlerin alt (esneme) noktasını kısaltma.",
  "s": "Pedrosa ve ark., 2021 · Eur J Sport Sci",
  "d": "10.1080/17461391.2021.1927199"
 },
 {
  "c": "Kardiyo",
  "t": "Yağ kaybında HIIT ile orta tempolu sürekli kardiyo benzer sonuç veriyor. HIIT zaman kazandırır; hangisini sürdürebiliyorsan o daha iyidir.",
  "s": "Wewege ve ark., 2017 · Obes Rev",
  "d": "10.1111/obr.12532"
 },
 {
  "c": "Kardiyo",
  "t": "Kardiyo ile ağırlık antrenmanını birlikte yapmak kas ve güç kazanımını bir miktar azaltabiliyor; bu etki koşuda bisiklete göre daha belirgin.",
  "s": "Wilson ve ark., 2012 · J Strength Cond Res",
  "d": "10.1519/jsc.0b013e31823a3e2d"
 },
 {
  "c": "Kardiyo",
  "t": "15 kohortluk meta-analizde günlük adım arttıkça ölüm riski azaldı. Fayda 60 yaş altında yaklaşık 8.000–10.000, 60 yaş üstünde 6.000–8.000 adımda plato yaptı.",
  "s": "Paluch ve ark., 2022 · Lancet Public Health",
  "d": "10.1016/s2468-2667(21)00302-9"
 },
 {
  "c": "Kardiyo",
  "t": "Egzersiz dışı günlük hareket (NEAT: yürümek, ayakta durmak, kıpırdanmak) kişiler arasında yüzlerce kalorilik fark yaratabiliyor ve fazla yemeye rağmen yağlanmaya direnci belirliyor.",
  "s": "Levine ve ark., 1999 · Science",
  "d": "10.1126/science.283.5399.212"
 },
 {
  "c": "Kardiyo",
  "t": "Uzun süre oturmanın getirdiği ek risk, günde yaklaşık 60–75 dakika orta şiddetli aktiviteyle büyük ölçüde ortadan kalkıyor.",
  "s": "Ekelund ve ark., 2016 · Lancet",
  "d": "10.1016/s0140-6736(16)30370-1"
 },
 {
  "c": "Sağlık",
  "t": "DSÖ yetişkinlere haftada 150–300 dakika orta ya da 75–150 dakika yüksek şiddetli aerobik aktivite ve haftada en az 2 gün kas güçlendirme öneriyor.",
  "s": "Bull ve ark., 2020 · Br J Sports Med",
  "d": "10.1136/bjsports-2020-102955"
 },
 {
  "c": "Sağlık",
  "t": "Kas güçlendirme egzersizleri ölüm, kalp-damar hastalığı, kanser ve diyabet riskinde azalmayla ilişkili. En büyük fayda haftada 30–60 dakika civarında görülüyor.",
  "s": "Momma ve ark., 2022 · Br J Sports Med",
  "d": "10.1136/bjsports-2021-105061"
 },
 {
  "c": "Sağlık",
  "t": "Günde 25–29 g lif alanlarda kalp hastalığı, felç, tip 2 diyabet ve kolorektal kanser riski daha düşük bulundu.",
  "s": "Reynolds ve ark., 2019 · Lancet",
  "d": "10.1016/s0140-6736(18)31809-9"
 },
 {
  "c": "Sağlık",
  "t": "Günde yaklaşık 800 g meyve ve sebze tüketimi, hastalık ve ölüm riskinde en büyük azalmayla ilişkili bulundu.",
  "s": "Aune ve ark., 2017 · Int J Epidemiol",
  "d": "10.1093/ije/dyw319"
 },
 {
  "c": "Sağlık",
  "t": "Vücut ağırlığının %2'sinden fazla sıvı kaybı performansı düşürebilir. Antrenman boyunca susamayı bekleme, düzenli su iç.",
  "s": "Sawka ve ark., 2007 · Med Sci Sports Exerc",
  "d": "10.1249/mss.0b013e31802ca597"
 },
 {
  "c": "Sağlık",
  "t": "Metabolizma 20'lerden sonra sanıldığı gibi hızla yavaşlamıyor: vücut büyüklüğüne göre düzeltilmiş enerji harcaması 20–60 yaş arasında büyük ölçüde sabit kalıyor.",
  "s": "Pontzer ve ark., 2021 · Science",
  "d": "10.1126/science.abe5017"
 }
];
