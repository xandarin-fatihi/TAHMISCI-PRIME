# TAHMİSÇİ Canlı Performans Analizi

**Tarih:** 15 Ağustos 2026  
**Kapsam:** https://tahmiscicoffee.com/yonetici/ ve https://tahmiscicoffee.com/personel/  
**Çalışma biçimi:** Salt okunur canlı inceleme, mevcut Chrome oturumları, No throttling  
**Kaynak ağacı:** C:\Users\uzeyi\OneDrive\Belgeler\GitHub\TAHMISCI-PRIME  
**Değişiklik durumu:** Uygulama kodu, canlı veri, ayar ve oturumlar değiştirilmedi. Yalnızca bu rapor oluşturuldu.

> Önemli ölçüm sınırı: Kullanılan Chrome kontrol katmanı görünür DOM, gezinme, konsol kayıtları ve yüklenmiş kaynak envanterini okuyabildi; ancak DevTools Network HAR, Navigation Timing, Performance trace ve Disable cache anahtarını dışarı açmadı. Bu nedenle korumalı Fetch/XHR istekleri için uydurma TTFB, DOMContentLoaded, Finish veya Long Task değeri verilmedi. Tarayıcı içi kullanıcı-hazır süreleri üç kez ölçüldü; halka açık ağ katmanı ise üç yeni TLS bağlantısı ve istemci önbelleği olmadan ayrı ayrı ölçüldü. Kaynak koddan türetilen sonuçlar, canlı ölçümden türetilen sonuçlardan açıkça ayrılmıştır.

## 1. Yönetici özeti

Gecikmenin birincil nedeni ağ değil, korumalı her istekte büyük JSON store’un tekrar tekrar diskten okunması, JSON.parse ve tam migration/normalizasyon işleminden geçirilmesidir. Geçerli bir personel isteği çoğunlukla aynı store’u üç kez okur. İncelenen en güncel yerel snapshot 20,63 MB’tır; tek store.read() ortalama 115,81 ms, üç paralel okuma 380–437 ms, altı paralel okuma 727–781 ms sürmüştür. Bu maliyet, aynı Node.js ana thread’i üzerinde senkron JSON parse/migration ile yığılır.

İkinci P0 neden, bildirim teslim ve hatırlatma işçilerinin iş olmasa bile tam store update/yazımı yapmasıdır. Varsayılan aralıklarla dakikada teorik 11 tam rewrite oluşur. 20,63 MB’lık örnek store için bu, dakikada yaklaşık 216,5 MiB okuma ve 216,5 MiB yazma trafiği ile yaklaşık 2,6 saniye parse/migrate/stringify CPU süresi demektir. Canlıda personel Reçete verisinin 8,61 / 33,99 / 8,66 saniyede, reload sonrası 9,95 / 37,24 / 11,29 saniyede görünmesi bu periyodik ana-thread/disk jitter modeliyle uyumludur. Periyot korelasyonu sunucu telemetrisiyle ayrıca doğrulanmalıdır.

Üçüncü ana neden başlangıçta ilgisiz bütün modüllerin eager yüklenmesi, normal GET ile alınan menü/reçete/stok verisinin SSE ilk mesajında tekrar tam snapshot olarak gönderilmesi ve admin sekme değişiminde yalnız aktif bölümü değil bütün ekranı renderAll() ile yeniden üretmesidir. Admin başlangıcı kaynak koddan en az yaklaşık 31 tam store.read() üretmektedir. Canlı /api/menu 249.597 B, /api/menu/events ilk SSE mesajı ortalama 244.221 B’tır; tek katalog başlangıçta yaklaşık 493,8 KB ve sıkıştırmasız olarak iki kez taşınmaktadır.

Canlı ağ tabanı yeni bağlantıda /api/health için yaklaşık 300 ms, /api/menu için 662 ms ortalama TTFB’dir. Buna karşılık kullanıcı-hazır süreleri 4–37 saniyeye çıkmaktadır. Bu fark, “internet yavaş” açıklamasını tek başına dışlar; backend store/read amplification, başlangıç waterfall’ı ve main-thread render maliyeti baskındır.

**İlk uygulanması gereken üç müdahale:**

1. P0: Version/revision kontrollü in-memory store snapshot, auth/session-user indeksleri ve istek başına tek request-scoped snapshot.
2. P0: No-op worker update’lerini gerçekten yazısız bitirmek; scheduler/outbox metadata’sını sıcak katalog store’undan ayırmak.
3. P1: Eager boot ve GET + tam snapshot SSE tekrarını kaldırmak; section-lazy yükleme, küçük revision/delta SSE ve aktif-bölüm render’ına geçmek.

## 2. Canlı ölçüm ortamı ve yöntem

### 2.1 Ortam

- İşletim sistemi: Windows
- Tarayıcı: Kullanıcının açık ve oturumu hazır Google Chrome profili
- Ağ: No throttling
- Canlı host: tahmiscicoffee.com
- Reverse proxy canlı imzası: nginx/1.24.0 (Ubuntu)
- Yönetici ve personel sekmeleri aynı Chrome profilinde, ayrı oturum cookie sözleşmeleriyle açık kaldı.
- Şifre, cookie, token, localStorage veya oturum içeriği okunmadı.
- Veri değiştiren hiçbir buton kullanılmadı.

### 2.2 Ölçüm sınıfları

| Kod | Yöntem | Tekrar | Ne ölçüldü |
|---|---|---:|---|
| C-WARM | Chrome mevcut oturum, tarayıcı cache açık, normal reload | 3 | Load gözlem süresi, görsel kabuk, gerçek veri görünme süresi |
| C-NAV | Chrome salt okunur sekme geçişi | 3 | Tıklama → aktif bölüm / gerçek veri görünmesi |
| C-ASSET | Chrome page-assets envanteri | 1 aktif durum + reload gözlemleri | Kaynak türü, eager endpointler, SSE bağlantıları |
| C-LOG | Chrome console warn/error | Oturum boyunca | Konsol hata ve uyarıları |
| N-COLD | Ayrı curl süreçleri, her URL için yeni TLS, client cache yok, --compressed | 3 | TTFB, total, transfer boyutu, cache ve encoding header’ları |
| S-BENCH | Yerel, salt okunur en güncel store snapshot benchmark’ı | 15 raw örnek + eşzamanlı setler | read, JSON.parse, migrate, stringify, bölüm boyutları |
| C-CODE | Güncel kaynak ağacı statik çağrı zinciri analizi | Tüm kritik yollar | fetch → middleware → store → response → render |

### 2.3 Chrome cache ve Performance sınırlaması

