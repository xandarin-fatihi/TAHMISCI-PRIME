# Revision Log

Tarih: 2026-07-03

Revize edilen alan: Menu cikti araci sekmeli premium editor arayuzu ve Tahmisci figur ikon entegrasyonu

Degisen dosyalar:

- `preview/menu-output-tool/index.html`
- `preview/menu-output-tool/menu-output-tool.css`
- `preview/menu-output-tool/menu-output-tool.js`
- `docs/menu-output-tool.md`
- `docs/revision-log.md`

Ne degisti:

Menu cikti araci hedef referans ekrana yakin sekmeli iki kolonlu editor duzenine alindi. Sol panel `Stil`, `Alanlar`, `Logo`, `Katmanlar`, `Cikti` sekmelerine ayrildi. Sag preview paneline canli onizleme basligi, durum etiketi, cihaz gorunumu ve zoom araclari eklendi. Logo sekmesine mevcut Tahmisci figur assetinden uretilen ikon secenegi, fiyat ikonu yapma ve watermark ekleme kisa yollari eklendi. Metin ikon sistemi gorsel ikonlari da render/export edebilecek sekilde genisletildi.

Neden degisti:

Kontrol panelinin okunabilirligini artirmak, referans premium editor hissini yakalamak ve logo figürünü fiyat ikonlari/watermark icin tekrar kullanilabilir hale getirmek icin.

Sisteme etkisi:

Canli panel, backend, remote ve deployment akislari etkilenmez. Degisiklik sadece yerel demo menu cikti araci ve dokumantasyonla sinirlidir. Otomatik commit veya push yapilmadi.

Test notlari:

Bundled Node ile `menu-output-tool.js` soz dizimi kontrolu temiz gecti. Chrome headless ekran goruntusu ile sekmeli arayuz ve canli preview render edildi. JSON/export ve figür ikon butonlari tarayicida manuel olarak da kontrol edilmelidir.

Dikkat edilmesi gerekenler:

Tahmisci figür ikonu mevcut asset dosyasina baglidir. Bu dosya yolu degisirse ikon secenegi guncellenmelidir. SVG icinde harici/yerel image referanslari PNG export tarafinda tarayici kisitlarina bagli davranabilir.

---

Tarih: 2026-07-06

Revize edilen alan: Menü Çıktısı Faz 1.1 stabilizasyon

Değişen dosyalar:

- `index.html/panel/index.html`
- `index.html/panel/panel.css`
- `index.html/panel/panel.js`
- `docs/menu-output-tool.md`
- `docs/codex-worklog-menu-output.md`
- `docs/revision-log.md`

Ne değişti:

Taşma kapasitesi alan geometrisi ve tipografi değerlerine bağlandı. Tam ekran API reddi yakalandı ve tam ekran durumu düğmeye bağlandı. Export öncesi eksik veri, taşma ve küçük punto uyarıları eklendi. Eski şablonların yeni alanlar olmadan açılması korundu.

Neden değişti:

Faz 1 sonrasında kalan yanlış taşma sayısı, sessiz tam ekran hatası ve kontrolsüz export risklerini gidermek.

Sisteme etkisi:

Yalnız Menü Çıktısı alanı etkilenir. Export uyarıları bilgi amaçlıdır ve çıktı almayı engellemez. Eski şablon state yapısı geriye uyumlu kalır.

Test notları:

30 ürünlü ana alanda 64 px punto/90 px satır aralığıyla 10 ürün kapasitesi ve 20 taşan ürün; 12 px punto/10 px satır aralığıyla 30 ürün kapasitesi doğrulandı. Eski şablon defaults, tam ekran reddi uyarısı, export ön kontrolü, JavaScript sözdizimi ve `₺` gösterimi kontrol edildi.

Dikkat edilmesi gerekenler:

Başarılı tam ekran giriş/çıkışı tarayıcı izin politikasına bağlıdır. Özel yerel fontların indirilen PNG/JPG dosyasındaki görünümü normal Chrome üzerinde manuel karşılaştırılmalıdır.

---

Tarih: 2026-07-03

Revize edilen alan: Menu cikti araci fiyat ikon hizasi

Degisen dosyalar:

- `preview/menu-output-tool/menu-output-tool.css`
- `docs/revision-log.md`

Ne degisti:

Canli onizlemede fiyat ikonlari ile fiyat kolonlari ayni grid hesabina baglandi. Coklu fiyat satirlarinda fiyat metinleri kolon merkezine hizalandi.

Neden degisti:

Kahve ikonlari fiyat kolonlarinin ustunde sola kaymis gorunuyordu.

Sisteme etkisi:

Sadece yerel menu cikti araci onizleme hizasi etkilenir. Backend, panel ve menu verisi degismez.

Test notlari:

CSS degisikligi sonrasi Chrome headless ekran goruntusu ile onizleme tekrar kontrol edilmelidir.

Dikkat edilmesi gerekenler:

