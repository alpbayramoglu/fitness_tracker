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
 },
 {
  "c": "Diyet",
  "t": "Keto diyetin ek yağ yakımı sağladığı yaygın bir inanış. Kalori ve protein eşitlenen kontrollü bir çalışmada ketojenik diyet, standart diyete göre daha fazla yağ kaybı sağlamadı.",
  "s": "Hall ve ark., 2016 · Am J Clin Nutr",
  "d": "10.3945/ajcn.116.133561"
 },
 {
  "c": "Diyet",
  "t": "Düşük yağlı mı düşük karbonhidratlı mı? 609 kişilik 12 aylık bir çalışmada iki diyetle verilen kilo arasında anlamlı fark çıkmadı. Sürdürebildiğin diyet en iyisi.",
  "s": "Gardner ve ark., 2018 · JAMA",
  "d": "10.1001/jama.2018.0245"
 },
 {
  "c": "Diyet",
  "t": "16:8 aralıklı oruç, randomize bir çalışmada aynı saatlere sıkıştırılmamış beslenmeye göre ek kilo kaybı sağlamadı; kaybın bir kısmı yağsız kütleden geldi.",
  "s": "Lowe ve ark., 2020 · JAMA Intern Med",
  "d": "10.1001/jamainternmed.2020.4153"
 },
 {
  "c": "Diyet",
  "t": "Kalori kısıtlamasına zaman kısıtlı beslenme eklemek, 12 aylık randomize bir çalışmada ek kilo ya da yağ kaybı sağlamadı. Belirleyici olan toplam kalori.",
  "s": "Liu ve ark., 2022 · NEJM",
  "d": "10.1056/nejmoa2114833"
 },
 {
  "c": "Diyet",
  "t": "\"Kahvaltı metabolizmayı çalıştırır\" inancı kanıtla desteklenmiyor. Meta-analizde kahvaltı yapmak kilo kaybına yardım etmedi; toplam kaloriyi biraz artırdı.",
  "s": "Sievert ve ark., 2019 · BMJ",
  "d": "10.1136/bmj.l42"
 },
 {
  "c": "Diyet",
  "t": "Günde 3 öğün ya da 6 öğün, toplam kalori aynıysa yağ kaybında belirgin fark yaratmıyor. Öğün sayısını düzenine göre seç.",
  "s": "Schoenfeld ve ark., 2015 · Nutr Rev",
  "d": "10.1093/nutrit/nuu017"
 },
 {
  "c": "Diyet",
  "t": "Diyet sırasında her ana öğünden önce 500 ml su içenler, 12 haftada içmeyenlere göre yaklaşık 2 kg daha fazla kilo verdi.",
  "s": "Dennis ve ark., 2010 · Obesity",
  "d": "10.1038/oby.2009.235"
 },
 {
  "c": "Diyet",
  "t": "Tatlandırıcılar şekerin yerine kullanıldığında, kanıtların toplamı daha az kalori alımı ve biraz daha düşük kiloyla ilişkili olduğunu gösteriyor.",
  "s": "Rogers ve ark., 2015 · Int J Obes",
  "d": "10.1038/ijo.2015.177"
 },
 {
  "c": "Diyet",
  "t": "Yavaş yemek, hızlı yemeğe göre öğündeki kalori alımını azaltıyor. Çatalı arada bırakmak basit bir yöntem.",
  "s": "Robinson ve ark., 2014 · Am J Clin Nutr",
  "d": "10.3945/ajcn.113.081745"
 },
 {
  "c": "Diyet",
  "t": "Proteinin sindirimi daha fazla enerji harcatır: proteinin kalorisinin %20–30'u sindirimde harcanırken bu oran karbonhidratta %5–10, yağda %0–3.",
  "s": "Westerterp ve ark., 2004 · Nutr Metab",
  "d": "10.1186/1743-7075-1-5"
 },
 {
  "c": "Diyet",
  "t": "Çok agresif kilo kaybı metabolizmayı uzun süre yavaşlatabilir: aşırı kilo veren yarışmacılarda 6 yıl sonra bile beklenenden günde yüzlerce kalori düşük harcama ölçüldü.",
  "s": "Fothergill ve ark., 2016 · Obesity",
  "d": "10.1002/oby.21538"
 },
 {
  "c": "Diyet",
  "t": "Yediklerini kaydetmek işe yarıyor: kalori ve kilo takibi, sistematik incelemede kilo kaybıyla tutarlı şekilde ilişkili bulundu. Bu uygulamayı kullanman zaten bir adım önde olman demek.",
  "s": "Burke ve ark., 2011 · J Am Diet Assoc",
  "d": "10.1016/j.jada.2010.10.008"
 },
 {
  "c": "Diyet",
  "t": "Her gün tartılanlar, daha seyrek tartılanlara göre daha fazla kilo verdi. Tek bir günün değerine değil, haftalık ortalamaya bak.",
  "s": "Steinberg ve ark., 2015 · J Acad Nutr Diet",
  "d": "10.1016/j.jand.2014.12.011"
 },
 {
  "c": "Protein",
  "t": "Antrenman yapan kişiler 8 hafta boyunca 4.4 g/kg protein alıp günde ~800 kcal fazla yedikleri hâlde yağ kütleleri artmadı.",
  "s": "Antonio ve ark., 2014 · JISSN",
  "d": "10.1186/1550-2783-11-19"
 },
 {
  "c": "Protein",
  "t": "Antrenmanlı erkeklerde bir yıl boyunca yüksek protein (2.5–3.3 g/kg) böbrek, karaciğer ve kan yağlarında olumsuz etki göstermedi.",
  "s": "Antonio ve ark., 2016 · J Nutr Metab",
  "d": "10.1155/2016/9104792"
 },
 {
  "c": "Protein",
  "t": "Sağlıklı yetişkinlerde yüksek proteinli beslenme böbrek fonksiyonunda normal proteinli beslenmeden farklı bir değişim yaratmadı. Böbrek hastalığı olanlar ise doktoruna danışmalı.",
  "s": "Devries ve ark., 2018 · J Nutr",
  "d": "10.1093/jn/nxy197"
 },
 {
  "c": "Protein",
  "t": "Protein miktarı eşitlendiğinde (1.6 g/kg), vegan beslenenler ve hepçil beslenenler 12 haftalık antrenmanda benzer kas ve güç kazandı.",
  "s": "Hevia-Larraín ve ark., 2021 · Sports Med",
  "d": "10.1007/s40279-021-01434-9"
 },
 {
  "c": "Protein",
  "t": "Tüm vücut antrenmanından sonra 40 g whey, 20 g'a göre kas protein sentezini daha fazla artırdı. Büyük antrenmanlardan sonra biraz daha büyük porsiyon mantıklı.",
  "s": "Macnaughton ve ark., 2016 · Physiol Rep",
  "d": "10.14814/phy2.12893"
 },
 {
  "c": "Protein",
  "t": "\"Vücut tek öğünde 30 g'dan fazla protein kullanamaz\" bir efsane: 100 g protein, 25 g'a göre daha büyük ve 12 saate kadar süren bir kas yapım yanıtı oluşturdu.",
  "s": "Trommelen ve ark., 2023 · Cell Rep Med",
  "d": "10.1016/j.xcrm.2023.101324"
 },
 {
  "c": "Protein",
  "t": "İleri yaşta protein ihtiyacı artıyor: 65 yaş üstü için günde 1.0–1.2 g/kg, aktif olanlar için daha fazlası öneriliyor.",
  "s": "Bauer ve ark., 2013 · J Am Med Dir Assoc",
  "d": "10.1016/j.jamda.2013.05.021"
 },
 {
  "c": "Protein",
  "t": "BCAA tek başına kas yapımını en üst düzeye çıkaramaz, bunun için bütün esansiyel aminoasitler gerekir. Yeterli protein alıyorsan BCAA takviyesi gereksiz.",
  "s": "Wolfe ve ark., 2017 · JISSN",
  "d": "10.1186/s12970-017-0184-9"
 },
 {
  "c": "Gıdalar",
  "t": "Günde bir avuç (~28 g) kuruyemiş, kalp-damar hastalığı ve tüm nedenlere bağlı ölüm riskinde yaklaşık %20 düşüşle ilişkili bulundu.",
  "s": "Aune ve ark., 2016 · BMC Med",
  "d": "10.1186/s12916-016-0730-3"
 },
 {
  "c": "Gıdalar",
  "t": "Tam tahıl tüketimi arttıkça kalp hastalığı, kanser ve ölüm riski azalıyor; en büyük fayda günde yaklaşık 90 g civarında görüldü.",
  "s": "Aune ve ark., 2016 · BMJ",
  "d": "10.1136/bmj.i2716"
 },
 {
  "c": "Gıdalar",
  "t": "Dünya Sağlık Örgütü'nün kanser ajansı işlenmiş eti (salam, sucuk, sosis) kanserojen olarak sınıflandırdı. Günlük her 50 g işlenmiş et kolorektal kanser riskini ~%18 artırıyor.",
  "s": "Bouvard ve ark., 2015 · Lancet Oncol",
  "d": "10.1016/s1470-2045(15)00444-1"
 },
 {
  "c": "Gıdalar",
  "t": "Günde 3–4 fincan kahve, birçok sağlık sonucu için zarardan çok faydayla ilişkili bulundu. Hamilelikte ise sınırlandırılmalı.",
  "s": "Poole ve ark., 2017 · BMJ",
  "d": "10.1136/bmj.j5024"
 },
 {
  "c": "Gıdalar",
  "t": "Günde bir yumurtaya kadar tüketim, büyük kohortlarda kalp-damar hastalığı riskinde artışla ilişkili bulunmadı.",
  "s": "Drouin-Chartier ve ark., 2020 · BMJ",
  "d": "10.1136/bmj.m513"
 },
 {
  "c": "Gıdalar",
  "t": "Haftada 1–2 porsiyon yağlı balık, koroner kalp hastalığından ölüm riskinde yaklaşık %36 azalmayla ilişkili. Faydası, cıva gibi risklerden belirgin şekilde büyük.",
  "s": "Mozaffarian ve ark., 2006 · JAMA",
  "d": "10.1001/jama.296.15.1885"
 },
 {
  "c": "Gıdalar",
  "t": "Tuzu birkaç hafta boyunca biraz azaltmak bile kan basıncını anlamlı şekilde düşürüyor.",
  "s": "He ve ark., 2013 · BMJ",
  "d": "10.1136/bmj.f1325"
 },
 {
  "c": "Gıdalar",
  "t": "195 ülkeyi kapsayan analizde sağlık kaybını en aza indiren alkol miktarı sıfır bulundu. \"Az alkol faydalı\" görüşü bu veride desteklenmiyor.",
  "s": "Griswold ve ark., 2018 · Lancet",
  "d": "10.1016/s0140-6736(18)31310-2"
 },
 {
  "c": "Uyku",
  "t": "İki gece 4 saat uyuyan genç erkeklerde tokluk hormonu leptin düştü, açlık hormonu ghrelin arttı, açlık hissi yükseldi. Uykusuzluk diyetini zorlaştırır.",
  "s": "Spiegel ve ark., 2004 · Ann Intern Med",
  "d": "10.7326/0003-4819-141-11-200412070-00008"
 },
 {
  "c": "Uyku",
  "t": "Genç sporcularda gecede 8 saatten az uyuyanların sakatlanma riski yaklaşık 1.7 kat daha yüksek bulundu.",
  "s": "Milewski ve ark., 2014 · J Pediatr Orthop",
  "d": "10.1097/bpo.0000000000000151"
 },
 {
  "c": "Uyku",
  "t": "Basketbolcular uyku süresini gecede ~10 saate çıkarınca sprint süreleri kısaldı, isabet oranları yükseldi.",
  "s": "Mah ve ark., 2011 · Sleep",
  "d": "10.5665/sleep.1132"
 },
 {
  "c": "Uyku",
  "t": "Yatmadan önce ışık yayan ekranda okumak uykuya dalmayı geciktirdi, melatonini baskıladı ve sabah zindeliğini azalttı.",
  "s": "Chang ve ark., 2014 · PNAS",
  "d": "10.1073/pnas.1418490112"
 },
 {
  "c": "Uyku",
  "t": "Alkol uykuya dalmayı kolaylaştırsa da gecenin ikinci yarısında uykuyu bölüyor ve REM uykusunu azaltıyor.",
  "s": "Ebrahim ve ark., 2013 · Alcohol Clin Exp Res",
  "d": "10.1111/acer.12006"
 },
 {
  "c": "Uyku",
  "t": "Direnç egzersizi, randomize çalışmaların incelemesinde uyku kalitesini iyileştirdi.",
  "s": "Kovacevic ve ark., 2018 · Sleep Med Rev",
  "d": "10.1016/j.smrv.2017.07.002"
 },
 {
  "c": "Takviye",
  "t": "Kreatin hakkındaki yaygın endişeler (böbrek hasarı, saç dökülmesi, sadece su tutması) sağlıklı kişilerde bilimsel kanıtla desteklenmiyor.",
  "s": "Antonio ve ark., 2021 · JISSN",
  "d": "10.1186/s12970-021-00412-w"
 },
 {
  "c": "Takviye",
  "t": "Kreatin sadece kas için değil: randomize çalışmalarda özellikle kısa süreli hafıza ve akıl yürütmede küçük iyileşmeler görüldü.",
  "s": "Avgerinos ve ark., 2018 · Exp Gerontol",
  "d": "10.1016/j.exger.2018.04.013"
 },
 {
  "c": "Takviye",
  "t": "Nitrat (pancar suyu gibi) takviyesi dayanıklılık performansında küçük ama anlamlı bir iyileşme sağlıyor.",
  "s": "Senefeld ve ark., 2020 · Med Sci Sports Exerc",
  "d": "10.1249/mss.0000000000002363"
 },
 {
  "c": "Takviye",
  "t": "60–85 yaş arası sağlıklı yetişkinlerde 6 ay balık yağı takviyesi kas kütlesi ve gücünde artış sağladı.",
  "s": "Smith ve ark., 2015 · Am J Clin Nutr",
  "d": "10.3945/ajcn.114.105833"
 },
 {
  "c": "Takviye",
  "t": "Aktiviteden 1 saat önce C vitaminiyle birlikte 15 g jelatin almak, kolajen sentezi göstergesini yaklaşık iki katına çıkardı. Tendon sağlığı için ilgi çekici bir bulgu.",
  "s": "Shaw ve ark., 2017 · Am J Clin Nutr",
  "d": "10.3945/ajcn.116.138594"
 },
 {
  "c": "Antrenman",
  "t": "Isınma işe yarıyor: meta-analizde incelenen performans ölçütlerinin çoğunda ısınma sonrası iyileşme görüldü.",
  "s": "Fradkin ve ark., 2010 · J Strength Cond Res",
  "d": "10.1519/jsc.0b013e3181c643a0"
 },
 {
  "c": "Antrenman",
  "t": "Isınmada kas başına 60 saniyenin altındaki statik esneme performansı belirgin şekilde düşürmüyor, özellikle dinamik ısınmayla birleştirildiğinde.",
  "s": "Behm ve ark., 2016 · Appl Physiol Nutr Metab",
  "d": "10.1139/apnm-2015-0235"
 },
 {
  "c": "Antrenman",
  "t": "Kası \"hissederek\" çalışmak işe yarayabilir: biceps'e odaklanarak çalışanlarda kol kası daha fazla büyüdü; bacakta ise fark görülmedi.",
  "s": "Schoenfeld ve ark., 2018 · Eur J Sport Sci",
  "d": "10.1080/17461391.2018.1447020"
 },
 {
  "c": "Antrenman",
  "t": "Tekrar süresi 0.5 ile 8 saniye arasında olduğunda kas gelişimi benzer. Çok yavaş (10 saniyeden uzun) tekrarlar ise daha az etkili olabilir.",
  "s": "Schoenfeld ve ark., 2015 · Sports Med",
  "d": "10.1007/s40279-015-0304-0"
 },
 {
  "c": "Antrenman",
  "t": "Drop set, geleneksel setlere benzer kas gelişimi sağlıyor ama daha kısa sürede. Vakti kısıtlı olanlar için iyi bir araç.",
  "s": "Sødal ve ark., 2023 · Sports Med Open",
  "d": "10.1186/s40798-023-00620-5"
 },
 {
  "c": "Antrenman",
  "t": "Zaman kazanmak için süper setler, drop setler ve bileşik hareketler kullanılabilir; haftalık hacim korunduğu sürece kazanımlar büyük ölçüde korunuyor.",
  "s": "Iversen ve ark., 2021 · Sports Med",
  "d": "10.1007/s40279-021-01490-1"
 },
 {
  "c": "Antrenman",
  "t": "Serbest ağırlık ve makine, kas gelişiminde benzer sonuç veriyor. Güç ise hangi araçla çalışıyorsan onda daha çok artıyor.",
  "s": "Haugen ve ark., 2023 · BMC Sports Sci Med Rehabil",
  "d": "10.1186/s13102-023-00713-4"
 },
 {
  "c": "Antrenman",
  "t": "Hacim eşit olduğunda periyodizasyonlu programlar güç kazanımında biraz daha üstün, kas gelişiminde ise benzer.",
  "s": "Moesgaard ve ark., 2022 · Sports Med",
  "d": "10.1007/s40279-021-01636-1"
 },
 {
  "c": "Antrenman",
  "t": "Split mi full body mi? Haftalık hacim eşit olduğunda iki yaklaşım da benzer güç ve kas kazanımı sağlıyor. Programı yaşam düzenine göre seç.",
  "s": "Ramos-Campo ve ark., 2024 · J Strength Cond Res",
  "d": "10.1519/jsc.0000000000004774"
 },
 {
  "c": "Antrenman",
  "t": "Kadınlar ve erkekler direnç antrenmanıyla göreceli olarak benzer kas gelişimi sağlıyor; kadınlar üst vücut gücünde göreceli olarak daha fazla ilerleyebiliyor.",
  "s": "Roberts ve ark., 2020 · J Strength Cond Res",
  "d": "10.1519/jsc.0000000000003521"
 },
 {
  "c": "Antrenman",
  "t": "Yaşlı yetişkinlerde direnç antrenmanı ortalama 1 kg'dan fazla yağsız kütle artışı sağladı. Kas kazanmak için geç değil.",
  "s": "Peterson ve ark., 2011 · Med Sci Sports Exerc",
  "d": "10.1249/mss.0b013e3181eb6265"
 },
 {
  "c": "Antrenman",
  "t": "Ertesi gün ağrı (DOMS) iyi bir antrenmanın göstergesi değil. Kas gelişimi ağrı olmadan da gerçekleşir.",
  "s": "Schoenfeld ve ark., 2013 · Strength Cond J",
  "d": "10.1519/ssc.0b013e3182a61820"
 },
 {
  "c": "Antrenman",
  "t": "İlk haftalardaki \"hızlı kas artışı\"nın bir kısmı ödem ve kas hasarına bağlı; gerçek kas büyümesi hasar azaldıkça belirginleşiyor.",
  "s": "Damas ve ark., 2016 · J Physiol",
  "d": "10.1113/jp272472"
 },
 {
  "c": "Antrenman",
  "t": "Ağır antrenmandan sonra kas protein sentezi yaklaşık 36 saat boyunca yüksek kalıyor. Bu, bir kası haftada 2 kez çalışmanın mantığını destekliyor.",
  "s": "MacDougall ve ark., 1995 · Can J Appl Physiol",
  "d": "10.1139/h95-038"
 },
 {
  "c": "Antrenman",
  "t": "Antrenman sonrası hormon yükselmelerinin (testosteron, büyüme hormonu) kas ve güç kazanımıyla ilişkisi bulunmadı. \"Hormon artırmak için\" bacak çalışmak gerekmiyor.",
  "s": "West ve ark., 2011 · Eur J Appl Physiol",
  "d": "10.1007/s00421-011-2246-z"
 },
 {
  "c": "Antrenman",
  "t": "Bölgesel yağ yakımı bir efsane: 12 hafta sadece tek bacağı çalışanlarda yağ kaybı çalışılan bacakta değil, vücudun başka bölgelerinde görüldü.",
  "s": "Ramírez-Campillo ve ark., 2013 · J Strength Cond Res",
  "d": "10.1519/jsc.0b013e31827e8681"
 },
 {
  "c": "Ara vermek",
  "t": "Kısa bir ara (yaklaşık 3 haftaya kadar) güçte belirgin kayba yol açmıyor. Tatil ya da hastalık dönemleri için endişelenme.",
  "s": "Bosquet ve ark., 2013 · Scand J Med Sci Sports",
  "d": "10.1111/sms.12047"
 },
 {
  "c": "Ara vermek",
  "t": "Kazanımları korumak kolay: gençlerde haftada 1 gün ve önceki hacmin 1/9'u, 32 hafta boyunca kas kütlesini korumaya yetti.",
  "s": "Bickel ve ark., 2011 · Med Sci Sports Exerc",
  "d": "10.1249/mss.0b013e318207c15d"
 },
 {
  "c": "Ara vermek",
  "t": "Gücü korumak için haftada 1 seans, hareket başına 1–3 set yeterli olabiliyor; yeter ki yoğunluk korunsun.",
  "s": "Spiering ve ark., 2021 · J Strength Cond Res",
  "d": "10.1519/jsc.0000000000003964"
 },
 {
  "c": "Toparlanma",
  "t": "Köpük rulo, sprint performansında ve esneklikte küçük iyileşmeler, kas ağrısında hafif azalma sağlıyor. Mucize değil ama zararı da yok.",
  "s": "Wiewelhove ve ark., 2019 · Front Physiol",
  "d": "10.3389/fphys.2019.00376"
 },
 {
  "c": "Toparlanma",
  "t": "Spor masajı performansı artırmıyor, ama esnekliği ve kas ağrısını hafifçe iyileştirebiliyor.",
  "s": "Davis ve ark., 2020 · BMJ Open Sport Exerc Med",
  "d": "10.1136/bmjsem-2019-000614"
 },
 {
  "c": "Toparlanma",
  "t": "Yüksek doz ağrı kesici (günde 1.200 mg ibuprofen) 8 hafta boyunca kullanıldığında kas ve güç kazanımını azalttı. Gereksiz yere düzenli kullanma.",
  "s": "Lilja ve ark., 2017 · Acta Physiol",
  "d": "10.1111/apha.12948"
 },
 {
  "c": "Kardiyo",
  "t": "HIIT ve sürekli kardiyo, ikisi de maksimal oksijen kapasitesini (VO2max) artırıyor; HIIT biraz daha etkili ve daha kısa sürüyor.",
  "s": "Milanović ve ark., 2015 · Sports Med",
  "d": "10.1007/s40279-015-0365-0"
 },
 {
  "c": "Kardiyo",
  "t": "Kardiyorespiratuvar kondisyon arttıkça ölüm riski düşüyor ve bu ilişkide bir üst sınır bulunmadı.",
  "s": "Mandsager ve ark., 2018 · JAMA Netw Open",
  "d": "10.1001/jamanetworkopen.2018.3605"
 },
 {
  "c": "Kardiyo",
  "t": "Uzun oturmayı kısa yürüyüşlerle bölmek, yemek sonrası kan şekeri ve insülini düşürüyor. Yemekten sonra 10 dakika yürümek iyi bir alışkanlık.",
  "s": "Buffey ve ark., 2022 · Sports Med",
  "d": "10.1007/s40279-022-01649-4"
 },
 {
  "c": "Kardiyo",
  "t": "Kan basıncını düşürmede en etkili egzersiz türü izometrik çalışma çıktı (duvarda oturma, plank gibi).",
  "s": "Edwards ve ark., 2023 · Br J Sports Med",
  "d": "10.1136/bjsports-2022-106503"
 },
 {
  "c": "Sağlık",
  "t": "Kavrama gücü sağlığın iyi bir göstergesi: 17 ülkede yapılan çalışmada her 5 kg düşük kavrama gücü tüm nedenlere bağlı ölüm riskinde ~%16 artışla ilişkiliydi.",
  "s": "Leong ve ark., 2015 · Lancet",
  "d": "10.1016/s0140-6736(14)62000-6"
 },
 {
  "c": "Ruh sağlığı",
  "t": "Egzersiz depresif belirtileri azaltmada etkili bulundu; etki gözetimli ve orta yoğunluktaki programlarda daha belirgin.",
  "s": "Heissel ve ark., 2023 · Br J Sports Med",
  "d": "10.1136/bjsports-2022-106282"
 },
 {
  "c": "Ruh sağlığı",
  "t": "Direnç antrenmanı, randomize çalışmaların meta-analizinde kaygı belirtilerini anlamlı şekilde azalttı.",
  "s": "Gordon ve ark., 2017 · Sports Med",
  "d": "10.1007/s40279-017-0769-0"
 },
 {
  "c": "Ruh sağlığı",
  "t": "Direnç antrenmanı, sağlık durumundan ve antrenman hacminden bağımsız olarak depresif belirtilerde azalmayla ilişkili bulundu.",
  "s": "Gordon ve ark., 2018 · JAMA Psychiatry",
  "d": "10.1001/jamapsychiatry.2018.0572"
 }
];