DevTools Disable cache anahtarı ve HAR/Performance trace bu otomasyon API’sine açık değildi. F12 ve DevTools kısayol denemeleri ölçüm arayüzünü açmadı; sayfa güvenlik katmanı da performance, fetch ve navigator nesnelerinin script ile okunmasına izin vermedi. Bu nedenle:

- Authenticated cold-start için “Disable cache” sonucu varmış gibi raporlanmadı.
- Halka açık HTML/statik/API için gerçek cache’siz üç yeni bağlantı N-COLD ölçümü kullanıldı.
- DCL ve Finish yerine Load gözlem süresi, görsel kabuk ve gerçek veri görünme süreleri ayrı raporlandı.
- Long Task, scripting/rendering/painting milisaniyeleri uydurulmadı. Bunun yerine ağ çağrısı yapmayan sekmelerdeki çok saniyelik gecikme, DOM büyüklüğü ve renderAll/live-preview kod yolu kanıt olarak kullanıldı.

### 2.4 Console

Ölçüm oturumu boyunca hem Yönetici hem Personel sekmesinde Chrome console error/warn kaydı: **0**. Bu, yavaşlığın görünür exception/retry hatasından kaynaklanmadığını; sessiz I/O, waterfall ve render maliyeti olduğunu destekler.

## 3. Yönetici paneli ölçüm sonuçları

### 3.1 Normal reload — üç ölçüm

| Koşu | Load gözlemi | Görsel kabuk | Excel geçmişi gerçek veri |
|---:|---:|---:|---:|
| 1 | 14.647 ms | 14.808 ms | 16.658 ms |
| 2 | 759 ms | 2.318 ms | 4.163 ms |
| 3 | 647 ms | 2.958 ms | 4.089 ms |
| **Min / p50 / max** | **647 / 759 / 14.647 ms** | **2.318 / 2.958 / 14.808 ms** | **4.089 / 4.163 / 16.658 ms** |

İlk koşudaki 14–16 saniyelik sıçrama, sonraki iki warm koşudan çok daha büyüktür. Statik ağ tabanı 0,3–0,9 saniye olduğundan bu fark yalnız transferle açıklanamaz. Kaynak kodda aynı anda başlayan eager modüller, yaklaşık 31 tam store read ve periyodik tam-store worker yazımları bu jitter için doğrudan adaydır.

### 3.2 Sekme açılışları — üç geçiş

Değerler tıklama → aktif bölüm/visible DOM süresidir. İkinci geçiş setinde tarayıcı kontrol katmanı bazı heading beklemelerinde deadline verdi; aktif DOM yine alınabildi. Bu nedenle tablo p50 ile birlikte min/max verir ve milisaniye hassasiyetinde laboratuvar trace’i olarak yorumlanmamalıdır.

| Bölüm | Min | p50 | Ortalama | Max | Ağ davranışı |
|---|---:|---:|---:|---:|---|
| Genel Bakış | 574 ms | 654 ms | 1.440 ms | 3.093 ms | Bootta alınan state; click’e özgü GET yok |
| Menü Düzenleme | 2.928 ms | 4.234 ms | 4.796 ms | 7.226 ms | Boot state; tüm renderAll yeniden çalışıyor |
| Banner Düzenleme | 2.994 ms | 3.348 ms | 4.169 ms | 6.164 ms | Boot state |
| Kategori Düzenleme | 3.054 ms | 4.385 ms | 4.674 ms | 6.583 ms | Boot state; büyük liste render |
| Ürün Düzenleme | 2.665 ms | 6.022 ms | 5.022 ms | 6.380 ms | Boot state; büyük ürün DOM’u |
| Toplu Fiyat Güncelleme | 2.664 ms | 3.050 ms | 4.262 ms | 7.073 ms | Pricing zaten eager yüklenmiş |
| Excel Veri Merkezi | 2.917 ms | 2.923 ms | 4.200 ms | 6.759 ms | İlk girişte history GET; kataloglar zaten bootta |
| Stok Düzenleme | 3.091 ms | 3.231 ms | 4.205 ms | 6.292 ms | Stock zaten bootta; 25–46 bin karakter erişilebilir DOM |
| Reçete Düzenleme | 3.330 ms | 3.599 ms | 4.294 ms | 5.954 ms | Recipe zaten bootta |
| Personel | 3.328 ms | 3.449 ms | 4.260 ms | 6.003 ms | Workforce bootta; accordion açılışında refresh olabilir |
| Dilek & Şikayet | 2.796 ms | 2.989 ms | 3.004 ms | 3.227 ms | Liste GET yalnız açık refresh yolunda |
| Ayarlar | 2.775 ms | 2.983 ms | 3.964 ms | 6.134 ms | Boot state |

Bu sekmelerin çoğu tıklama sırasında yeni veri istemez. Buna rağmen 3–7 saniye görülmesi frontend main-thread maliyetini kanıtlar. setActiveSection(), renderAll() çağırır; renderAll yalnız aktif bölümü değil stok, reçete, personel, Excel, geri bildirim ve form parçalarını yeniden render eder. Ardından live preview kapalıyken dahi tam menü/reçete/stok/fiyat snapshot’ı structuredClone ve fingerprint JSON.stringify işleminden geçebilir.

### 3.3 Bildirim Merkezi

| Koşu | Çekmece kabuğu | Gerçek bildirim verisi |
|---:|---:|---:|
| 1 | 291 ms | 11.814 ms |
| 2 | 4.314 ms | 4.470 ms |
| 3 | 2.999 ms | 3.081 ms |
| **Min / p50 / max** | **291 / 2.999 / 4.314 ms** | **3.081 / 4.470 / 11.814 ms** |

İlk açılışta çekmece 291 ms’de görünürken içerik 11,8 saniye sonra gelmiştir. Bu ayrım, DOM kabuğunun değil küçük bir bildirim GET’inin dahi tam store read zinciri ve sunucu jitter’ından etkilendiğini gösterir.

### 3.4 Yüklenen kaynak envanteri

Chrome’un aktif Yönetici sayfasında gözlediği benzersiz kaynaklar:

- Toplam: 37
- Script: 8
- Stylesheet: 6
- Font: 3
- Image: 3
- API/manifest/SSE/diğer: 17
- Inline SVG: 57
- Başlangıçta gözlenen SSE: menu, recipes, stock, admin notifications = 4

Aktif bölüm Excel/Ayarlar olsa bile menu, recipes, stock, pricing, workforce, recipe-access, publish-state, defaults, notification preferences/unread ve history çağrıları yüklenmişti. Bu, section-lazy yükleme olmadığını canlı kaynak envanteriyle doğrular.

## 4. Personel paneli ölçüm sonuçları

### 4.1 Normal reload — üç ölçüm