Tek fiyatli satirlarda sag hizalama korunur; degisiklik coklu fiyat kolonlari icindir.

---

Tarih: 2026-07-03

Revize edilen alan: Menu cikti araci gorsel, watermark, katman ve JSON tasarim sistemi

Degisen dosyalar:

- `preview/menu-output-tool/index.html`
- `preview/menu-output-tool/menu-output-tool.css`
- `preview/menu-output-tool/menu-output-tool.js`
- `docs/menu-output-tool.md`
- `docs/revision-log.md`

Ne degisti:

Menu cikti aracina PNG, JPG, WEBP ve SVG gorsel yukleme eklendi. Eklenen gorseller canvas uzerinde secilebilir, suruklenebilir, yeniden boyutlandirilabilir, dondurulebilir ve kilitlenebilir hale getirildi. Watermark/logo secimi, katman listesi, one/arkaya alma, en uste/en alta alma ve JSON disa/ice aktarma akisi eklendi. SVG/PNG export, eklenen gorsel katmanlarini da ciktıya dahil edecek sekilde genisletildi.

Neden degisti:

Yerel menu cikti aracinin sadece kategori kutulari ureten bir onizleme yerine logolu, katmanli ve tasarimi tasinabilir bir editor gibi kullanilabilmesi icin.

Sisteme etkisi:

Canli panel, backend ve menu verisi etkilenmez. Degisiklik yerel preview araci ve dokumantasyonla sinirlidir.

Test notlari:

Bundled Node ile `menu-output-tool.js` soz dizimi kontrolu temiz gecti. Tarayici uzerinden gorsel yukleme, handle ile secim/surukleme/boyutlandirma, katman paneli, JSON butonlari ve export akisi ayrica dogrulanmalidir.

Dikkat edilmesi gerekenler:

Yuklenen gorseller JSON icinde data URL olarak tutulur; buyuk gorseller JSON dosyasini buyutebilir. SVG icinde dis kaynak kullanan gorseller PNG export tarafinda tarayici kisitlarina takilabilir.

---

Tarih: 2026-07-02

Revize edilen alan: Menu cikti araci font, tarih ve canli alan kaydirma duzenlemesi

Degisen dosyalar:

- `preview/menu-output-tool/index.html`
- `preview/menu-output-tool/menu-output-tool.css`
- `preview/menu-output-tool/menu-output-tool.js`
- `docs/menu-output-tool.md`
- `docs/revision-log.md`

Ne degisti:

Font secimleri `index.html/Tahmisci_Logo/Fontlar` klasorundeki Poppins ve Magnolia font dosyalarindan yuklenecek hale getirildi. Alanlara X/Y kaydirma, alan bazli punto ve konum sifirlama kontrolleri eklendi. Onizleme uzerinde alan surukleme destegi eklendi. Tarih alani alt-orta konuma sabitlendi ve render/export sirasinda guncel tarihle otomatik doldurulur.

Neden degisti:

Menu cikti demosunun canli duzenleme araci gibi kullanilabilmesi, font seciminin mevcut marka fontlarina baglanmasi ve cikti tarihinin manuel unutulmadan guncel kalmasi icin.

Sisteme etkisi:

Canli panel, backend ve menu verisi etkilenmez. Degisiklik yerel preview araci ve dokumantasyonla sinirlidir.

Test notlari:

Node soz dizimi kontrolu temiz gecti. Chrome uzerinden font secenekleri, guncel tarih, alan surukleme sinirlari, cakisma kontrolu ve PNG export dogrulandi.

Dikkat edilmesi gerekenler:

Bu ortamda font klasorunde 19 font dosyasi goruldu. Klasorde beklenen ek fontlar varsa dosyalar eklendiginde font listesi genisletilmelidir. Cok agresif kaydirma isteklerinde yerlesim hesaplayici alanlari sinir icinde tutar ancak tasarim dengesini manuel kontrol etmek gerekir.

---

Tarih: 2026-07-02

Revize edilen alan: Menu cikti araci yerlesim ve cikti alma duzeltmesi

Degisen dosyalar:

- `preview/menu-output-tool/index.html`
- `preview/menu-output-tool/menu-output-tool.css`
- `preview/menu-output-tool/menu-output-tool.js`
- `docs/menu-output-tool.md`
- `docs/revision-log.md`

Ne degisti:

Menu cikti demosunda sabit pozisyonlu blok yerlesimi otomatik kenar yerlesimiyle degistirildi. Sol baslik sol kenara, ana liste sag kenara, alt kategori sol alt kenara, sag/extra kartlar sag kenara oturacak sekilde hesaplama eklendi. Urun sayisina gore alan icinde punto ve satir araligi otomatik hesaplanir. PNG ve SVG indirme butonlari eklendi. Cikti alma HTML kopyasi yerine saf SVG vektor cizimine alindi.

Neden degisti:

Yeni alanlar eklendiginde bloklarin ust uste binmesini engellemek ve demo aracindan gercek cikti alinabilmesini saglamak icin.

Sisteme etkisi:

Canli panel, backend ve mevcut menu verisi etkilenmez. Degisiklik sadece yerel preview araci ve dokumantasyonla sinirlidir.

Test notlari:

Demo JS dosyasi icin Node soz dizimi kontrolu calistirilmalidir. PNG/SVG indirme davranisi tarayicida manuel dogrulanmalidir.

Dikkat edilmesi gerekenler:

Cok uzun urun adlari ve cok fazla urun secimi icin minimum punto sinirina gelindiginde tasarim secimi tekrar degerlendirilmelidir. PDF export henuz yoktur.

---

Tarih: 2026-07-02

Revize edilen alan: Menu cikti araci yerel demo onizlemesi

Degisen dosyalar:

- `preview/menu-output-tool/index.html`
- `preview/menu-output-tool/menu-output-tool.css`
- `preview/menu-output-tool/menu-output-tool.js`
- `preview/menu-output-tool/mock-menu-data.js`
- `docs/menu-output-tool.md`
- `docs/revision-log.md`

Ne degisti:

Canli panele entegre edilmeden ayri bir yerel demo klasoru olusturuldu. Demo, mevcut menu verisini okuyarak 1080x1920 dikey TV menu onizlemesi uretir; veri okunamazsa mock veri kullanir. Alan ekleme, kategori/manual urun secimi, ikon katalogu, cerceve/dekor secimi ve canli onizleme ayarlari eklendi.

Neden degisti:

Menu cikti modulunun canli panele uygulanmadan once kontrollu sekilde taslak olarak incelenmesi icin.

Sisteme etkisi:

Fonksiyonel canli panel, backend, recipe veya admin akislarina etkisi yoktur. Degisiklikler preview klasoru ve dokumantasyonla sinirlidir.

Test notlari:

Demo JS dosyasi icin Node soz dizimi kontrolu temiz gecti. Gorsel tarayici testi manuel olarak HTML dosyasi acilarak yapilmalidir.

Dikkat edilmesi gerekenler:

Gercek panele entegrasyon yapilmadan once tasarim secimi, tasan urun listeleri, uzun kategori adlari ve export kalite ihtiyaci ayrica netlestirilmelidir.

---

Tarih: 2026-07-02

Revize edilen alan: Admin ve recipe oturum suresi, oturum yenileme, 30 saniye uyarisi, 401/403 hata yonetimi

Degisen dosyalar:

- `index.html/backend/.env.example`
- `index.html/backend/src/config.js`
- `index.html/backend/src/middleware/auth.js`
- `index.html/backend/src/server.js`
- `index.html/panel/index.html`
- `index.html/panel/panel.js`
- `index.html/panel/panel.css`
- `index.html/recete/index.html`
- `index.html/recete/recete.js`
- `index.html/recete/recete.css`
- `docs/admin-user-authorization.md`
- `docs/recipe-access-system.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne degisti:

Admin ve recipe session varsayilani 10 dakikaya alindi. `ADMIN_SESSION_MINUTES` ve `RECIPE_SESSION_MINUTES` env destekleri eklendi. `GET /api/admin/me` ve `GET /api/recipe/me` cevaplari `expiresAt` ve `ttlSeconds` dondurur. `POST /api/admin/session/refresh` ve `POST /api/recipe/session/refresh` endpointleri eklendi. Panel ve recete arayuzlerinde bitime 30 saniye kala uyarı, oturum yenileme ve cikis akisi eklendi. POST/PUT/DELETE isteklerinde sure dolmussa islem baslamadan engellenir; 401/403 cevaplari artik sessiz kalmaz.

Neden degisti:

Oturum suresi doldugunda kullanicinin kaydetme yapabiliyor gibi gorunmesini ve veri kaydedilmemesini engellemek icin.

Sisteme etkisi:

Gecerli oturum 10 dakika surer ve kullanici sure bitmeden yenileyebilir. Pasif veya silinmis recipe kullanicisi refresh yapamaz. Sure doldugunda frontend token/session temizler ve tekrar giris ister.

Test notlari:

Node soz dizimi kontrolleri calistirildi. Frontend session modal renderi ve endpoint davranisi yerel tarayici/canli veriyle manuel uc uca dogrulanmalidir.

Dikkat edilmesi gerekenler:

Canli sunucuda `.env` icinde `ADMIN_SESSION_MINUTES=10` ve `RECIPE_SESSION_MINUTES=10` eklenmeli veya guncellenmeli. Eski `JWT_EXPIRES_IN` farkli bir degerdeyse spesifik iki yeni env degeriyle 10 dakika garanti edilmelidir.

---

Tarih: 2026-07-01

Revize edilen alan: Kullanici yetkilendirme, egitim/odev/sinav programlari, aktivite kayit defteri, kalici silme

Degisen dosyalar:

- `index.html/backend/src/server.js`
- `index.html/backend/src/store/file-store.js`
- `index.html/panel/index.html`
- `index.html/panel/panel.js`
- `index.html/panel/panel.css`
- `index.html/recete/index.html`
- `index.html/recete/recete.js`
- `index.html/recete/recete.css`
- `docs/admin-user-authorization.md`
- `docs/task-assignment-system.md`
- `docs/recipe-access-system.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne degisti:

Tek urun odev modeli `quick_quiz`, `training`, `homework`, `exam`, `retraining` program modeline genisletildi. Kapsam icin `all`, `category`, `products`, `failed_items` eklendi. Olcu sorusu uretimi kaldirildi; olcu sadece soru baglami olarak kullaniliyor. Admin panelde coklu urun secimi, soru sayisi, zorluk, kapsam ve yeni kayit defteri alanlari eklendi. Barista tarafinda Egitimlerim, Odevlerim ve Sinavlarim ayrimi yapildi. Kalici silme endpointi ve UI onayi eklendi.

Neden degisti:

Baristalara daha kontrollu egitim, calisma odevi ve sinav atamak; eski kayitlari koruyarak kullanici yetkisini daha net yonetmek icin.

Sisteme etkisi:

Mevcut `recipeUsers`, `recipeAssignments` ve `recipeActivity` kayitlari silinmez. Eski tek urun kayitlari geriye uyumlu sekilde `quick_quiz` benzeri akista calisir. Pasif veya kalici silinen kullanici eski token ile recipe API kullanamaz.

Test notlari:

Node soz dizimi kontrolleri `server.js`, `file-store.js`, `panel.js`, `recete.js`, `config.js`, `auth.js`, `validators.js`, `ecosystem.config.cjs` ve browser client dosyasi icin temiz gecti. Yasak olcu sorusu metinleri kaynakta aranip bulunmadi. `git diff --check` bosluk hatasi vermedi. Yerel ortamda `npm` ve `node_modules` bulunmadigi icin `npm run check` dogrudan calistirilmadi. Canli backend store ve tarayici oturumu ile uc uca test yapilmadi.

Dikkat edilmesi gerekenler:

Canli deploy oncesi store yedegi alinmali. Deploy sonrasi yeni program atama, odev ilerlemesi, sinav skoru, pasiflestirme ve kalici silme canli veriyle kontrol edilmeli.

---

Tarih: 2026-06-30

Revize edilen alan: Kullanici yetkilendirme, odev kayit defteri, aktivite kayit defteri, recete egitim programi

Degisen dosyalar:

- `index.html/backend/src/server.js`
- `index.html/backend/src/store/file-store.js`
- `index.html/panel/index.html`
- `index.html/panel/panel.js`
- `index.html/panel/panel.css`
- `index.html/recete/index.html`
- `index.html/recete/recete.js`
- `index.html/recete/recete.css`
- `docs/admin-user-authorization.md`
- `docs/task-assignment-system.md`
- `docs/recipe-access-system.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne degisti:

Barista pasiflestirme/tekrar aktif etme akisi netlestirildi. Pasif kullanicinin eski token ile recipe API erisimi aktif store kontrolune baglandi. Odev sistemi `quiz`, `training_quiz`, `retraining`, gecme puani, egitim icerigi, admin notu ve `retry_required` durumlariyla genisletildi. Admin panelde odev ve aktivite listeleri kayit defteri gorunumune alindi. Recete tarafinda egitim + test akisi eklendi.

Neden degisti:

Mevcut sistemi bozmadan barista yetkisini yonetmek, odev takibini okunabilir hale getirmek ve egitim programi akisini admin paneline baglamak icin.

Sisteme etkisi:

Mevcut kullanici, gorev ve aktivite kayitlari silinmez. Eski assignment kayitlari eksik yeni alanlar icin varsayilan degerlerle normalize edilir. Pasif kullanicilar yeni giris yapamaz ve aktiflik kontrolunden gecemeyen recipe istekleri reddedilir.

Test notlari:

Node soz dizimi kontrolleri `server.js`, `file-store.js`, `panel.js`, `recete.js`, `config.js`, `auth.js`, `validators.js`, `ecosystem.config.cjs` ve browser client dosyasi icin temiz gecti. `npm` bu yerel ortamda bulunmadigi icin `npm run check` dogrudan calistirilamadi; scriptteki kontroller manuel Node komutlariyla calistirildi. Ek store normalizasyon runtime testi yerel `bcryptjs` bagimliligi bulunmadigi icin calistirilamadi.

Dikkat edilmesi gerekenler:

Canli deploy oncesi `store.json` yedegi alinmali. Deploy sonrasi aktif/pasif kullanici, eski token reddi, egitim + test ve `retry_required` senaryolari tarayicida canli veriyle denenmeli.

---

Tarih: 2026-06-30

Revize edilen alan: Dokumantasyon altyapisi

Degisen dosyalar:

- `docs/recipe-access-system.md`
- `docs/task-assignment-system.md`
- `docs/admin-user-authorization.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne degisti:

Recete erisimi, admin kullanici yetkilendirme, barista login akisi, gorev atama sistemi ve sistem haritasi icin dokumantasyon olusturuldu.

Neden degisti:

Sonraki kod revizelerinin kontrollu yapilmasi ve mevcut davranisin kayit altina alinmasi icin.

Sisteme etkisi:

Fonksiyonel kod degismedi. Sadece `/docs` altinda dokumantasyon eklendi.

Test notlari:

Kod testi gerekmedi.

Dikkat edilmesi gerekenler:

Bundan sonraki her fonksiyonel revizede ilgili dokuman ve `revision-log.md` guncellenmelidir. Hassas bilgiler dokumanlara acik yazilmamalidir.

---

Tarih: 2026-07-04

Revize edilen alan: Excel recete aktarimi ve Menu Ciktisi entegrasyonu

Degisen dosyalar:

- `index.html/backend/package.json`
- `index.html/backend/src/server.js`
- `index.html/backend/src/store/file-store.js`
- `index.html/backend/src/validators.js`
- `index.html/panel/index.html`
- `index.html/panel/panel.js`
- `index.html/panel/panel.css`
- `index.html/recete/recete.js`
- `docs/excel-import-system.md`
- `docs/menu-output-tool.md`
- `docs/recipe-access-system.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne degisti:

Recete Duzenleme alanina Excel'den aktarim arayuzu eklendi. Backend Excel dosyasini okuyup kategori, urun adi ve olcu anahtariyla mevcut recete verisini karsilastirir, degisen kayitlari gunceller, yeni kayitlari ekler, hatali satirlari raporlar ve aktarim oncesi yedek olusturur. Recete alanlari icerik, genel hazirlanis, olcekli hazirlanis, olceksiz hazirlanis, not, aktif ve siralama olacak sekilde genisletildi. Admin panele Menu Ciktisi sekmesi eklendi; canli menu verisiyle alan ekleme, manuel ikon secimi, sablon kutuphanesi, Canva referans linki ve PNG/JPG/PDF cikti akisi hazirlandi.

Neden degisti:

Recete verilerini Excel ile kontrollu guncellemek ve TV menu ciktisini admin panelden uretebilmek icin.

Sisteme etkisi:

Mevcut recete verisi tamamen silinmez; sadece degisen kayitlar guncellenir. Bos Excel hucreleri mevcut veriyi silmez, `BOSALT`/`BOŞALT` ozel degeri alan temizler. Menu Ciktisi mevcut menu yonetimini bozmaz; ayarlar `menuState.settings.menuOutput` altinda tutulur.

Test notlari:

Node soz dizimi kontrolleri `index.html/panel/panel.js`, `index.html/recete/recete.js` ve `index.html/backend/src/server.js` icin temiz gecti. Excel aktarimi icin sunucuda `npm install --omit=dev` sonrasi `xlsx` paketinin kurulmasi gerekir. Tarayici uzerinden gercek Excel dosyasi ve export indirme akisi canli veriyle ayrica dogrulanmalidir.

Dikkat edilmesi gerekenler:

Canli deploy oncesi store yedegi alinmali. Excel kolon adlari standart dokumana uygun olmali. PDF export tarayici yazdirma penceresine baglidir. Menu Ciktisi sablonlari menu state icinde saklandigi icin state/store yedegi onemlidir.

---

Tarih: 2026-07-04

Revize edilen alan: Panel ve recete karakter kodlamasi

Degisen dosyalar:

- `index.html/panel/index.html`
- `index.html/panel/panel.js`
- `index.html/recete/index.html`
- `index.html/recete/recete.js`
- `preview/menu-output-tool/menu-output-tool.js`
- `docs/revision-log.md`

Ne degisti:

Panel ve recete arayuzunde mojibake olarak gorunen Turkce metinler UTF-8 karsiliklariyla duzeltildi. Panel ve recete CSS/JS surum etiketleri yenilendi.

Neden degisti:

Canli panelde `Menu`, `Genel Bakis`, `Recete`, `Urun` gibi Turkce metinler yanlis karakterlerle gorunuyordu.

Sisteme etkisi:

Fonksiyonel akis degismedi. Sadece gorunen metinler, asset yol metinleri ve tarayici onbellek kirici surum etiketi duzeltildi.

Test notlari:

Mojibake karakter aramasi temiz gecti. `panel.js`, `recete.js` ve demo menu output JS dosyasi Node soz dizimi kontrolunden gecti.

Dikkat edilmesi gerekenler:

Deploy sonrasi tarayicida normal yenileme yeterli olmali; eski cache kalirsa Ctrl+F5 ile kontrol edilmeli.

---

Tarih: 2026-07-05

Revize edilen alan: Recete alan sadeleştirme ve Excel import uyumlulugu

Degisen dosyalar:

- `index.html/backend/src/server.js`
- `index.html/backend/src/store/file-store.js`
- `index.html/panel/index.html`
- `index.html/panel/panel.js`
- `index.html/recete/index.html`
- `index.html/recete/recete.js`
- `index.html/recete/recete.css`
- `docs/excel-import-system.md`
- `docs/recipe-access-system.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne degisti:

Recete yapisi `Icerik`, `Hazirlanisi` ve opsiyonel `Urun Notu` alanlarina sadelestirildi. Eski olcekli/olceksiz/aciklama alanlari import ve normalizasyon sirasinda tek hazirlanis alanina birlestirilecek sekilde geriye uyumlu hale getirildi. Icerikteki olcu ifadeleri guvenli sekilde temizlenir, eski olculu metin hazirlanisa eklenir.

Neden degisti:

Admin panel ve barista recete ekrani gereksiz sekmelerden arindirilarak daha sade ve pratik hale getirildi.

Sisteme etkisi:

Mevcut veriler silinmez. Eski kayitlar okunurken normalize edilir. Excel import artik `Kategori`, `Urun Adi`, `Olcu`, `Icerik`, `Hazirlanisi`, `Urun Notu`, `Aktif`, `Siralama` kolonlarini ana standart olarak kabul eder.

Test notlari:

Node soz dizimi kontrolleri backend, store, panel ve recete JS dosyalari icin calistirildi. Tarayicida gercek Excel dosyasi ile import raporu ve barista modal gorunumu canli veride ayrica dogrulanmalidir.

Dikkat edilmesi gerekenler:

Olcu temizleme kurali metin bazli calisir; cok istisnai malzeme adlari manuel kontrol gerektirebilir. Canli deploy oncesi store yedegi alinmalidir.

---

Tarih: 2026-07-05

Revize edilen alan: UI Türkçe yazım ve karakter kodlaması temizliği

Değişen dosyalar:

- `index.html/panel/index.html`
- `index.html/panel/panel.js`
- `index.html/recete/index.html`
- `index.html/recete/recete.js`
- `preview/menu-output-tool/index.html`
- `preview/menu-output-tool/menu-output-tool.js`
- `docs/revision-log.md`

Ne değişti:

Panel, reçete ve Menü Çıktısı ekranlarındaki bozuk karakterler ile ASCII Türkçe metinler düzeltildi. Fiyatlar tek ve güvenli `\u20BA` Türk lirası sembolüyle biçimlendirildi.

Neden değişti:

UTF-8 metinlerin tarayıcıda ve çıktı önizlemesinde hatasız görünmesi sağlandı.

Sisteme etkisi:

Yalnızca görünür metinler ve fiyat sembolü normalizasyonu değişti; veri akışı, yerleşim ve iş kuralları korunmuştur.

Test notları:

JavaScript sözdizimi, bozuk karakter taraması ve yerel tarayıcıda panel, reçete ve Menü Çıktısı ekranlarının UTF-8 görünümü kontrol edildi. Menü önizlemesinde fiyatlar `185₺` biçiminde doğrulandı.

Dikkat edilmesi gerekenler:

Canlıya alındıktan sonra eski tarayıcı önbelleği nedeniyle önceki metinler görünürse Ctrl+F5 ile yenilenmelidir.

---

Tarih: 2026-07-05

Revize edilen alan: Excel kategorilerine bağlı reçete grup giriş ekranı

Değişen dosyalar:

- `index.html/recete/index.html`
- `index.html/recete/recete.js`
- `index.html/recete/recete.css`
- `docs/recipe-access-system.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne değişti:

Barista girişinden sonra dinamik beş kartlı reçete merkezi eklendi. Sıcak, soğuk, special, demleme ve hazırlık ayrımları canlı kategori adlarından türetiliyor. Sıcak ve soğuk gruplarında filtrelenmiş kategori sekmeleri, special seçimlerinde sekmesiz doğrudan ürün listesi kullanılıyor.

Neden değişti:

Excel dosyasındaki kategori düzenini arayüzün ana navigasyonu yapmak ve baristanın reçeteye daha hızlı ulaşmasını sağlamak.

Sisteme etkisi:

Mevcut API, arama, reçete kartı, modal, oturum ve görev akışları korunmuştur. Backend veri şeması değişmemiştir.

Test notları:

`TAHMISCI_RECETE.xlsx` içindeki 296 satırla yerel API testi yapıldı. Sıcak grup 3 kategori/32 ürün, soğuk grup 3 kategori/30 ürün, special grupları 13 ve 25 ürün, demlemeler 2 ürün, hazırlık 5 ürün olarak doğrulandı. Masaüstü ve 390 px mobil sınırlarında yatay taşma olmadığı kontrol edildi. Arama ve İçerik/Hazırlanışı modalı çalıştı.

Dikkat edilmesi gerekenler:

Canlı sunucudaki `recipeState` verisinin güncel Excel dosyasıyla admin paneldeki Excel aktarımı üzerinden eşitlenmesi gerekir. Tanınmayan yeni kategori adları ana grup kartlarında görünmez; yeni bir grup eklenirse sınıflandırma kuralı güncellenmelidir.

---

Tarih: 2026-07-05

Revize edilen alan: Excel reçete aktarımı ve Tahmisci Specialler navigasyonu

Değişen dosyalar:

- `index.html/backend/src/server.js`
- `index.html/backend/src/store/file-store.js`
- `index.html/panel/panel.js`
- `index.html/recete/index.html`
- `index.html/recete/recete.js`
- `index.html/recete/recete.css`
- `docs/excel-import-system.md`
- `docs/recipe-access-system.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne değişti:

Excel İçerik ve Hazırlanış hücrelerinin otomatik temizlenmesi ve birleştirilmesi kaldırıldı. Dolu hücreler kendi alanına birebir aktarılıyor; boş hücre mevcut veriyi koruyor, `BOŞALT` hedef alanı temizliyor. Specialler ana kartı artık iki büyük kartlı ara seçim ekranını açıyor.

Neden değişti:

Excel dosyasını ana veri kaynağı olarak kayıpsız kullanmak ve sıcak/soğuk Special reçetelerini net iki aşamalı akışla ayırmak.

Sisteme etkisi:

Mevcut kayıtlar silinmez. Admin reçete formu İçerik, Hazırlanışı ve Ürün Notu alanlarını korur. Barista modalı yalnız İçerik ve Hazırlanışı sekmelerini kullanır; ürün notu ayrı gösterilir.

Test notları:

Gerçek `TAHMISCI_RECETE.xlsx` ile 296 satır aktarıldı; 296 yeni kayıt, 0 hata doğrulandı. İlk İçerik ve Hazırlanış hücreleri birebir karşılaştırıldı. Boş hücre koruması, `BOŞALT`, otomatik yedek, beşli ana ekran ve grup sayıları kontrol edildi.

Dikkat edilmesi gerekenler:

Canlı aktarım öncesi sunucu paketleri kurulmalı ve aktarım raporu kontrol edilmelidir. Tarayıcı etkileşim sürücüsü Special kartı tıklamasında bekleme hatası verdiği için iki aşamalı tıklama canlı tarayıcıda manuel olarak da gözlenmelidir.
Tarih: 2026-07-06

Revize edilen alan: Menü Çıktısı Faz 1

Değişen dosyalar:

- `index.html/panel/index.html`
- `index.html/panel/panel.css`
- `index.html/panel/panel.js`
- `docs/menu-output-tool.md`
- `docs/revision-log.md`

Ne değişti:

Export font ve fiyat biçimi önizlemeyle eşitlendi. Zoom, sığdırma ve tam ekran kontrolleri; alan kopyalama, gizleme ve kilitleme; taşma ve eksik veri uyarıları; 9:16 şablon önizleme kartları ve otomatik export dosya adı eklendi. Şablon kaydında state referansının yenilenmesi nedeniyle oluşan kayıt sorunu giderildi.

Neden değişti:

Menü Çıktısı ekranını mevcut mimariyi değiştirmeden daha güvenli ve profesyonel bir editör haline getirmek.

Sisteme etkisi:

Değişiklikler yalnız Menü Çıktısı alanıyla sınırlıdır. Eski şablonlar yeni görünürlük ve kilit alanları olmadan açılmaya devam eder.

Test notları:

JavaScript sözdizimi ve Git diff bütünlüğü kontrol edildi. Yerel tarayıcıda alan kopyalama, gizleme, kilitleme, taşma/eksik veri rozetleri, zoom, şablon kaydetme ve 9:16 küçük önizleme doğrulandı. Fiyatların `185₺` biçiminde gösterildiği kontrol edildi.

Dikkat edilmesi gerekenler:

Tam ekran özelliği otomasyon tarayıcısında izin politikası nedeniyle açılamadı; normal Chrome üzerinde manuel kontrol edilmelidir. Özel yerel fontların PNG/JPG çıktısındaki görünümü canlı tarayıcıda bir kez karşılaştırılmalıdır.

---

Tarih: 2026-07-07

Revize edilen alan: Menü Çıktısı Final Faz

Değişen dosyalar:

- `index.html/panel/index.html`
- `index.html/panel/panel.css`
- `index.html/panel/panel.js`
- `docs/menu-output-tool.md`
- `docs/codex-worklog-menu-output.md`
- `docs/revision-log.md`

Ne değişti:

Menü Çıktısı önizlemesinde alan seçme, sürükleme, resize tutamaçları, 8 px snap, grid, güvenli TV alanı, hizalama çizgileri ve katman paneli eklendi. Alan geometri değerleri panelden düzenlenebilir hale getirildi. Export öncesi kalite kontrol paneli eksik veri, taşma, küçük punto ve okunabilirlik risklerini gösterir hale getirildi.