| Koşu | Load gözlemi | Personel kabuğu | Reçete gerçek veri |
|---:|---:|---:|---:|
| 1 | 1.106 ms | 2.413 ms | 9.952 ms |
| 2 | 566 ms | 2.073 ms | 37.237 ms |
| 3 | 1.067 ms | 2.582 ms | 11.286 ms |
| **Min / p50 / max** | **566 / 1.067 / 1.106 ms** | **2.073 / 2.413 / 2.582 ms** | **9.952 / 11.286 / 37.237 ms** |

Shell tutarlı biçimde yaklaşık 2–2,6 saniyede görünürken reçete verisi 10–37 saniye gecikmektedir. Bu, iframe HTML kabuğu ile korumalı recipe GET/SSE ve store zincirini açıkça ayırır.

### 4.2 Sekme geçişleri — üç ölçüm

| Bölüm | Min | p50 | Ortalama | Max | Bulgular |
|---|---:|---:|---:|---:|---|
| Reçete | 8.611 ms | 8.661 ms | 17.088 ms | 33.993 ms | Iframe her geri girişte yeniden kuruluyor; GET + tam SSE snapshot |
| Stok | 363 ms | 3.041 ms | 2.369 ms | 3.703 ms | 22.833 karakter erişilebilir DOM; bootta GET + SSE duplicate |
| Yapılacaklar | 2.283 ms | 3.987 ms | 5.847 ms | 11.270 ms | Her giriş /api/workforce/me; 12 sn polling |
| Sevkiyat | 2.807 ms | 3.042 ms | 2.979 ms | 3.087 ms | Her giriş full workforce payload |
| Shift | 2.928 ms | 2.939 ms | 2.939 ms | 2.949 ms | Her giriş full workforce payload |
| Profil | 3.146 ms | 5.971 ms | 5.399 ms | 7.079 ms | Local profile render; yavaşlık main-thread yoğunluğu ile uyumlu |
| Bildirimler | 1.599 ms | 2.880 ms | 2.515 ms | 3.065 ms | Liste/preferences zaten session-startta eager |

### 4.3 Personel başlangıç waterfall’ı

Kaynak kod sırası:

1. /api/recipe/me
2. showDashboard()
3. stock SSE bağlantısı açılır
4. await /api/stock
5. seçili bölüm açılır
6. bildirim modülü session-started ile liste + preferences GET ve SSE açar
7. Reçete bölümünde iframe yüklenir; iframe önce recipe SSE, sonra /api/recipes GET açar

Sonuç: Kullanıcı Reçete, Profil veya Yapılacaklar görmek istese bile stok GET kapısından geçer. Aynı stock ve recipe katalogları normal GET ve SSE ilk snapshot’ında iki kez taşınır ve iki kez render edilebilir.

### 4.4 Yüklenen kaynak envanteri

Personel üst kabuğunda gözlenen benzersiz kaynaklar:

- Toplam: 25
- Script: 6
- Stylesheet: 5
- Font: 2
- Image: 5
- API/manifest/SSE/diğer: 7
- Inline SVG: 13

Bu sayı Reçete iframe’in iç CSS/JS/API/SSE alt kaynaklarını tam saymaz. Kaynak kod ve dosya boyutları iframe’e ayrıca yaklaşık 30.179 B JS, 40.974 B CSS, korumalı HTML, recipe GET ve recipe SSE eklediğini gösterir.

## 5. En yavaş API istekleri tablosu

DevTools HAR erişimi olmadığı için korumalı endpointler tam TTFB sırasına sokulamadı. Aşağıdaki tablo canlı TTFB ölçülen halka açık yollar ile, kullanıcı-hazır süresi ve kesin store-read zinciri ölçülen korumalı yolları birlikte verir. “Kullanıcı zinciri” tek endpoint TTFB değildir.

| Sıra | Endpoint / zincir | Canlı ölçüm | Payload / store | Kanıt |
|---:|---|---|---|---|
| 1 | /api/recipes + /api/recipes/events | Reçete görünür min/p50/max 8,61/8,66/33,99 sn; reload max 37,24 sn | Personelde her yol yaklaşık 3 tam store read; GET ve SSE tam katalog | Chrome + app.js route zinciri |
| 2 | /api/workforce/me | Yapılacaklar min/p50/max 2,28/3,99/11,27 sn | 3 tam store read; full stock + tasks + shipment + request + published weeks | Chrome + workforce-routes.js |
| 3 | /api/admin/notifications list zinciri | Bildirim veri min/p50/max 3,08/4,47/11,81 sn | Admin auth+handler yaklaşık 2 read; personelde 3 | Chrome + notification-routes.js |
| 4 | /api/menu/events | TTFB min/ort/max 0,709/0,792/0,881 sn | İlk event yaklaşık 244.221 B, sıkıştırma yok | 3 canlı curl SSE |
| 5 | /api/menu | TTFB 0,632/0,662/0,699 sn; total 0,849/0,903/0,988 sn | 249.597 B, sıkıştırma yok | 3 canlı curl |
| 6 | /api/admin/workforce → /api/stock | Personel yönetimi min/p50/max 3,33/3,45/6,00 sn | Workforce sonra gereksiz seri stock GET; app bootta stock zaten var | Chrome + admin workforce.js |
| 7 | /api/admin/data-imports/history | Excel görünür min/p50/max 2,92/2,92/6,76 sn; reload history max 16,66 sn | History yalnız ilk girişte; tüm diğer kataloglar önceden eager | Chrome + admin app.js |
| 8 | /api/stock + /api/stock/events | Personel Stok min/p50/max 0,36/3,04/3,70 sn | Her biri personelde 3 tam read; full snapshot iki kez | Chrome + app.js |
| 9 | /api/admin/pricing + /api/admin/pricing/history | Bölüm min/p50/max 2,66/3,05/7,07 sn | Aktif sekmeden bağımsız eager ve seri history | Chrome + pricing.js |
| 10 | /api/health | TTFB min/ort/max 0,235/0,300/0,337 sn | 11 B, no-store | 3 canlı curl; ağ/TLS/proxy tabanı |

Canlı yeni bağlantı faz ortalamaları: DNS çoğunlukla 8–46 ms, TCP 68–104 ms, TLS tamamlanma 149–174 ms. /api/menu TTFB’sinin health tabanından yaklaşık 362 ms fazla olması, backend store/serialization maliyetini; ardından yaklaşık 241 ms body indirme farkı ise büyük ve sıkıştırmasız payload etkisini gösterir.

## 6. Tekrarlanan ve gereksiz istekler

1. **Admin boot bütün modülleri yüklüyor.** /api/admin/me sonrasında menu, recipes, publish-state ve defaults paralel; recipe-access, stock ve notification init seri. Pricing ve workforce kendi scriptlerinden aktif bölümden bağımsız başlıyor.
2. **Admin başlangıcında yaklaşık 31 tam store read.** Tek geçerli cookie varsayımıyla hesaplanan alt sınırdır.
3. **Menu GET + menu SSE tam snapshot.** Canlı toplam yaklaşık 493,8 KB aynı katalog.
4. **Recipes GET + recipes SSE tam snapshot.** Personel iframe önce SSE, sonra GET açar.
5. **Stock GET + stock SSE tam snapshot.** Personel showDashboard’da aynı state iki kez gelir.
6. **Admin workforce → stock waterfall.** Workforce response stockState sağlamadığı için client ayrıca /api/stock çağırır; app bootta stock daha önce yüklenmiştir.
7. **Personel workforce tekrarları.** Yapılacaklar/Sevkiyat/Shift her girişte /api/workforce/me; açıkken 12 saniyede bir full poll; visibility dönüşünde tekrar.
8. **Reçete iframe yeniden yaratılıyor.** Başka bölüme geçince about:blank, geri gelince HTML/CSS/JS/auth/GET/SSE yeniden başlar.
9. **Bildirimler eager.** Personel drawer kapalıyken bile list + preferences GET ve SSE; drawer 10 saniye sonra açılırsa liste tekrar GET olabilir.
10. **BroadcastChannel + SSE çift invalidation.** Admin publish hem channel hem backend SSE üretir; recipe channel listener ayrıca GET yapabilir.

## 7. Frontend waterfall analizi

### 7.1 Yönetici

Tarayıcı çağrısı:

    DOM ready
    → /api/admin/me
    → showPanel
    → Promise.all(menu, recipes, publish-state, defaults)
    → recipe-access
    → stock
    → notifications unread/preferences
    → 4 SSE

Paralel yan akışlar:

    pricing.js DOM ready
    → /api/admin/pricing
    → /api/admin/pricing/history

    workforce.js +250 ms
    → /api/admin/workforce
    → fallback /api/stock

Bu yapı, Excel Veri Merkezi açılırken dahi menü, reçete, stok, fiyat, bildirim ve personel verilerinin tamamını yükler. Excel click’ine özgü yalnız import history GET vardır; “Excel açarken her şey yükleniyor” hissinin nedeni o anda başlamak değil, panel boot’unun zaten hepsini yüklemesidir.

### 7.2 Personel

    /api/recipe/me
    → stock SSE
    → await /api/stock
    → seçili bölümü aç
    → notifications list + preferences + SSE
    → Reçete ise iframe
       → recipe SSE tam snapshot
       → /api/recipes tam snapshot

### 7.3 Main-thread

- Admin app.js güncel kaynakta 525.203 B raw; canlı dosya 521.802 B.
- Admin index HTML yaklaşık 142.338 B raw; admin.css güncel kaynakta 282.000 B, canlı 277.003 B.
- Admin başlangıç statik code/CSS seti yaklaşık 1.277.689 B raw ve code splitting yok.
- Her admin sekme tıklaması renderAll() çalıştırır.
- renderAll() sonrası livePreview.notifyDraft() tam katalog snapshot ve fingerprint üretebilir.
- Stok görünümünde 25–46 bin, Ürün görünümünde 18–27 bin karakterlik erişilebilir DOM snapshot’ları görüldü.
- Ağ GET’i olmayan sekmelerde 3–7 saniye ölçülmesi main-thread scripting/render maliyetini doğrudan ayırır.

Gerçek DevTools Long Task sayısı ve scripting/render/paint ms ölçülemedi. Kaynak ve davranış güçlü aday gösterir; uygulama öncesi PerformanceObserver veya Chrome trace ile p50/p95 long-task telemetrisi eklenmelidir.

## 8. Authentication ve yetki kontrolü analizi

### 8.1 Personel /api/workforce/me zinciri

    apps/personel/workforce.js loadWorkforceData()
    → GET /api/workforce/me
    → request-origin middleware
    → requirePersonelOrPreview / requireActivePersonel
    → resolveToken(): store.read #1
    → aktif kullanıcı doğrulaması: store.read #2
    → workforce route handler: store.read #3
    → payload projection
    → JSON.stringify/response
    → render

### 8.2 /api/recipe/me

- requireActivePersonel resolveToken ile store.read #1
- aktif kullanıcı doğrulaması ile store.read #2
- Handler ek read yapmaz
- Toplam: 2 tam store read

### 8.3 Personel /api/recipes ve /api/stock

- requireRecipe / token çözümü: read #1
- requireActiveRecipeUser: read #2
- Handler: read #3
- Toplam: 3 tam store read

### 8.4 Bildirim endpointleri

- Personel list, unread, preferences ve SSE: auth 2 + handler/initial state 1 = 3 read
- Admin eşdeğeri: çoğunlukla 2 read
- Küçük unread-count cevabı, büyük Excel draft/backup/idempotency taşıyan store’un tamamını okur.

### 8.5 Kök mimari sorun

Auth middleware’in çözdüğü session ve store snapshot request üzerinde route’a aktarılmıyor. Route ve aktiflik kontrolü aynı dosyayı bağımsız olarak tekrar okuyor. Doğru çözüm auth’u gevşetmek değil; aynı revision snapshot’ı request-scoped context olarak yeniden kullanmak ve tokenHash→session, userId→user indekslerini memory snapshot üzerinde tutmaktır.

## 9. Store/disk I/O analizi

### 9.1 Kod davranışı

- apps/api/src/store/file-store.js read(): her çağrıda fs.readFile → JSON.parse → normalizeStore/migrateStore.
- Bellek cache yok.
- migrateStore her okumada menu, pricing, recipe, stock, workforce, notification, import ve auth alanlarını yeniden normalize/reconcile eder.
- update(): önce read(), sonra mutator sonucu tekrar normalize, tüm store’u pretty JSON stringify, temp dosya write ve atomic rename.
- No-op mutator dahi tam dosyayı yeniden yazar.
- backupLabel varsa ayrıca tam snapshot stringify ve backup write oluşur.

### 9.2 Salt okunur yerel benchmark

Canlı production DATA_FILE’a erişilmedi. Aşağıdaki değerler aynı kod yoluyla, eldeki en güncel yerel import öncesi snapshot üzerinde ölçülmüştür.

| Ölçüm | Min | Ortalama | p50 | Max |
|---|---:|---:|---:|---:|
| Raw disk read, 20,63 MB | 58,25 ms | 86,28 ms | 76,84 ms | 170,73 ms |
| JSON.parse | 50,98 ms | 62,82 ms | 62,95 ms | 82,74 ms |
| migrateStore | 19,72 ms | 36,39 ms | 30,21 ms | 74,76 ms |
| Pretty JSON.stringify | 75,73 ms | 83,54 ms | 81,67 ms | 97,96 ms |
| Gerçek createFileStore().read() | 111 ms | 115,81 ms | yaklaşık 116 ms | 125 ms |