Neden değişti:

Menü Çıktısı ekranını mevcut yapıyı bozmadan mini TV menü tasarım editörü seviyesine yaklaştırmak.

Sisteme etkisi:

Değişiklikler yalnız Menü Çıktısı alanıyla sınırlıdır. Eski şablonlar yeni geometri, görünürlük, kilit ve katman alanları olmadan açılmaya devam eder.

Test notları:

JavaScript söz dizimi ve diff bütünlüğü kontrol edildi. Yerel tarayıcıda eski şablon açma, alan seçme, sürükleme, resize, kilitleme, gizleme, katman paneli, kalite paneli ve PNG export uyarısı doğrulandı. Fiyat sembolünün `₺` biçiminde göründüğü kontrol edildi.

Dikkat edilmesi gerekenler:

Tam ekran izni ve indirilen PNG/JPG dosyalarında özel font görünümü normal Chrome üzerinde manuel olarak karşılaştırılmalıdır.

---

Tarih: 2026-07-10

Revize edilen alan: Ürün Düzenleme Excel aktarımı

Değişen dosyalar:

- `index.html/backend/src/server.js`
- `index.html/panel/index.html`
- `index.html/panel/panel.js`
- `docs/product-excel-import-system.md`
- `docs/system-map.md`
- `docs/revision-log.md`

Ne değişti:

Admin panel Ürün Düzenleme alanına kategori sayfalarından okunan Excel aktarımı eklendi. Yeni endpoint mevcut menü ürünlerini kategori + ürün adı ile eşleştirir ve yalnız kalori, alerjen, ürün içeriği alanlarını günceller. Aktarım öncesi yedek ve işlem raporu oluşturulur.

Neden değişti:

Ürün ek bilgilerinin tek tek düzenlenmesi yerine `TAHMISCI_MENU.xlsx` benzeri Excel dosyasından toplu ve kontrollü güncellenmesi için.

Sisteme etkisi:

Fiyatlar, ürün sırası, ürün görselleri ve kategori yapısı değiştirilmez. Yeni ürün oluşturulmaz; eşleşmeyen satırlar hata listesine alınır.

Test notları:

Kod düzeyi syntax ve bağlantı kontrolleri yapılacak. Canlı kullanımda örnek Excel ile rapordaki güncellenen, aynı kalan ve hatalı satır sayıları manuel kontrol edilmelidir.

Dikkat edilmesi gerekenler:

Excel sayfa adları kategori adıyla eşleşmelidir. Boş hücre mevcut veriyi silmez; alan temizlemek için `BOŞALT` kullanılmalıdır.

---

Tarih: 2026-07-10

Revize edilen alan: Ürün Excel aktarım hata görünümü

Değişen dosyalar:

- `index.html/panel/index.html`
- `index.html/panel/panel.css`
- `index.html/panel/panel.js`
- `docs/product-excel-import-system.md`
- `docs/revision-log.md`

Ne değişti:

Ürün Excel aktarım raporuna `Hatalıları Göster` butonu eklendi. Hata varsa buton hata sayısını gösterir, hata listesini öne çıkarır ve sayfa/satır bazlı kısa hata özetini kullanıcıya bildirir.

Neden değişti:

Aktarım sonrası hatalı satırların daha hızlı tespit edilmesi için.

Sisteme etkisi:

Aktarım mantığı değişmedi. Sadece rapor ve hata inceleme deneyimi iyileştirildi.

Test notları:

Panel JS syntax kontrolü yapılacak. Hata listesi olmayan durumda buton pasif kalır.

Dikkat edilmesi gerekenler:

Çok fazla hata varsa uyarıda ilk 12 hata gösterilir; tam liste panelde kalır.

---

Tarih: 2026-07-10

Revize edilen alan: Ürün Excel aktarım hata detayları

Değişen dosyalar:

- `index.html/backend/src/server.js`
- `index.html/panel/panel.js`
- `docs/product-excel-import-system.md`
- `docs/revision-log.md`

Ne değişti:

Ürün Excel aktarımında hatalı satırlar artık sayfa, satır numarası, varsa ürün adı ve Excel satırından okunabilen hücre özetiyle raporlanır.

Neden değişti:

Hatalı satırın yalnızca satır numarasıyla değil, hangi ürün veya satır içeriğiyle ilgili olduğunu hızlı tespit etmek için.

Sisteme etkisi:

Aktarım ve eşleştirme mantığı değişmedi; yalnızca hata raporu daha açıklayıcı hale geldi.

Test notları:

Backend ve panel JS syntax kontrolü yapılacak. Gerçek Excel aktarımında hatalı satır kartlarında satır içeriği manuel doğrulanmalıdır.

Dikkat edilmesi gerekenler:

Excel satırında okunabilir hücre yoksa panel `Satır içeriği okunamadı.` bilgisini gösterir.