İkinci tekli koşuda read 131–195 ms oldu. Eşzamanlı üç read 380–437 ms, altı read 727–781 ms wall time üretti. JSON.parse/migration Node ana thread’inde senkron olduğundan neredeyse doğrusal kuyruk oluşmaktadır.

### 9.3 Store boyutu ve bölümleri

- Disk dosyası: 20.632.439 B = 19,68 MiB
- Normalize compact: 11.902.955 B
- Pretty write: 20.637.555 B

| Bölüm | Boyut | Pay / adet |
|---|---:|---|
| dataImportBackups | 3.781.076 B | %31,8 / 10 |
| dataImportIdempotency | 3.321.366 B | %27,9 / 42 |
| dataImportDrafts | 3.122.782 B | %26,2 / 3 |
| İlk üç toplam | 10.225.224 B | **%85,9** |
| productCodeRegistry | 341.167 B | — |
| pricingImportDrafts | 331.349 B | — |
| menuState | 319.771 B | — |
| dataImportMappings | 173.466 B | — |
| recipeState | 163.383 B | — |
| stockState | 108.733 B | — |
| authSessions | 11.961 B | 44 |
| auditLog | 4.294 B | 18 |

Hot request store’unun %85,9’u günlük auth/menu/notification cevaplarının ihtiyaç duymadığı Excel draft, embedded backup ve idempotency response payloadlarıdır.

### 9.4 Backup klasörü

- Toplam: 30 dosya, 257.575.936 B = 245,64 MiB
- local/backups data-import: 25 dosya, 236,27 MiB
- storage/backups: 5,70 MiB
- product-imports: 4,13 MiB

Data import apply hem disk snapshot hem hot store içinde dataImportBackups[].snapshot tutar. Aynı büyük veri iki farklı biçimde saklanmaktadır.

### 9.5 Yazma maliyeti

Normal update için CPU/I/O alt sınırı:

    read 116 ms + ikinci migrate 36 ms + stringify 84 ms
    ≈ 236 ms + 20,64 MB disk write/rename

Backup ile yaklaşık 320 ms CPU + 41,3 MB write alt sınırı oluşur. Disk latency bu hesaba dahil değildir.

## 10. SSE/EventSource analizi

### 10.1 Bağlantı sayısı

- Yönetici tabanı: menu + recipes + stock + admin notifications = 4 SSE
- Personel tabanı: stock + notifications = 2 SSE
- Reçete iframe açıkken recipes eklenir = 3 SSE

Kaynak kod aynı context içinde ikinci connection’ı engeller. Pending SSE tek başına hata değildir. Ölçümde konsol reconnect hatası görülmedi.

### 10.2 Tam snapshot tekrarı

- /api/menu normal GET: 249.597 B
- /api/menu/events ilk event: ortalama 244.221 B
- Birlikte: yaklaşık 493,8 KB, sıkıştırmasız
- menu, recipes ve stock SSE route’ları ilk bağlantıda store.read ve tam state gönderir.
- Her değişiklikte delta değil tam state broadcast edilir.
- sendSse JSON serialization Node event loop üzerinde gerçekleşir.

### 10.3 Reconnect ve heartbeat

- Menu/recipe/stock streamlerinde açık retry ve heartbeat politikası yok.
- Notification SSE 5 sn retry, 25 sn heartbeat ve delta event kullanır; bu daha doğru modeldir.
- Notification SSE’de her eşleşen olayda her bağlı client listener’ı unread count için store.read yapar.

### 10.4 BroadcastChannel çakışması

Admin publish hem BroadcastChannel mesajı hem backend SSE yayınlar. Recipe BroadcastChannel listener yeni GET yapabilir. Sonuç aynı değişiklik için:

    SSE tam snapshot
    + BroadcastChannel invalidation
    + yeni GET

olasılığıdır.

## 11. Service Worker ve cache analizi

### 11.1 API davranışı

Shared PWA runtime API/auth yollarını cache etmez. Bu nedenle API TTFB gecikmesinin birincil nedeni Service Worker değildir.

### 11.2 Statik davranış

- Statikler cache-first.
- Navigation network-first.
- Express statik header’ı unhashed dosyalara 1 saat must-revalidate verir.
- Yalnız gerçek filename hash taşıyan dosyalar 1 yıl immutable olur.
- HTML query-string version kullanıyor; gerçek içerik hashli dosya adı değil.
- SW bir sürüm boyunca cache-first olduğundan SW version bump unutulursa stale statik riski vardır.

### 11.3 İlk kurulum çift indirme riski

SW install cache:reload ile bare URL precache eder; HTML aynı dosyaları query-versionli URL ile yükler. Yeni SW sürümünde aynı kaynağın iki cache key/istek olarak indirilmesi mümkündür.

- Admin precache yaklaşık 1.524 KiB
- Personel precache yaklaşık 720 KiB
- pwa-client her load’da register olur ve 1,5 sn sonra registration.update() çağırır.

### 11.4 304 etkisi

Admin app.js ETag ile üç koşullu GET:

- 3/3 HTTP 304
- Body: 0 B
- TTFB min/ort/max: 201/202/203 ms

304 bandwidth’i kaldırır; fakat bağlantı/revalidation gecikmesini kaldırmaz.

## 12. Bildirim sistemi analizi

### 12.1 Küçük cevap, büyük store maliyeti

Unread-count ve preferences küçük cevaplar üretmesine rağmen personelde üç, adminde yaklaşık iki tam store read yapar. Store’un %85,9’u bu endpointlerin kullanmadığı Excel import payloadlarıdır.

### 12.2 Eager client

Personel session-started olduğunda drawer kapalı olsa bile:

- notifications list GET
- preferences GET
- notification SSE

başlar. Drawer ilk load’dan 10 saniye sonra açılırsa liste tekrar çekilebilir.

### 12.3 Delivery worker P0 jitter

notification-delivery varsayılan 15 saniyede bir:

1. claimNext(): store.update
2. Aday olmasa da updateSchedulerState(): store.update

Reminder scheduler varsayılan 60 saniyede bir:

1. claim lease update
2. scan/state update
3. release lease update

Toplam teorik 11 tam rewrite/dakikadır. Boş sistemde dahi gerçekleşebilir. Bu, kullanıcı isteğiyle aynı writeQueue, disk ve Node main thread’i paylaşır.

## 13. Kök nedenler

### P0-1 — Tam store read amplification

- **Belirti:** Küçük endpointler ve korumalı personel verisi saniyelerce bekleyebiliyor.
- **Ölçülen değer:** Tek read ortalama 115,81 ms; 3 paralel 380–437 ms; 6 paralel 727–781 ms.
- **Endpoint:** /api/workforce/me, /api/recipes, /api/stock, /api/notifications/*
- **Frontend:** loadWorkforceData, loadStock, recipe init, notification init
- **Backend:** file-store.js read/update; auth.js resolveToken/requireActivePersonel
- **Kök neden:** Request başına 2–3 tam disk read + parse + migration; memory snapshot yok.
- **Kullanıcı etkisi:** 2–37 sn veri görünme, yüksek p95 jitter.
- **Öneri:** Revision kontrollü immutable memory snapshot ve request context reuse.
- **Öncelik:** P0
- **Risk:** Orta; yazma atomikliği ve multi-process invalidation korunmalı.
- **Beklenen:** Disk read/request 0; store/auth overhead <5 ms; endpoint başına 230–350 ms doğrudan tasarruf.

### P0-2 — No-op background full rewrites

- **Belirti:** Belirli koşularda açıklanamayan 10–37 sn sivrilmeleri.
- **Ölçülen değer:** Teorik 11 full rewrite/dk; örnek store’da yaklaşık 216,5 MiB read + 216,5 MiB write/dk.
- **Endpoint:** Tüm endpointleri dolaylı etkiler.
- **Backend:** notification-delivery.js, notification-scheduler.js, file-store.js update.
- **Kök neden:** State değişmese bile update tam dosyayı yazar.
- **Kullanıcı etkisi:** Event-loop ve disk jitter, writeQueue bekleme.
- **Öneri:** Conditional transaction/no-change result; scheduler metadata ayrı küçük store.
- **Öncelik:** P0
- **Risk:** Orta; lease/idempotency davranışı test edilmeli.
- **Beklenen:** Boşta full rewrite 11/dk → 0; p95 sivrilmelerinin büyük kısmı kalkar.

### P1-1 — Eager bootstrap ve waterfall

- **Belirti:** İlgisiz sekmeler de başlangıçta yükleniyor.
- **Ölçülen değer:** Admin yaklaşık 31 full store read, 37 benzersiz kaynak.
- **Endpoint:** menu, recipes, stock, pricing, workforce, notifications, defaults, publish-state.
- **Frontend:** admin app.js showPanel/hydrate; pricing.js; workforce.js.
- **Kök neden:** Section-lazy loader yok; yan scriptler DOM ready’de kendi fetch’lerini başlatıyor.
- **Kullanıcı etkisi:** İlk kullanılabilir süre ve backend concurrency artıyor.
- **Öneri:** Küçük admin bootstrap + section projection/lazy fetch; ortak request dedupe.
- **Öncelik:** P1
- **Risk:** Orta; unsaved draft ve canlı preview akışları korunmalı.
- **Beklenen:** İlk boot istekleri yaklaşık 12–15 API’den 4–6 küçük isteğe.

### P1-2 — GET + tam snapshot SSE duplicate

- **Belirti:** Aynı katalog ilk açılışta iki kez taşınıp render ediliyor.
- **Ölçülen değer:** Menu yaklaşık 249,6 KB GET + 244,2 KB SSE.
- **Endpoint:** /api/menu + /api/menu/events; recipes ve stock eşdeğerleri.
- **Frontend:** setupLiveUpdates/loadStock/recipe init.
- **Backend:** app.js SSE route ve broadcast.
- **Kök neden:** SSE initial event tam state; GET de tam state.
- **Kullanıcı etkisi:** Transfer, serialization, parse ve render iki kat.
- **Öneri:** GET snapshot + SSE revision/delta; Last-Event-ID/resume.
- **Öncelik:** P1
- **Risk:** Orta-yüksek; reconnect ve missed-event testleri gerekir.
- **Beklenen:** Initial SSE ≤4 KB; event ≤16 KB; duplicate katalog 0.

### P1-3 — renderAll ve live preview clone

- **Belirti:** Ağ isteği olmayan admin sekmeleri 3–7 sn.
- **Ölçülen değer:** Ürün p50 6,02 sn; Menü p50 4,23 sn; Genel Bakış p50 0,65 sn.
- **Frontend:** app.js setActiveSection/renderAll; live-preview.js snapshot/fingerprint.
- **Kök neden:** Aktif olmayan bütün modüller yeniden render; kapalı preview için de büyük clone/stringify.
- **Kullanıcı etkisi:** Donmuş hissi, input latency.
- **Öneri:** Active-section render, memoized selectors, preview yalnız açıkken ve debounce/revision hash ile.
- **Öncelik:** P1
- **Risk:** Orta; dirty-state ve preview tutarlılığı korunmalı.
- **Beklenen:** Warm sekme geçişi ≤200 ms; long task p95 <50 ms.

### P2-1 — Sıkıştırma yok

- **Belirti:** Content Download gereksiz yüksek.
- **Ölçülen değer:** admin app.js 521,8 KB; admin.css 277,0 KB; /api/menu 249,6 KB, encoding yok.
- **Backend/proxy:** app.js’de compression middleware yok; repo nginx örneğinde gzip/Brotli yok.
- **Kök neden:** HTML dışında JS/CSS/JSON response compression aktif değil.
- **Kullanıcı etkisi:** Cold load ve mobil transfer gecikmesi.
- **Öneri:** Nginx Brotli/gzip; JSON/JS/CSS MIME’ları; SSE’yi buffering/compression kararından ayrı tut.
- **Öncelik:** P2
- **Risk:** Düşük-orta; SSE buffering ve CPU ölçülmeli.
- **Beklenen:** app.js yaklaşık 113 KB gzip; admin.css yaklaşık 41 KB; menu yaklaşık 9–12 KB.

## 14. Kanıt tablosu

| İddia | Canlı kanıt | Kod/benchmark kanıtı | Güven |
|---|---|---|---|
| Ağ tek başına ana neden değil | health TTFB ort 300 ms; UI data 4–37 sn | 2–3 full read/request, eager zincir | Yüksek |
| Personel recipe kritik gecikme | 8,61–33,99 sn; reload 9,95–37,24 sn | iframe reset, recipe SSE+GET, 3+3 reads | Yüksek |
| Store hot path pahalı | Küçük notifications data max 11,81 sn | read avg 115,81 ms; concurrent 727–781 ms | Yüksek |
| Worker jitter | UI ölçümlerinde büyük p95 sıçrama | 15/60 sn workers, 11 rewrite/dk | Orta-yüksek; canlı zaman korelasyonu eksik |
| GET/SSE duplicate | menu GET 249.597 B; SSE 244.221 B | SSE initial full state | Yüksek |
| Admin eager boot | Excel/Ayarlar açıkken 37 kaynak ve tüm API’ler | kaynak alt sınır ~31 reads | Yüksek |
| Main-thread render ağır | Ağsız sekmeler 3–7 sn | renderAll + live preview clone/stringify | Yüksek |
| Compression eksik | Content-Encoding yok | compression middleware/nginx kuralı yok | Yüksek |
| SW API gecikmesi nedeni değil | API ağdan geliyor | API never-cache | Yüksek |
| Reconnect döngüsü kanıtlanmadı | Console warn/error 0 | context başına duplicate guard var | Yüksek |
| Prod config drift | /api/menu Cache-Control yok; SSE X-Accel header görünmüyor | repo nginx örneği farklı | Yüksek |
| Canlı/kaynak sürüm farkı | live app.js 521.802 B, kaynak 525.203 B | CSS de farklı; personel.js aynı | Yüksek |

## 15. Önerilen çözüm mimarisi

    File-backed durable store
            │ startup/revision change
            ▼
    Immutable in-memory snapshot
      ├─ sessionByTokenHash index
      ├─ userById index
      ├─ catalog projections
      └─ revision counters
            │
            ├─ request context: tek snapshot, 0 disk read
            ├─ küçük endpoint projectionları
            └─ multiplex revision/delta SSE

    Büyük ve soğuk veriler:
      dataImportDrafts / backup snapshots / idempotency bodies
            ▼
      ayrı dosya/collection + compact reference

    Yazma yolu:
      queue → validate expectedRevision → mutate clone
            → atomic durable write → swap memory snapshot
            → small revision/delta event

    Worker yolu:
      due-index/queue → gerçekten değişiklik varsa commit
                    → no-op ise disk write yok

Frontend:

- Admin shell küçük bootstrap alır.
- Her bölüm ilk açılışta kendi projection’ını çeker ve revision cache kullanır.
- Pricing/workforce aktif değilse yüklenmez.
- Reçete iframe state’i bölüm değişiminde yok edilmez veya güvenli keep-alive kullanır.
- SSE tam state değil revision/delta gönderir.
- renderAll yerine active-section renderer ve küçük store selector’ları kullanılır.

## 16. Önceliklendirilmiş eylem planı

### P0 — önce

1. Store read/write ve event-loop telemetrisi ekle: Server-Timing, store.read count, parse/migrate/stringify, writeQueue wait, event-loop lag.
2. FileStore üzerinde revision/mtime kontrollü in-memory snapshot ve request-scoped snapshot reuse.
3. Auth session/user indeksleri; requireActivePersonel ve handler’ın aynı snapshot’ı kullanması.
4. No-op update yazmayan transaction sonucu; delivery/reminder metadata’sını küçük store’a ayır.

### P1 — ana mimari kazanç

5. dataImportDrafts/backups/idempotency response’larını hot store’dan ayır; idempotency’de compact result/reference.
6. Admin bootstrap’ı küçült, pricing/workforce/Excel/recipe/stock section-lazy yükle.
7. Workforce projection/query: stok state’i kopyalama, yalnız seçili hafta/kullanıcı; 12 sn full polling yerine delta SSE.
8. Menu/recipe/stock SSE’yi revision/delta ve heartbeat/retry modeline geçir.
9. Admin renderAll → active renderer; live preview clone yalnız drawer açıkken ve debounce.
10. Recipe iframe reload yerine keep-alive veya shared data provider.

### P2 — transfer/cache

11. Brotli/gzip statik ve JSON response compression.
12. Gerçek content-hashli dosya adları + immutable cache.
13. SW precache ile HTML URL anahtarlarını aynılaştır; her load registration.update yerine kontrollü update cadence.
14. Production Nginx header/config drift’ini sunucuda nginx -T ile doğrula.

### P3 — izlenebilirlik/kozmetik

15. Loading shell ile gerçek data-ready ayrımını kullanıcıya açık göster.
16. Large-list virtualization ve erişilebilir DOM bütçesi.

## 17. Beklenen performans kazanımları

| Müdahale | Bugünkü kanıt | Beklenen kazanım |
|---|---|---|
| In-memory snapshot + request reuse | Personel endpointte 2–3 × 116 ms store maliyeti | İstek başına yaklaşık 230–350 ms store overhead kalkışı; concurrency kuyruğunda 0,4–0,75 sn kazanç |
| Hot/cold store ayrımı | Store’un %85,9’u import payload | Hot parse boyutunun yaklaşık %80–90 azalması |
| No-op worker write kaldırma | 11 rewrite/dk teorik | Boşta yaklaşık 216,5 MiB/dk read ve write yükünün kalkması; p95 jitter düşüşü |
| Lazy admin boot | ~31 full read, 37 kaynak | İlk kullanılabilir sürede birkaç saniye; backend burst ciddi düşüş |
| GET/SSE dedupe | Menu başlangıç 493,8 KB | Yaklaşık 244 KB ve ikinci parse/render kaldırılır |
| Compression | app.js 521,8 KB, menu 249,6 KB | app.js yaklaşık 113 KB; CSS 41 KB; menu 9–12 KB |
| Active-section render | Sekmeler 3–7 sn | Warm geçiş ≤200 ms hedefi |
| Workforce delta | 12 sn full poll | Sabit polling trafiğinin büyük ölçüde kalkması; event ≤16 KB |

Uçtan uca beklenen değer, yalnız tek optimizasyonun toplamı değildir. İlk dört mimari müdahale birlikte uygulandığında personel Reçete p50 8,66 sn’den 1,5 sn altına, admin cached data-ready p50 4,16 sn’den 2 sn altına indirilebilir. Bu hedefler production p95 telemetrisiyle doğrulanmalıdır.

## 18. Riskler ve geriye uyumluluk

- **Auth ayrımı:** Admin ve personel cookie önceliği, preview token ve aktif personel doğrulaması aynen korunmalı.
- **Multi-process:** Tek in-memory snapshot PM2 cluster’da süreçler arası invalidation ister. Mevcut tek fork davranışı değişirse revision bus gerekir.
- **Atomic write:** Memory snapshot yalnız durable write ve readback doğrulamasından sonra swap edilmeli.
- **SSE delta:** Missed event, reconnect ve Last-Event-ID senaryosu; revision uyuşmazlığında full refetch fallback.
- **Offline/PWA:** API cache’lenmemeli; statik hash/SW version uyumu korunmalı.
- **Unsaved draft:** Lazy loader import apply ve Kaydet/Yayınla dirty-scope kilidini bozmamalı.
- **Workforce:** 12 sn polling kaldırılmadan önce bildirim/delta kaybı test edilmeli.
- **Backup/idempotency:** Hot store’dan taşıma geriye uyumlu, idempotent migration ve rollback planı gerektirir.
- **Live/source drift:** Canlı admin JS/CSS güncel yerel kaynakla aynı değildir; revizyon başlamadan deploy SHA eşleştirilmelidir.

## 19. Değişmesi muhtemel dosyalar

Bu analizde bu dosyalar değiştirilmedi. Uygulama fazında muhtemel alanlar:

- apps/api/src/store/file-store.js
- apps/api/src/store/migrations.js
- apps/api/src/middleware/auth.js
- apps/api/src/app.js
- apps/api/src/workforce-routes.js
- apps/api/src/notification-routes.js
- apps/api/src/notification-delivery.js
- apps/api/src/notification-scheduler.js
- apps/api/src/data-import-routes.js
- apps/api/src/config.js
- apps/admin/scripts/app.js
- apps/admin/scripts/pricing.js
- apps/admin/scripts/workforce.js
- apps/admin/scripts/live-preview.js
- apps/personel/personel.js
- apps/personel/workforce.js
- apps/personel/notifications.js
- apps/recipe/scripts/app.js
- shared/scripts/pwa-sw-runtime.js
- shared/scripts/pwa-client.js
- deploy/nginx/tahmiscicoffee.com.conf.example
- İlgili route, store, auth, SSE, notification ve PWA regresyon testleri

## 20. Uygulama öncesi kabul kriterleri

### 20.1 Backend ve store

- Küçük endpoint backend işlem süresi: p50 ≤50 ms, p95 ≤120 ms.
- Reused bağlantıda küçük API uçtan uca: p50 ≤200 ms, p95 ≤400 ms.
- Korumalı request başına disk store.read: **0**.
- Request başına memory snapshot çözümü: en fazla 1.
- Auth, active-user ve handler aynı revision snapshot’ı kullanmalı.
- Boş queue/scheduler tick’inde tam store write: **0**.
- Event-loop delay p95 <50 ms; >100 ms olaylar ölçümlenip alarm üretmeli.
- Hot store, import draft/backup/idempotency büyük response’larını taşımamalı.

### 20.2 Yönetici

- Cached shell usable p50 ≤1,2 sn, p95 ≤2 sn.
- İlk gerçek data-ready p50 ≤2 sn, p95 ≤4 sn.
- Warm sekme geçişi p50 ≤100 ms, p95 ≤200 ms.
- Excel bölümü açılırken yalnız history/readiness; kataloglar section ihtiyacına göre.
- Başlangıç full store-read kaynaklı API sayısı bugünkü yaklaşık 31’den en fazla 6 projection isteğine.

### 20.3 Personel

- Shell p50 ≤1,2 sn, p95 ≤2 sn.
- Reçete görünür p50 ≤1 sn, p95 ≤1,5 sn.
- Stok/Yapılacaklar/Sevkiyat/Shift warm p95 ≤1 sn.
- Reçete sekmesine geri dönüş iframe full reload üretmemeli.
- /api/workforce/me aynı bölüm için eşzamanlı/tekrar çağrı üretmemeli.
- 12 sn full polling kaldırılmalı veya payload <16 KB delta ile gerekçelendirilmelidir.

### 20.4 Ağ, SSE ve cache

- Admin ilk sıkıştırılmış statik JS/CSS toplamı ≤350 KB.
- Başlangıç API transferi toplam ≤250 KB compressed.
- Aynı katalog için GET ve SSE full snapshot tekrarı: **0**.
- Admin aktif SSE: tercihen 1 multiplex, gerekçeli en fazla 2.
- Personel aktif SSE: tercihen 1 multiplex, gerekçeli en fazla 2.
- Initial SSE payload ≤4 KB; olay payload ≤16 KB.
- Tüm streamlerde heartbeat yaklaşık 25 sn, retry ≥5 sn ve revision resume.
- Statik dosyalar content-hash + 1 yıl immutable.
- Conditional 304 warm TTFB p95 ≤150 ms.
- Public static cold TTFB p95 ≤200 ms; mevcut yeni-TLS coğrafi taban ayrı raporlanmalı.
- DOMContentLoaded warm ≤1,5 sn; Load warm ≤2,5 sn; cold ≤3,5 sn. Bunlar gerçek DevTools trace ile doğrulanmalı.

## Karar özeti

- **Gecikmenin birincil nedeni:** Her korumalı çağrıda 20 MB sınıfı tam JSON store’un 2–3 kez diskten okunup parse/migrate edilmesi ve aynı ana thread’de periyodik tam-store worker yazımları.
- **İkincil nedenler:** Eager admin/personel bootstrap; GET + tam snapshot SSE tekrarı; 12 sn full workforce polling; admin renderAll/live-preview clone; sıkıştırmasız statik/JSON.
- **İlk üç müdahale:** In-memory/request-scoped snapshot; no-op worker write kaldırma; lazy bootstrap + revision/delta SSE + active renderer.
- **Beklenen kazanç:** Endpoint başına doğrudan 230–350 ms store maliyeti, concurrent kuyrukta 0,4–0,75 sn, başlangıç katalog transferinde yaklaşık 244 KB ve compression ile JS/CSS/JSON’da %75–96 azalma; kullanıcı tarafında recipe p50’nin 8,66 sn’den ≤1,5 sn hedef aralığına inmesi.
- **Kod revizyonundan önce cevaplanması gereken açık sorular:**
  1. Production DATA_FILE gerçek boyutu ve bölüm dağılımı nedir?
  2. Production’da delivery/reminder workerlar gerçekten aynı Node sürecinde ve varsayılan 15/60 sn aralıklarında mı?
  3. Canlı Nginx’te gzip/Brotli ve API/SSE header’ları neden repo örneğiyle farklı?
  4. Canlı deploy SHA nedir; neden admin JS/CSS yerel HEAD ile farklı?
  5. Beklenen eşzamanlı kullanıcı/SSE sayısı ve PM2 instance sayısı nedir?
  6. Menü/reçete/stok için tek multiplex revision stream kabul edilebilir mi?
  7. Import draft/backups/idempotency payloadlarını ayrı durable store’a taşıma bakım penceresi var mı?

---

**Son hüküm:** Önce frontend kozmetiği veya daha agresif cache değil, store/auth read amplification ve no-op background rewrite çözülmelidir. Ardından eager boot, full snapshot SSE ve renderAll kaldırılmalıdır. Bu sıra izlenmezse sıkıştırma ve görsel optimizasyonlar bandwidth’i azaltır ancak 10–37 saniyelik p95 gecikmeleri ortadan kaldırmaz.
