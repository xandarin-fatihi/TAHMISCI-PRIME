# TAHMİSÇİ Mimari Revizyon Durumu

## Ana hedef

Admin paneli, personel paneli, QR menü, reçete, stok, fiyatlandırma, workforce, canlı önizleme, oturum ve yayınlama akışlarını tek kalıcı backend sözleşmesi üzerinde; taslak/yayın, anında işlem ve cihaz tercihi ayrımını koruyarak geliştirmek.

## Aktif faz

Faz 5 öncesi ara revizyon — Excel Veri Merkezi tek yetkili aktarım yolu, katalog kaynak sahipliği, yedek/geri alma, güvenli legacy katalog temizliği, Yönetici adlandırması ve logo/sidebar davranışının kod kapanışı tamamlandı. Gerçek dört dosyalı analiz kaynak dosyalardaki kritik çapraz-veri uyuşmazlıklarını doğru biçimde engelledi; canlı katalog temizliği veya kısmi apply yapılmadı. Faz 5 başlatılmadı.

## Tamamlanan fazlar

- Faz 1: Kritik check kapsamı, bootstrap sözleşmesi, pricing tek sahipliği, cihaz ayarı ayrımı, devre dışı modül bayrakları ve ortak işlem kilidi tamamlandı.
- Faz 2: Ortak panel tokenları, tipografi ve buton/toggle sistemi; tek scroll sahibi panel kabukları; sabit sidebar, mobil drawer ve doğal kompakt yoğunluk tamamlandı.
- Faz 3: Tek güvenli canlı önizleme çekmecesi, kısa ömürlü preview oturumu, taslak geçmişi ve doğrulanmış yayın durumu tamamlandı.
- Faz 4: Tek kanonik fiyat modeli, dinamik tip/seçenek yönetimi, ürün seçeneği aktifliği, toplu fiyat, Excel eşleme/politika, audit/geçmiş ve güvenli geri alma tamamlandı.

## Aktif admin sekmeleri

- Genel Bakış
- Menü Düzenleme
- Banner Düzenleme
- Kategori Düzenleme
- Ürün Düzenleme
- Toplu Fiyat Güncelleme
- Excel Veri Merkezi
- Stok Düzenleme
- Reçete Düzenleme
- Personel
- Dilek & Şikayet
- Ayarlar

## Aktif personel sekmeleri

- Reçete
- Stok
- Yapılacaklar
- Sevkiyat
- Shift
- Profil işlemleri

## Devre dışı modüller

- Site editörü: `PANEL_MODULES.site = false`; admin listener/render akışına alınmıyor, `/site` ve `/api/site` 410 döndürüyor.
- Müdavim: `PANEL_MODULES.mudavim = false`; admin listener/render akışına alınmıyor, `/mudavim` 410 döndürüyor.
- Menü Çıktısı: `PANEL_MODULES.menuOutput = false`; navigasyondan çıkarıldı, listener/render akışına alınmıyor.
- Devre dışı kaynak kodları veri kaybı riski yaratmamak için bu fazda silinmedi; feature flag arkasında çalıştırılmıyor.

## Ana frontend giriş dosyaları

- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/scripts/live-preview.js`
- `apps/admin/scripts/pricing.js`
- `apps/admin/scripts/workforce.js`
- `apps/personel/index.html`
- `apps/personel/personel.js`
- `apps/personel/workforce.js`
- `apps/qr-menu/index.html`
- `apps/qr-menu/scripts/app.js`
- `apps/recipe/index.html`
- `apps/recipe/scripts/app.js`

## Ana API route dosyaları

- `apps/api/src/app.js`
- `apps/api/src/publish-routes.js`
- `apps/api/src/pricing-routes.js`
- `apps/api/src/data-import-routes.js`
- `apps/api/src/data-import.js`
- `apps/api/src/catalog-cleanup-routes.js`
- `apps/api/src/catalog-cleanup.js`
- `apps/api/src/workforce-routes.js`

## Veri deposu

- `apps/api/src/store/file-store.js` seri yazma kuyruğu ve geçici dosyadan atomik rename kullanır.
- Yerel varsayılan kalıcı store: `storage/local/store.json` (`DATA_FILE` ile değiştirilebilir).
- Store şema sürümü: 9; migration sahibi `apps/api/src/store/migrations.js`.

## Auth/session modeli

- Admin ve personel için kalıcı, opaque oturum tokenları kullanılır; store yalnızca token hashini saklar.
- Admin/personel cookie’leri HttpOnly oturum akışına bağlıdır; logout backend oturumunu revoke eder.
- Preview token JWT tabanlı, kısa ömürlü ve normal personel/admin oturumu değildir.
- Başarısız giriş limiti frontend sayacından kaldırıldı; gerçek sınır Express rate limiter tarafından uygulanır.
- Faz 1 oturum ayrımı hotfix’i ile personel kimliği gerektiren yollar yalnızca aktif ve kimliği belirli personel oturumunu kabul eder; admin cookie’si bu yollarda personel oturumu sayılmaz.
- Admin önizlemesi yalnızca canlı admin oturumuna bağlı, geçerli ve yol/mod kapsamı uygun preview token ile çalışır.
- Admin ve personel logout işlemleri yalnız kendi rolündeki kalıcı oturumu revoke eder.

## Yayınlama modeli

- Menü, banner, kategori, ürün ve reçete değişiklikleri merkezi `POST /api/admin/publish` akışında `requestId`, `expectedRevision`, atomik store update ve audit ile yayınlanır.
- Panelin son sekme/sidebar/çıkış onayı tercihleri `device-preference` sınıfındadır; merkezi yayına eklenmez.

## Fiyatlandırma modeli

- Tek frontend sahibi `apps/admin/scripts/pricing.js`.
- Fiyat tipi, toplu güncelleme ve Excel apply işlemleri anında uygulanan; revision, idempotency ve audit korumalı backend işlemleridir.
- `app.js` içindeki eski bulk handler/state/uygulama yolu kaldırıldı; capture ve `stopImmediatePropagation()` kullanılmıyor.
- Built-in Standart, Boyut ve Shot tipleri korunur; admin tip/seçenek adı, birim, sıra ve aktiflik alanlarıyla dinamik fiyat aileleri oluşturabilir.
- Her ürün tek fiyat ailesi kullanır; aile içindeki seçenekler ürün bazında pasifleştirilebilir ve public/QR çıktısından güvenle çıkarılır.
- `GET /api/admin/pricing/history` son fiyat işlemlerini, `POST /api/admin/pricing/history/:id/undo` ise revision ve idempotency kontrollü ters kaydı sağlar.
- Excel aktarımı analiz taslağı üzerinden çalışır; açık sütun eşleme, bilinçli sütun dışlama, K/O/B, Single/Double, dinamik gramaj ve preserve/clear/deactivate boş hücre politikalarını destekler.

## Workforce modeli

- Görev, görev ilerlemesi, sevkiyat, vardiya talebi ve shift planları `apps/api/src/workforce-routes.js` ile kalıcı store’a yazılır.
- Sevkiyat stok etkisi yalnızca admin onayı sırasında backend transaction içinde uygulanır.
- Görev atama, sevkiyat bildirme/onaylama ve shift yayınlama frontend’de ortak işlem kilidi kullanır.

## Canlı önizleme modeli

- Admin sahibi `apps/admin/scripts/live-preview.js`, alıcı `shared/scripts/live-preview-receiver.js`.
- Menü, banner, kategori, ürün, reçete, stok ve ayarlar görünümü aynı `LivePreviewPanel` bileşenini; aynı yükleniyor, hata, taslak, güncel ve yayınlandı durum dilini kullanır.
- Kısa ömürlü preview token backend’den alınır, bitmeden yenilenir ve alıcı açılmadan önce aktif admin oturumuna karşı doğrulanır. Parent/target origin değerleri backend allowlist’inden gelir; schema, source, scope ve `previewSession` eşleşmeyen mesajlar uygulanmaz.
- Mobil/masaüstü görünüm tercihi yalnız cihazda tutulur. Son 12 istemci taslak anlık görüntüsü geri al/yinele için saklanır; “Yayına dön” merkezi publish işleminin gerçekten başarılı olduğu anlık görüntüyü kullanır.
- Yayın hatası önizlemeyi yayınlandı göstermez. Başarılı atomik publish sonrasında backend’e gönderilen anlık görüntü yayın tabanı olur; istek sırasında oluşan yeni değişiklikler taslak kalır.

## Merkezi işlem sınıflandırması

| Sınıf | İşlemler |
| --- | --- |
| Draft/publish | Menü, banner, kategori, ürün, reçete ve yayınlanabilir içerik değişiklikleri |
| Immediate operation | Fiyat tipi, toplu fiyat, Excel analiz/apply, stok hareketi, görev atama/ilerleme, sevkiyat, shift talebi ve shift yayınlama |
| Device preference | Sidebar durumu, son sekme, panel cihaz varsayılanı, çıkış onayı ve görünüm tercihi |

`shared/scripts/save-coordinator.js`, bu sınıfları, ortak durum dilini ve aynı işlem anahtarına ait in-flight isteğin paylaşılmasını sağlar. Backend idempotency/revision kontrollerinin yerini almaz.

## Bilinen riskler

- Site, Müdavim ve Menü Çıktısı kaynak kodları ileride modüler arşive taşınabilir; bu fazda feature flag arkasında çalıştırılmıyor.
- Çalışma ağacı Faz 1 öncesinden çok sayıda kullanıcı değişikliği ve yeni proje modülü içeriyor; otomatik commit/reset yapılmadı.
- Public site editörü pasifken `/api/public/bootstrap`, yayınlanan public menü/reçete sözleşmesi olarak aktif tutuluyor; site SSE ise 410.

## Alınan mimari kararlar

- `/api/public/bootstrap` aktif kalacak; QR/public tüketiciler için tek public veri sözleşmesidir. Ölü ikinci route kopyası kaldırıldı ve test 200 sözleşmesine uyarlandı.
- Pricing event sahipliği `pricing.js` üzerinde tekleştirildi.
- Sahte frontend giriş limiti ve gerçek olmayan otomatik kaydetme ayarı kaldırıldı.
- Tek “Çıkışta onay sor” tercihi cihaz tercihi olarak tutuldu.
- Devre dışı modüller tek `PANEL_MODULES` feature flag kaynağından yönetiliyor.
- Kritik frontend işlemleri ortak `TahmisciOperations` koordinatörüyle kilitleniyor.

## Sonraki faz

Faz 5 — Personel, görev, sevkiyat ve shift sağlamlaştırma. Ara revizyonun kod ve regresyon kapanışı başarılıdır; gerçek katalog apply’i kaynak çalışma kitaplarındaki kritik uyuşmazlıklar giderilmeden çalıştırılmayacak ve açık kullanıcı onayı olmadan Faz 5 başlatılmayacak.

## Faz 5 öncesi Excel katalog ve panel kabuğu ara revizyonu

- Menü, fiyat, reçete ve stok çalışma kitapları `POST /api/admin/data-imports/analyze` ile canlı veriye yazmadan backend üzerinde ayrıştırılır; rapor, alan bazlı değişiklikler, uyarılar ve kritik hatalar Yönetici Veri Merkezi’nde gösterilir.
- Dört dosyalı uygulama menü → fiyat → reçete → stok sırasıyla tek analiz planında hazırlanır ve `POST /api/admin/data-imports/apply` ile revision/fingerprint/idempotency kontrolünden sonra tek seri store güncellemesinde uygulanır.
- Her başarılı apply öncesinde tam store dosya yedeği, ayrıca geri alma için katalog snapshot’ı oluşturulur. `GET /api/admin/data-imports/history` audit geçmişini; `POST /api/admin/data-imports/:id/undo` sonradan yapılan manuel değişiklikleri fingerprint ile koruyan idempotent geri almayı sağlar.
- Store şema 9 migration’ı menü kategorisi/ürünü, reçete öğesi ve stok kategorisi/ürününde kalıcı kimliği koruyarak `sourceType`, `sourceWorkbook`, `sourceSheet`, `sourceNormalizedName`, `sourcePresent`, `statusSource`, `lastImportedAt`, `lastImportOperationId`, `importKey`, `externalId` ve `aliasIds` alanlarını normalize eder; katalog temizliği sürüm/revision kaydı da kalıcı store’da tutulur.
- Excel’den çıkarılan kayıtlar silinmez; kaynakta yok olarak işaretlenir ve Excel sahipliğinde pasifleştirilir. Yöneticiye ait aktif/pasif kararı `statusSource: manual` ve `manualActive` ile korunur; yalnız `excel_removed` kaydı güvenli geri dönüşte otomatik etkinleşir.
- Menü Excel’i yeni kategori/ürün oluşturur; fiyat Excel’i aynı plan içindeki yeni ürüne K/O/B, Single/Double, Standart ve dinamik gramaj fiyatlarını uygular. Boş fiyat mevcut değeri korur; karışık aile, negatif/geçersiz fiyat ve hesaplanmış değeri olmayan formül apply’i engeller.
- Reçete aktarımı `Tümü` sayfasını kopya olarak atlar, sıcak/soğuk Tahmisçi Specialler kaynaklarını ayrı kimlikle korur ve arayüzde ortak Tahmisçi Specialler grubunda gösterir; kesin olmayan menü bağlantısını sessizce kurmaz. Stok aktarımı tek miktar/birimi güvenle ayrıştırır; birleşik birimi manuel inceleme uyarısı olarak bırakır ve hareket geçmişini korur.
- `seedStoreIfEmpty` boş kurulumda örnek katalog yazmaz. QR menü ve reçete istemcileri gömülü `window.MENU`, `DEFAULT_RECIPE_DATA`, localStorage veya MANGO FROZEN fallback’i yerine yalnız backend verisini kullanır; emekli `/menu-data.js` ve `/recipe-data.js` yolları 410 döndürür.
- Kullanıcıya açık Yönetici metinleri giriş, panel, profil, varsayılan, onay/not, parola ve hata yüzeylerinde Türkçeleştirildi; teknik `/panel/`, `/api/admin/...`, `admin` rolü ve auth cookie sözleşmesi korunur.
- Yönetici ve Personel panellerinde ayrı hamburger kaldırıldı; görünür ve klavye erişilebilir Tahmisçi logo düğmesi sidebar’ı açıp kapatır, `aria-expanded`, `aria-controls`, dinamik etiket, mobil overlay ve cihaz tercihi korunur.
- Yeni regresyonlar boş-store, aynı Excel’de değişiklik çıkmaması, yeni ürün+fiyat, arşiv/geri dönüş, manuel sahiplik, reçete tekilleştirme, birleşik stok birimi, formül/ambiguous bloklama, endpoint idempotency, tam yedek, restart readback, geçmiş/undo ve iki logo/sidebar sözleşmesini kapsar.

### Ara revizyonda değişen ana dosyalar

- `apps/api/src/data-import.js`
- `apps/api/src/data-import-routes.js`
- `apps/api/src/catalog-cleanup.js`
- `apps/api/src/catalog-cleanup-routes.js`
- `apps/api/src/retired-excel-import.js`
- `apps/api/src/simple-xlsx.js`
- `apps/api/src/store/file-store.js`
- `apps/api/src/store/migrations.js`
- `apps/api/src/store/seed-defaults.js`
- `apps/api/src/app.js`
- `apps/api/src/validators.js`
- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/styles/admin-compact.css`
- `apps/admin/styles/admin-components.css`
- `apps/personel/index.html`
- `apps/personel/personel.js`
- `apps/qr-menu/index.html`
- `apps/qr-menu/scripts/app.js`
- `apps/recipe/index.html`
- `apps/recipe/scripts/app.js`
- `apps/api/tests/data-import.test.js`
- `apps/api/tests/catalog-cleanup.test.js`
- `apps/api/tests/frontend-catalog-shell.test.js`
- `apps/api/tests/server-routes.test.js`
- `scripts/check-critical-js.js`

### Faz 5 öncesi tek-otorite kapanışı

- Ürün, Toplu Fiyat, Reçete ve Stok sekmelerindeki eski Excel kartları, modalları, inputları, state/listener/render kodları ve fetch çağrıları kaldırıldı. Manuel ürün, fiyat, reçete ve stok CRUD işlevleri korunurken Excel aktarımı yalnız Excel Veri Merkezi’nde bırakıldı.
- `/api/admin/products/import-excel`, fiyat analyze/apply, reçete ve stok legacy import yolları auth/origin kontrolünden sonra Türkçe açıklamalı `410 Gone` döndürür; store yazma koduna ulaşmaz ve yeni `/api/admin/data-imports` yollarını gösterir.
- Gerçek seed içerikleri boş uyumluluk kabuklarına indirildi; `seedStoreIfEmpty` katalog dosyası okumaz, varsayılan reçete import CLI’ı emeklidir ve public legacy katalog JS yolları 410’dur. Boş kurulum örnek ürün üretmez.
- `POST /api/admin/catalog-maintenance/legacy-cleanup/preview|apply` ile sürümlü, fingerprint/revision ve açık onay kontrollü tek seferlik temizlik eklendi. Apply tam FileStore yedeği alır, atomik yazma/readback yapar ve hata halinde geri döner. Sevkiyat veya stok hareketi referanslı ürünler fiziksel silinmek yerine pasif arşivlenir; kullanıcı, workforce, profil, ayar ve audit verileri korunur.
- Excel eşlemesi kalıcı external/import anahtarı, önceki mapping, normalize kategori+ürün ve tekil alias sırasını kullanır. Güvenle aynı kayıt olduğu kanıtlanan eski mükerrerler kanonik ID’ye taşınır; fiyat/reçete/site revision/sevkiyat referansları yeniden yazılır. Çelişkili veya belirsiz kayıt rastgele seçilmez ve kritik hata üretir.
- Gerçek dört dosyalı salt-okunur analiz 29 sayfa ve 600 satır okudu; 27 kategori, 250 menü ürünü, 79 reçete ve 105 stok ürünü oluşturma taslağı üretti. Kaynak setinde menüde bulunmayan 59 fiyat satırı, 7 karışık fiyat ailesi, 20 çözülemeyen gramaj başlığı, 1 çelişkili stok mükerreri, 27 bağlantısız ve 10 belirsiz reçete bağlantısı bulundu; ayrıca 1 birleşik stok birimi manuel inceleme uyarısı verdi. Bu nedenle `canApply=false` oldu, create/update/archive planı canlı store’a yazılmadı ve kısmi veri oluşmadı.
- Mevcut `storage/local/local-dev-store.json`, `storage/backups/store-2026-08-08T14-36-27-849Z.json` olarak ayrıca yedeklendi. Geçerli dört dosyalı apply olmadığı için canlı katalog temizliği güvenlik gereği tetiklenmedi; temizlik/rollback davranışı izole kalıcı store ve gerçek endpoint regresyonlarıyla doğrulandı.
- Son doğrulama: `npm test` başarılı (77 test: 76 geçti, 1 bilinçli atlandı, hata yok); `npm run check` başarılı (19 kritik JavaScript ve yerel asset yolları); `npm run check:duplicates` başarılı; `git diff --check` hata vermedi.
- Kalan gerçek engel kaynak çalışma kitaplarının birbirleriyle tutarlı kanonik ürün kümesi sağlamamasıdır. Kod tarafı Faz 5 öncesi kapanış için hazırdır; canlı katalog geçişi bu veri uyuşmazlıkları giderilip analiz `canApply=true` üretmeden tamamlanmış sayılmaz.

## Değişen dosyalar

- `.gitignore`
- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/scripts/pricing.js`
- `apps/admin/scripts/workforce.js`
- `apps/personel/index.html`
- `apps/personel/workforce.js`
- `apps/api/package.json`
- `apps/api/src/app.js`
- `apps/api/tests/server-routes.test.js`
- `shared/scripts/save-coordinator.js`
- `scripts/check-critical-js.js`
- `REVISION_STATE.md`

Faz 1 öncesinden untracked fakat projeye ait ana modüller korundu: admin live-preview/pricing/workforce, API pricing/publish/workforce, personel paneli, shared preview/save katmanı ve compact panel stilleri. `.tmp/` proje dışı geçici alan olarak ignore edildi.

Faz 1 ek düzeltmesinde yeniden değişen dosyalar:

- `apps/admin/index.html`
- `apps/admin/scripts/pricing.js`
- `apps/admin/scripts/workforce.js`
- `apps/personel/index.html`
- `apps/personel/workforce.js`
- `shared/scripts/save-coordinator.js`
- `scripts/check-critical-js.js`
- `REVISION_STATE.md`

Koordinatör; başarılı, iptal edilmiş, validation nedeniyle uygulanmamış ve hatalı işlemleri ayrı sonuçlar olarak ele alır. Pricing ve workforce executor'ları kullanıcı mesajını koruyup backend hatasını koordinatöre yeniden iletir; dış wrapper unhandled promise rejection oluşmasını engeller. Pricing butonları varsayılan olarak koordinatör tarafından geri yüklenir, ekranın hesapladığı son disabled durumu `onSettled` render'ı ile kesinleştirilir.

## Faz 1 oturum ayrımı hotfix’i

- `requireActivePersonel` yalnız personel cookie/Bearer oturumundan aktif ve kimliği belirli personeli çözer; genel `requireRecipe` sırası değiştirilmedi.
- `/api/recipe/me`, personel profil/avatar ve personel görev, sevkiyat, shift yolları güvenli personel middleware’ine bağlandı; salt okunur admin önizlemesi geçerli preview token ile ayrıştırıldı.
- Personel shell, `/api/recipe/me` yanıtında aktif `user` ve `userId` olmadan dashboard’u açmaz.
- Workforce polling 401/403 sonrasında durur, aynı oturum döneminde tek `personel:session-ended` olayı üretir ve başarılı yeniden girişte yeniden başlar.
- Standalone/admin reçete yönetimi genel reçete oturum sözleşmesini kullanmaya devam eder; normal admin cookie’si personel hesabına dönüştürülmez.
- Admin ve personel logout yollarının rol bazlı revoke izolasyonu entegrasyon testiyle doğrulandı.

Hotfix kapsamında değişen dosyalar:

- `apps/api/src/middleware/auth.js`
- `apps/api/src/app.js`
- `apps/api/src/workforce-routes.js`
- `apps/api/tests/integration.test.js`
- `apps/api/tests/server-routes.test.js`
- `apps/personel/index.html`
- `apps/personel/personel.js`
- `apps/personel/workforce.js`
- `apps/recipe/index.html`
- `apps/recipe/scripts/app.js`
- `REVISION_STATE.md`

## Faz 2 — Ortak tasarım sistemi ve doğal %100 yoğunluk

- `shared/styles/panel-foundation.css`, admin ve personel panellerinin ortak renk, font, ölçü, radius, gölge, form, odak, scrollbar, durum, buton ve toggle tokenlarının tek kaynağıdır.
- Admin ve personel ana başlıkları ortak serif display fontu ve aynı `--panel-page-title` ölçeğini; navigasyon, form ve kontrol metinleri yerel Poppins tabanlı ortak UI fontunu kullanır.
- Global `zoom`, `transform: scale()` veya JavaScript sayfa ölçeklemesi eklenmedi; yoğunluk grid, boşluk, tipografi, kart ve kontrol ölçüleriyle doğal olarak düşürüldü.
- Admin workspace ve personel workspace kendi kabuklarının tek dikey scroll sahibidir. Yapılacaklar, sevkiyat, shift, stok ve profil bölümleri doğal akışta büyür; reçete iframe'i kendi kaydırmasını yönetir.
- Personel profil düğmesi üst bardan kaldırılıp sidebar altına taşındı; açık ve daraltılmış masaüstü durumlarında aynı gerçek profil/popover işlevini kullanır.
- Admin ve personel sidebar durumları masaüstünde korunur. 900/880 px altındaki mobil drawer; overlay, Escape ile kapanma, odak döngüsü, arka plan `inert` kilidi ve tetikleyiciye odak dönüşüyle tamamlandı.
- Admin akordiyonlarında numara, başlık, açıklama ve ok geometrisi ortaklaştırıldı. Kayıt Defteri özet metrikleri geniş ekranda 62 px başlıkta kompakt gösterilir, dar ekranda başlık taşmasını önlemek için gizlenir.
- Workforce görev, sevkiyat ve shift yüzeyleri ortak kontrol yüksekliğine bağlandı. Sevkiyat katalog/sepeti 1366 px'te 706/370 px iki kolon; shift kartları 160 px ve 1024 px'te kontrollü yatay scroll kullanır.
- Modal ve profil popover'ları viewport içinde sınırlandı; admin stok/varsayılan modalleri ortak scroll kilidine bağlandı.
- 390, 1024, 1366 ve 1440 CSS piksel görünümlerinde yatay taşma, sidebar/workspace çakışması ve son içeriğe erişim tarayıcıda doğrulandı. Geniş ekran içerik alanı 1680 px üst sınırıyla dengelenir.
- Faz 2 backend route, auth, veri modeli, durum değeri veya kalıcı store sözleşmesi değiştirmedi. Faz 1 oturum ayrımı, pricing koordinatörü, taslak/yayın ve workforce akışları korunur.

Faz 2 kapsamında değişen dosyalar:

- `shared/styles/panel-foundation.css`
- `apps/admin/index.html`
- `apps/admin/styles/admin-compact.css`
- `apps/admin/scripts/app.js`
- `apps/admin/scripts/pricing.js`
- `apps/personel/index.html`
- `apps/personel/personel.css`
- `apps/personel/personel-compact.css`
- `apps/personel/personel.js`
- `REVISION_STATE.md`

## Faz 2 personel yoğunluk kapanışı

- Personel içindeki reçete gömüsü ayrı bir ölçekleme kullanmadan kompaktlaştırıldı. 1920 px görünümde ilk üç ana grup aynı satırda, Demlemeler ve Hazırlık alt satırda görünür; küçük ekranlarda doğal olarak tek/iki kolona iner.
- Reçete başlığı, profil satırı, arama, kategori kartları ve ürün kartları mevcut işlevleri korunarak sıkılaştırıldı. `is-personel-embed` sınıfı yalnız personel gömüsünü hedefler; bağımsız reçete yönetimini değiştirmez.
- 390×844, 1024×768, 1366×768, 1440×900 ve 1920×1080 görünümlerinde yatay taşma olmadan son karta erişim doğrulandı.

Bu kapanışta değişen dosyalar:

- `apps/recipe/index.html`
- `apps/recipe/scripts/app.js`
- `apps/recipe/styles/recipe.css`
- `apps/personel/index.html`

## Sevkiyat sepeti düzeltmesi

- Desktop sevkiyat ekranı katalog ve 370 px sepet kolonu olarak korunurken sticky davranış sepet kartından sağ kolon kapsayıcısına taşındı; böylece Son Bildirimler kartı sepetin altında doğal akışta kalır.
- Sepet başlığı ve alt eylem alanı sabit görünür; kalem listesi 4, 8 ve 12 ürün senaryolarında kendi içinde kayar. Not, stok uyarısı ve gerçek `Admine Bildir` butonu viewport içinde erişilebilir kalır.
- 1100 px altında katalog, sepet ve geçmiş tek kolon doğal akışa geçer; iç liste scroll’u kaldırılır ve sayfanın tek dikey scroll sahibi workspace olur.
- `POST /api/workforce/shipments`, durum değerleri, birim dönüşümleri ve backend yanıtına bağlı sepet temizleme davranışı değiştirilmedi.

Bu düzeltmede değişen dosyalar:

- `apps/personel/workforce.js`
- `apps/personel/personel-compact.css`

## Sidebar ikon/hizalama düzeltmesi

- Daraltılmış masaüstü sidebar 72 px kabuk içinde ortalanmış 44×44 navigasyon ve profil düğmeleri kullanır; ikonlar 22×22 ölçüsünde aynı eksene oturur.
- Açık sidebar satırları yatay ikon/metin düzenini ve alt sabit profil alanını korur. Mobil drawer doğal genişliğinde açılır, kapalı durumda yatay taşma üretmez.
- Navigasyon düğmelerine görünür etiket kapalıyken de erişilebilir ad sağlayan `aria-label` değerleri eklendi; mevcut `data-section` hook’ları korundu.

Bu düzeltmede değişen dosyalar:

- `apps/personel/index.html`
- `apps/personel/personel-compact.css`

## Personel yaşam döngüsü hotfix’i

- Admin kalıcı silme için tarayıcı prompt’u kaldırıldı; ad, kullanıcı adı, veri/oturum uyarıları, içeride hata alanı, Escape, odak döngüsü, tetikleyiciye odak dönüşü ve `Siliniyor…` durumu olan özel modal eklendi.
- Kalıcı DELETE sürerken X, İptal, onay, backdrop ve Escape kapanışı kilitlenir. Başarısız istekte modal ile backend mesajı açık kalır ve kontroller tekrar etkinleşir; başarılı istekte yalnız backend yanıtındaki kullanıcı listesi/sayaçlar uygulanıp modal kapanır.
- Kalıcı silme aynı işlem anahtarında ortak koordinatörle tek DELETE üretir. Frontend ancak başarılı backend yanıtından sonra personel listesini ve bağlı ekran verisini yeniler.
- `DELETE /api/admin/recipe-users/:id/permanent` yazılı onay gövdesi istemez; mevcut admin ve request-origin korumalarını kullanır. Kullanıcıyı kaldırma, personel oturumlarını revoke etme ve aktivite kaydı tek kalıcı store güncellemesinde tamamlanır; geçmiş görev/atama/aktivite kimliği korunur ve bulunamayan kullanıcı 404 döndürür.
- Pasifleştirme ve aktifleştirme mevcut endpoint’lerle anında işlem koordinatörüne bağlandı. Pasifleştirme aktif personel oturumlarını kapatır; aktifleştirme eski oturumu geri açmaz ve yeniden giriş gerektirir.
- Entegrasyon testleri yetkisiz kalıcı silme, oturum iptali, yeniden giriş, yeniden başlatma sonrası kalıcılık, geçmiş kimliğinin korunması, 404 ve çift tıklamada tek istek davranışını kapsar.

Hotfix kapsamında değişen dosyalar:

- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/styles/admin-compact.css`
- `apps/api/src/app.js`
- `apps/api/tests/integration.test.js`
- `apps/api/tests/server-routes.test.js`
- `apps/personel/index.html`
- `apps/personel/personel-compact.css`
- `apps/personel/workforce.js`
- `apps/recipe/index.html`
- `apps/recipe/scripts/app.js`
- `apps/recipe/styles/recipe.css`
- `REVISION_STATE.md`

## Faz 3 — Ortak canlı önizleme ve güvenli taslak akışı

- Menü/personel hedefleri tek `LivePreviewPanel` içinde bölümün gerçek kaynağına göre seçilir; kullanılmayan kaynak düğmesi gizlenir. Mobil/masaüstü kontrolü, route bilgisi, yeniden yükleme ve durum göstergeleri bütün admin önizlemelerinde aynıdır.
- Ayarlar içindeki eski masaüstü iframe kabuğu ortak bileşene dönüştürüldü. Stok, reçete, fiyat ve menü düzenleme mevcut ID ve çağrı noktalarını kullanarak ortak bileşene bağlandı.
- QR menüdeki gizli admin paneli geçişi ve ona ait gesture/CSS kodu kaldırıldı. QR menü ve personel paneli aynı güvenli receiver olayını tüketir; doğrudan ve denetimsiz `postMessage` alıcısı kalmadı.
- `GET /api/public/preview-config` güvenilir origin listesini no-store olarak döndürür. `POST /api/public/preview-session`, imzalı tokenı ve tokenı üreten canlı admin oturumunu doğrular. `POST /api/admin/preview-token` ayrıca `allowedOrigins` ve `publicOrigin` döndürür.
- CSP `frame-ancestors`, yapılandırılmış admin/public originlerini kabul edecek şekilde genişletildi; rastgele originler receiver ve CSP katmanında reddedilir.
- Preview token bitmeden otomatik yenilenir. Token, origin veya backend sorunu ayrı hata durumu üretir ve sahte güncel/yayınlandı görünümü oluşturmaz.
- İstemci tarafında en fazla 12 kayıtlı kısa taslak geçmişiyle geri al/yinele ve son başarılı yayına dön altyapısı eklendi. Bu geçmiş cihaz içidir; merkezi sistem varsayılanı veya kalıcı backend verisi olarak yazılmaz.
- Faz 1–2 auth cookie ayrımı, publish revision/idempotency sözleşmesi, pricing tek sahipliği, workforce endpointleri, stok etkisi ve kalıcı veri modeli değiştirilmedi. Store şema migration’ı gerekmedi.

Faz 3 kapsamında değişen dosyalar:

- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/scripts/live-preview.js`
- `apps/admin/styles/admin-components.css`
- `apps/api/src/app.js`
- `apps/api/src/middleware/auth.js`
- `apps/api/tests/integration.test.js`
- `apps/api/tests/server-routes.test.js`
- `apps/personel/index.html`
- `apps/personel/personel.js`
- `apps/qr-menu/index.html`
- `apps/qr-menu/scripts/app.js`
- `apps/qr-menu/styles/qr-menu.css`
- `shared/scripts/live-preview-receiver.js`
- `REVISION_STATE.md`

Sonraki faza bırakılanlar: yalnız ana plandaki Faz 4 kapsamı. Faz 3 içinde bilinen açık kod veya veri modeli engeli yoktur.

## Son doğrulama sonucu

- `npm test`: başarılı; 23 testten 22'si geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı. Kalıcı silme kilidi, tek DELETE, preview session doğrulaması, rastgele origin reddi, CSP allowlist’i, oturum ayrımı ve mevcut kalıcı akışlar geçti.
- `npm run check`: başarılı; `apps/api/src/pricing.js` dahil genel backend dosyaları, 13 kritik admin/personel/API/shared JavaScript dosyası ve 7 HTML dosyasının yerel asset bağlantıları doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.

- Faz 3 doğrulaması tamamlandı. Çalışma ağacındaki kullanıcı değişiklikleri korunarak otomatik commit, reset, push veya ZIP işlemi yapılmadı; Faz 4 başlatılmadı.

## Faz 3–4 Ara Revizyon — Global Canlı Önizleme Çekmecesi

- Admin sayfalarındaki menü, stok, fiyat ve ayarlar için ayrı gömülü önizleme mount noktaları kaldırıldı. Panel kabuğuna yalnızca bir sabit 52×52 tetikleyici, erişilebilir durum noktası, tek çekmece host'u ve çalışma anında oluşturulan tek iframe eklendi.
- Çekmece sayfa düzenini itmeden sağdan açılır; masaüstü/mobil genişlikleri, iç kaydırma, X/Escape/tetikleyici kapanışı ve odak dönüşü ortak kabukta yönetilir. Açık modal varken Escape çekmeceyi kapatmaz.
- Çekmece kapalıyken iframe, preview token isteği, zamanlayıcı veya `ResizeObserver` oluşturulmaz. Kapanışta iframe ve bütün canlı kaynaklar yok edilir, oturum/token önbelleği temizlenir; tekrar açılış temiz bir önizleme oturumu başlatır.
- Bölüm eşlemesi tek merkezde tutulur: menü/banner/kategori/ürün/toplu fiyat/ayarlar menü kaynağını; stok/reçete/yapılacaklar/sevkiyat/shift personel kaynağını kullanır. Personel ana bölümü açık workforce accordion/sekmesine göre önizlemeyi günceller; desteklenmeyen bölümlerde tetikleyici pasif ve çekmece boş durumdadır.
- `mount`, `renderFromAdmin`, `notifyDraft` ve `markPublished` uyumluluğu korunurken eski çoklu instance yapısı kaldırıldı. Her bölümün yayın snapshot'ı, kaynak, cihaz ve en fazla 12 taslak kaydı ayrı `Map` durumu içinde tutulur.
- Faz 3 preview token, allowlist origin, aktif admin session, şema/CSP ve hedef origin kontrollü `postMessage` sözleşmeleri korunmuştur. Backend endpoint'i veya kalıcı veri modeli değiştirilmemiştir.
- Global çekmecenin tekilliği, kapalı durumdaki lazy davranışı, bölüm geçmişlerinin ayrılığı, iframe/token temizliği, erişilebilir durum göstergesi ve preview-token yetkilendirmesi odaklı entegrasyon testleriyle kapsanmıştır.

Ara revizyonda değişen dosyalar:

- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/scripts/live-preview.js`
- `apps/admin/scripts/pricing.js`
- `apps/admin/scripts/workforce.js`
- `apps/admin/styles/admin.css`
- `apps/admin/styles/admin-components.css`
- `apps/api/tests/integration.test.js`
- `apps/api/tests/server-routes.test.js`
- `REVISION_STATE.md`

Sonraki faza bırakılanlar: ana plandaki Faz 4 kapsamının tamamı. Bu ara revizyonda Faz 4 başlatılmadı.

### Ara revizyon doğrulama sonucu

- `npm test`: başarılı; 24 testten 23'ü geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı.
- `npm run check`: başarılı; 13 kritik JavaScript dosyası ve 7 HTML dosyasındaki yerel asset bağlantıları doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.

## Faz 4 Öncesi Son Rötuş — Taşmasız Telefon ve Monitör Önizlemesi

- `LivePreviewPanel` ölçeği artık yalnız genişlikten değil, stage'in gerçek `getBoundingClientRect()` ölçüleri ile hesaplanan kullanılabilir genişlik ve yüksekliğin ikisinden üretilir. Stage padding'i ve 4 px güvenlik payı düşülerek pozitif, sonlu ve en fazla `1` olan iki eksenli contain oranı uygulanır; `window.innerHeight` tahmini ve inline stage yüksekliği kaldırılmıştır.
- Mobil görünümde 390×844 gerçek iframe viewport'u; 414×884 doğal dış ölçülü, sıcak koyu kahverengi bezelli, yuvarlatılmış telefon kasası, sade kamera adası ve gesture çizgisi içinde çalışır. Iframe ayrıca ölçeklenmez; bütün telefon kasası tek transform ile küçültülür.
- Masaüstü görünümde 1440×900 gerçek iframe viewport'u; 1464×994 doğal dış ölçülü ince monitör çerçevesi, kamera noktası, boyun ve tabanla aynı tek cihaz kabuğunda gösterilir. Monitör ve taban aynı contain oranıyla birlikte ölçeklenir.
- Fit taşıyıcısı render edilmiş cihaz boyutunu kaplar; cihaz stage içinde iki eksende ortalanır. Preview host ve stage dış taşması kapatılmış, eski yatay/dikey dış scrollbar kaldırılmıştır. Yalnız iframe içindeki gerçek menü/personel sayfası kendi doğal kaydırmasını kullanır.
- Panel ve host `min-height:0` kullanan grid/flex yapıya geçirildi. Header, toolbar ve footer doğal alanını aldıktan sonra stage kalan yüksekliği doldurur; sabit `max-height` ve mobil `min-height` kesme kuralları kaldırıldı.
- İlk contain hesabı senkron uygulanır; `ResizeObserver`, pencere/drawer boyutu ve responsive toolbar değişimlerini izler. Takip hesabı tek, iptal edilebilir `requestAnimationFrame` ile birleştirilir; hızlı cihaz geçişinde revision kontrolü eski frame sonucunu engeller ve destroy sırasında observer, resize listener ve bekleyen frame temizlenir.
- 1366×768, 1024×768, 768 px ve 390×844 tarayıcı kontrollerinde telefon/monitör kasaları tamamen stage içinde kaldı; 1080 px yüksek masaüstü kontrolünde maksimum okunabilir ölçek korundu. Menü, ürün, stok ve reçete route'ları aynı tek iframe ile çalıştı; host/stage dış scrollbar ve ResizeObserver konsol hatası oluşmadı.
- Tek global drawer/iframe/instance, lazy mount/destroy, cihaz tercihi, bölüm geçmişi, taslak ve yayın akışı, token yenileme, origin allowlist, CSP ve güvenli `postMessage` zinciri değiştirilmedi. Backend endpoint'i veya veri modeli etkisi yoktur.
- Odaklı entegrasyon testi cihaz DOM tekilliğini, mobil/masaüstü doğal geometrilerini, iki eksenli contain sonucunu, iframe'in ayrı ölçeklenmemesini ve dış overflow kurallarını doğrular.

Bu rötuşta değişen dosyalar:

- `apps/admin/index.html`
- `apps/admin/scripts/live-preview.js`
- `apps/admin/styles/admin-components.css`
- `apps/api/tests/integration.test.js`
- `REVISION_STATE.md`

Doğrulama sonucu:

- `npm test`: başarılı; 24 testten 23'ü geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı.
- `npm run check`: başarılı; 13 kritik JavaScript dosyası ve 7 HTML dosyasındaki yerel asset bağlantıları doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.
- Bilinen açık uygulama engeli yoktur. Faz 4 başlatılmadı.

## Faz 4 Öncesi Canlı Önizleme Alan Optimizasyonu

- Çekmece başlığı; tek başlık, kompakt canlı durum rozeti, erişilebilir SVG ayarlar düğmesi ve kapatma düğmesinden oluşacak şekilde sadeleştirildi.
- Kaynak, mobil/masaüstü cihaz, gerçek viewport notu, geri al, yinele, yayına dön, maskelenmiş route ve yeniden yükleme kontrolleri sahneyi daraltmayan `Önizleme Ayarları` popover'ına taşındı. Eski panel header/toolbar/footer satırları üretim DOM'undan ve artık kullanılmayan CSS katmanından kaldırıldı.
- Ayarlar düğmesine `aria-controls`, `aria-expanded`, açıklayıcı etiket ve tooltip bağlandı. Popover açılışında ilk etkin kontrole odaklanır; Escape, dış tıklama, çekmece kapanışı ve bölüm değişimi ile kapanır ve uygun durumda odağı ayarlar düğmesine döndürür.
- Önizleme paneli artık kalan alanın tamamını tek satırlı stage olarak kullanır. Mevcut iki eksenli contain hesabı korunurken gereksiz aynı geometri/layout yazımları önbelleğe alındı; telefon ve monitör kontrol satırlarından kazanılan alan içinde belirgin biçimde daha büyük görünür ve `ResizeObserver` geri besleme riski azaltılır.
- Tek global drawer/iframe, lazy mount/destroy, kaynak ve cihaz tercihi, bölüm bazlı geçmiş, taslak/yayın ayrımı, maskelenmiş route, yeniden yükleme, preview token yenileme, origin/CSP ve güvenli `postMessage` sözleşmeleri korunmuştur. Backend endpoint'i, auth akışı veya kalıcı veri modeli değişmemiştir.
- Entegrasyon kapsamı; tek popover/ayar düğmesi/durum rozeti, bütün taşınan kontrol hook'ları, eski görünür kontrol satırlarının yokluğu, tek satırlı stage, popover overflow davranışı ve ölçü yazım önbelleğini doğrulayacak şekilde genişletildi.

Bu optimizasyonda değişen dosyalar:

- `apps/admin/index.html`
- `apps/admin/scripts/live-preview.js`
- `apps/admin/styles/admin-components.css`
- `apps/api/tests/integration.test.js`
- `REVISION_STATE.md`

Doğrulama sonucu:

- `npm test`: başarılı; 24 testten 23'ü geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı.
- `npm run check`: başarılı; 13 kritik JavaScript dosyası ve 7 HTML dosyasındaki yerel asset bağlantıları doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.
- Otomatik yerel tarayıcı açılışı tarayıcı URL güvenlik politikası tarafından engellendiği için bu turdaki etkileşimli localhost kontrolü gerçekleştirilemedi; kod ve otomatik regresyon kontrolleri eksiksiz geçti.
- Faz 4 başlatılmadı.

## Faz 4 Öncesi Ek Rötuş — Sidebar Scrollbar

- Admin sidebar'ın mevcut `.sidebar-scroll-region` kapsayıcısı tek kaydırma sahibi olarak korundu; yeni veya paralel bir scroll katmanı eklenmedi.
- Dikey kaydırma mouse tekerleği, touchpad, klavye odağı ve dokunmatik kullanım için açık bırakılırken Firefox, eski Microsoft motorları ve WebKit tabanlı tarayıcılarda görsel scrollbar tamamen gizlendi.
- `scrollbar-gutter` kaldırıldı; boşalan yatay alan navigasyon satırlarına döndürüldü. Yatay overflow kapalı, ikon ölçüleri ve açık/daraltılmış sidebar hizaları değişmeden kaldı.
- Kaydırılabilir orta alan klavye ile odaklanabilir hale getirildi. Yönetici profil alanı scroll kapsayıcısının dışında, sidebar grid'inin sabit alt satırında kalmaya devam eder.
- Statik regresyon testi görünmez scrollbar kurallarını, dikey/yatay overflow sözleşmesini, daraltılmış sidebar kuralını ve profil alanının ayrılığını doğrular. Faz 4 başlatılmadı.

Ek rötuşta değişen dosyalar:

- `apps/admin/index.html`
- `apps/admin/styles/admin-compact.css`
- `apps/api/tests/integration.test.js`
- `REVISION_STATE.md`

Doğrulama sonucu:

- `npm test`: başarılı; 25 testten 24'ü geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı.
- `npm run check`: başarılı; 13 kritik JavaScript dosyası ve 7 HTML dosyasındaki yerel asset bağlantıları doğrulandı.

## Faz 4 Öncesi Ara Revizyon — Personel Reçete ve Admin Stok

Tamamlananlar:

- Personel sidebar açık/kapalı genişliği, yatay padding'i ve çalışma alanı grid'i ortak değişkenlere bağlandı. Daraltılmış görünüm 76 px kabukta, dört kenarı görünen 44×44 navigasyon ve profil düğmeleri kullanır; aktif durum gölgesi scroll alanı tarafından kırpılmayan iç gölgeye dönüştürüldü. Alt profil alanı sabit, orta navigasyon kaydırılabilir ve mobil drawer davranışı korunmuştur.
- Reçete iframe dış kart/border/gölge katmanından çıkarıldı; personel çalışma alanının kalan yüksekliğini tek iç scroll ile ve gerçek kapsayıcı genişliğiyle kullanır. Runtime CSS enjeksiyonu ve kullanılmayan içerik yüksekliği ölçümü kaldırıldı. Embed içinde bağımsız logo/başlık/profil satırı gizlenip arama, tema ve kategori araçları kompakt panel toolbar'ına dönüştürüldü; `100vw` tabanlı genişlik kalmadı.
- Ana reçete grupları gerçek kategori/ürün sayılarını ve kategori adlarını kullanan vintage 3–2–1 responsive kart sistemine taşındı. Kartın tamamı mevcut `data-recipe-home-group` akışını kullanır; arama, kategori geçişi, ürün/ölçü detayı ve tema davranışı değişmedi.
- SICAKLAR için `cezve.svg`, SOĞUKLAR için `cold-glass.svg`, TAHMİSÇİ SPECIALLER için `barista.svg`, DEMLEMELER için `pour-over.svg`, HAZIRLIK için `recipe-notes.svg` eklendi. Beş asset şeffaf zeminli, aynı tek renk vintage çizgi ailesindedir; emoji, metin veya geçici sembol içermez.
- Admin Stok Düzenleme işlemleri tek `.stock-editor-actions` sözleşmesi altında oluşturma (3 eşit), stok hareketi (2 eşit) ve tehlikeli işlem (2 eşit) gruplarına ayrıldı. Eski 4/5 kolon çakışması kaldırıldı; tablet ve mobil kırılımları 2/1 kolona düşer. Mevcut yedi buton ID'si ve event listener'ı korunurken ortak buton sınıfları uygulandı.
- Stok hareketi gönderimi işlem anahtarı ve `stockActionSubmitting` kilidiyle aynı anda tek isteğe sınırlandı. Başarı yalnız `/api/stock/movements` yanıtındaki gerçek `stockState` ile render edilir; hata modal mesajında kalır ve koordinatör buton durumunu geri yükler.
- Admin sidebar'ın mevcut `.sidebar-scroll-region` görünmez-scrollbar çözümünde hiçbir değişiklik yapılmadı; regresyon testi açık/daraltılmış kaydırma ve sabit profil ayrımını yeniden doğruladı.

Değişen dosyalar:

- `apps/personel/index.html`
- `apps/personel/personel-compact.css`
- `apps/personel/personel.js`
- `apps/recipe/index.html`
- `apps/recipe/scripts/app.js`
- `apps/recipe/styles/recipe.css`
- `apps/admin/index.html`
- `apps/admin/styles/admin.css`
- `apps/admin/scripts/app.js`
- `public/assets/images/recipe-vintage/cezve.svg`
- `public/assets/images/recipe-vintage/cold-glass.svg`
- `public/assets/images/recipe-vintage/barista.svg`
- `public/assets/images/recipe-vintage/pour-over.svg`
- `public/assets/images/recipe-vintage/recipe-notes.svg`
- `apps/api/tests/integration.test.js`
- `REVISION_STATE.md`

Backend/API/veri modeli etkisi:

- Yeni endpoint, auth yolu, veri modeli veya paralel store eklenmedi. Personel `/personel/recete-embed/` yetkilendirmesi, preview token, reçete/stok API'leri, admin/personel oturum ayrımı, taslak/yayın, canlı önizleme, workforce ve local store sözleşmeleri korunmuştur.
- Stok hareketleri mevcut `POST /api/stock/movements` yolunu ve response içindeki `stockState`/revision bilgisini kullanmaya devam eder. Oluşturma ve silme düğmeleri mevcut taslak/yayın akışını korur.

Doğrulama sonucu:

- `npm test`: başarılı; 28 testten 27'si geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı.
- `npm run check`: başarılı; 13 kritik JavaScript dosyası ve 7 HTML dosyasındaki yerel asset bağlantıları doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.
- Beş SVG dosyası XML olarak doğrulandı. Yeni regresyon kapsamı personel sidebar/iframe geometrisini, vintage kart veri bağlantılarını ve 3–2–1 grid'i, yerel asset ailesini, stok action gruplarını, tek istek kilidini ve korunan event/API bağlantılarını doğrular.
- Etkileşimli localhost tarayıcı kontrolü mevcut tarayıcı URL güvenlik politikası nedeniyle bu turda tekrar çalıştırılmadı; otomatik kod, asset ve regresyon kontrolleri eksiksiz geçti. Faz 4 başlatılmadı.

Sonraki faza bırakılanlar: yalnız ana plandaki Faz 4 kapsamı. Bu ara revizyonda bilinen açık kod, API veya veri modeli engeli yoktur.

## Faz 4 Öncesi Hata Düzeltmesi — Reçete Vintage Asset ve Kart Yerleşimi

Tamamlananlar:

- Beş vintage SVG, yanlış proje kökü olan `assets/images/recipe-vintage/` altından mevcut `/assets` static route'unun tek sahibi olan `public/assets/images/recipe-vintage/` ağacına taşındı. Yanlış kökteki yalnızca bu beş kopya kaldırıldı; ikinci route veya fallback mount eklenmedi.
- `/assets/images/recipe-vintage/cezve.svg`, `cold-glass.svg`, `barista.svg`, `pour-over.svg` ve `recipe-notes.svg` isteklerinin runtime 404 hatası giderildi. SVG'lerin bağımsız, şeffaf, script/olay işleyicisi/`foreignObject` içermeyen mevcut vintage çizgi ailesi korundu.
- İlk üç büyük kart için illüstrasyon ve metin üst grid'e, aksiyon ayrı alt satıra alındı. İki yatay kart aynı bileşen ailesinde illüstrasyon, içerik ve aksiyon için bağımsız kolonlara bağlandı. İçerik `min-width: 0`, güvenli başlık kırılımı ve saran chip düzeni kullanır; hiçbir aksiyon absolute konumla metnin üzerine binmez.
- Görsel yükleme hatasında tarayıcının kırık resim işareti gizlenirken illüstrasyon alanının geometrisini koruyan küçük fallback eklendi. Bu fallback gerçek asset kontrolünün yerine kullanılmadı; beş URL ayrıca HTTP seviyesinde doğrulandı.
- Reçete CSS/JS cache anahtarı güncellendi. Mevcut tek `data-recipe-home-group` kart olayı, arama, kategori geçişi, tema, ürün/ölçü detayı ve personel embed akışları değiştirilmedi.
- Entegrasyon testi artık yanlış proje kökünü değil `public/assets/images/recipe-vintage/` ağacını doğrular ve eski beş yanlış kopyanın bulunmadığını kontrol eder. Server route testi, beş URL'nin gerçek Express static route üzerinden `200`, `image/svg+xml` ve gerçek SVG gövdesi döndürdüğünü doğrular.
- Static asset kontrolü JavaScript'te dinamik üretilen beş kritik runtime SVG yolunu mevcut tek `/assets` → `public/assets` eşlemesiyle denetleyecek şekilde genişletildi.

Değişen dosyalar:

- `apps/recipe/index.html`
- `apps/recipe/scripts/app.js`
- `apps/recipe/styles/recipe.css`
- `public/assets/images/recipe-vintage/cezve.svg`
- `public/assets/images/recipe-vintage/cold-glass.svg`
- `public/assets/images/recipe-vintage/barista.svg`
- `public/assets/images/recipe-vintage/pour-over.svg`
- `public/assets/images/recipe-vintage/recipe-notes.svg`
- `apps/api/scripts/check-static-assets.js`
- `apps/api/tests/integration.test.js`
- `apps/api/tests/server-routes.test.js`
- `REVISION_STATE.md`

Backend/API/veri modeli etkisi:

- Yeni endpoint, static mount, auth yolu, veri modeli veya paralel asset sahibi eklenmedi. Mevcut `/assets` → `public/assets`, `/personel/recete-embed/`, preview token, reçete API'si, personel oturumu ve canlı önizleme sözleşmeleri aynen korundu.

Doğrulama sonucu:

- Çalışan `localhost:6060` sunucusunda logo ve beş SVG gerçek HTTP isteğiyle `200` döndü; beş SVG yanıtı `image/svg+xml` ve dolu SVG gövdesi içerdi. `/personel/` `200` döndü.
- Gerçek Chrome personel oturumunda Reçete sekmesi açıldı. Beş illüstrasyonun yüklendiği, ilk satırdaki üç ve ikinci satırdaki iki kartın doğru göründüğü, `TAHMİSÇİ SPECIALLER` başlığının tamamen okunduğu, illüstrasyon/metin/aksiyon alanlarının çakışmadığı, yatay taşma ve console error/warn bulunmadığı doğrulandı. Dar görünümde beş kart tek kolona düştü, assetler yüklü kaldı ve yatay taşma oluşmadı.
- `npm test`: başarılı; 29 testten 28'i geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı.
- `npm run check`: başarılı; 13 kritik JavaScript dosyası, 7 HTML dosyasındaki yerel bağlantılar ve 5 kritik runtime SVG yolu doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.
- `npm run check:assets`: başarılı; 7 HTML yerel bağlantısı ve 5 kritik runtime SVG yolu gerçek production kökünde doğrulandı.

Sonraki faza bırakılanlar: yalnız ana plandaki Faz 4 kapsamı. Bu hata düzeltmesinde bilinen açık kod, API, asset veya veri modeli engeli yoktur; Faz 4 başlatılmadı.

## Faz 4 Öncesi Ara Revizyon — Menü Tasarım Ayarları Kayıt Zinciri

- Admin ve QR menünün tasarım şeması, tarayıcıda isimlendirilmiş tek namespace ve Node tarafında `module.exports` sunan `shared/scripts/menu-design-schema.js` altında ortaklaştırıldı. `designSchemaVersion: 2` ile `appliedPresetId` birbirinden ayrıldı; eski yeşil, eski bej-kahverengi ve sürümsüz kayıtlar kullanıcı değerleri sıfırlanmadan taşınır.
- Admin ve QR içindeki iki ayrı `DESIGN_PRESET_VERSION`, `migrateDesignSettings()` ve `migrateContentDesign()` yolu tamamen kaldırıldı. Ortak normalizasyon eksik/geçersiz alanları tamamlar, giriş nesnesini değiştirmez, bilinmeyen güvenli alanları korur ve ikinci çalıştırmada aynı sonucu üretir.
- Global renkler, fontlar, puntolar, menü arka planı, alt aksiyonlar ve sosyal ikon ayarları; banner metin/mod/video/görsel/ürün listeleri; kategori ve ürün renk/gradient/görsel/overlay stilleri alan bazında korunur. Tasarım projection/fingerprint aynı ortak sözleşmeden üretilir.
- Admin yayın akışı tek `POST /api/admin/publish` sonrasında canonical `GET /api/menu` readback ve tasarım fingerprint eşleşmesi yapar. POST kabul edilen snapshot ayrı pending kayıtta tutulur; gönderilen dirty scope yalnız POST sonrasındaki yeni kullanıcı değişikliklerinden ayrılır. Eşleşme veya GET hatasında doğrulanmış “Yayınlandı” gösterilmez; yeniden doğrulama aynı işlem koordinatörü üzerinden yalnız GET yapar ve ikinci POST üretmez.
- QR normal çalışma modunda backend GET/SSE canonical kaynaktır. Local cache yalnız ilk bootstrap/offline fallback olarak kullanılır; backend başarılı olduktan sonra eski cache canonical veriyi ezemez. Preview draft yalnız preview modunda yetkilidir; GET/SSE yarışları sürüm sayaçlarıyla engellenir ve BroadcastChannel cache'i kör okumak yerine backend yenilemesi başlatır.
- Public bootstrap, canonical menünün savunmacı kopyasını ortak şemayla normalize eder; global tasarım, banner ve gerekli kategori/ürün stillerini açık güvenli allowlist ile projekte eder. Tasarım sürümü, preset, font, punto, renk, gradient, overlay, banner dizileri ve medya adresleri backend doğrulamasına bağlandı; GET/render sırasında store write veya revision artışı oluşmaz.
- Vintage reçete SVG dosyaları, `/assets` production route testi, kritik asset kontrolü ve reçete kartlarının 3–2–1 düzeni değiştirilmeden korunmuştur. Bu çalışma Faz 4 değildir; pricing, toplu fiyat ve Excel kapsamına geçilmemiştir.

Bu ara revizyonda değişen dosyalar:

- `shared/scripts/menu-design-schema.js`
- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/qr-menu/index.html`
- `apps/qr-menu/scripts/app.js`
- `apps/api/src/public-bootstrap.js`
- `apps/api/src/validators.js`
- `apps/api/tests/integration.test.js`
- `apps/api/tests/server-routes.test.js`
- `apps/api/tests/menu-design-schema.test.js`
- `scripts/check-critical-js.js`
- `REVISION_STATE.md`

Backend/API/veri modeli etkisi:

- Mevcut `POST /api/admin/publish`, `GET /api/menu`, SSE, revision, idempotency, audit, auth ve preview token yolları korunmuştur; yeni endpoint veya paralel store eklenmemiştir. Public bootstrap güvenli tasarım projection'ı genişletilmiş, mevcut publish sözleşmesindeki tasarım alanlarının doğrulaması sıkılaştırılmıştır.

Doğrulama sonucu:

- `npm test`: başarılı; 36 testten 35'i geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı. Koruyucu/idempotent migrasyon, preview draft, gerçek tek publish → canonical readback → public bootstrap döngüsü, banner ve kategori/ürün stil koruması gerçek veri nesneleriyle doğrulandı.
- `npm run check`: başarılı; ortak tasarım şeması dahil 14 kritik JavaScript dosyası, 7 HTML yerel bağlantısı ve 5 kritik runtime SVG yolu doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.
- `npm run check:assets`: başarılı; 7 HTML yerel bağlantısı ve 5 vintage runtime SVG yolu production kökünde doğrulandı.
- Gerçek Chrome kontrolünde mevcut legacy özel renklerin yeni ortak şema yüklenirken sıfırlanmadığı görüldü. Arka plan, vurgu, başlık fontu ve menü başlığı puntosu değişiklikleri canlı preview'da anında eşleşti; tek kullanıcı yayını canonical readback ile revision 11'e geçti ve QR reload aynı dört değeri gösterdi. Deneme sonunda kullanıcının önceki dört tasarım değeri ayrı, yetkili bir geri yükleme yayınıyla revision 12'de tekrar doğrulandı. Chrome bağlantısı daha sonraki Admin reload hedefli okumasında kesildiği için bu tek görsel adım ayrıca terminal sonucu gibi sunulmamıştır; canonical restore readback başarılıdır.

Sonraki faza bırakılanlar: yalnız ana plandaki Faz 4 kapsamı. Bu ara revizyonda bilinen açık kod, API veya veri modeli engeli yoktur; Faz 4 başlatılmadı.

## Faz 4 Öncesi Ara Revizyon — Merkezî Varsayılanlar ve Hesap Şifre Yenileme

Tamamlananlar:

- Menü tasarımı ve güvenli sistem bilgileri için admin yetkili, revision ve idempotency kontrollü kalıcı backend varsayılanları eklendi. Tarayıcı yerel depolaması artık sistem varsayılanının sahibi değildir; yalnız cihaz davranışları için kullanılır.
- Ortak tasarım şeması güvenli snapshot, fabrika snapshot'ı, uygulama ve fingerprint işlemleriyle genişletildi. Fabrika veya admin varsayılanı taslağa uygulanırken kategori/ürün kimlikleri, adları, sırası, aktiflikleri, fiyatları, açıklamaları, içerikleri ve işletme görselleri korunur.
- Varsayılanın taslağa uygulanması QR menüyü değiştirmez. Public/canonical menü yalnız mevcut `POST /api/admin/publish` akışı ve başarılı readback sonrasında güncellenir.
- Admin Menü Düzenleme ve Ayarlar ekranlarına erişilebilir kayıt/geri yükleme modalları eklendi; cihaz ayarları ile sistem geneli ayarlar açık biçimde ayrıldı. Modal odak tuzağı, Escape/backdrop kapatma, işlem kilidi, hata halinde açık kalma ve tetikleyiciye odak dönüşü korunur.
- Şifre yenileme sayfası bej–krem–espresso tasarımla yeniden kuruldu. Admin/personel kapsamı, yetkili merkezî e-posta doğrulaması, gerçek personel hesabı seçimi, altı haneli OTP alanı, parola kuralları, görünür loading/hata/başarı durumları ve responsive davranış eklendi.
- OTP challenge kayıtları store'a taşındı; e-posta/kapsam/hedef/kod HMAC ile bağlandı. Süre, deneme sınırı, yeniden gönderimde eski kodu iptal etme ve tek kullanımlılık uygulanır.
- Personel reseti yalnız seçilen gerçek `recipeUsers[].passwordHash` alanını değiştirir ve yalnız hedef personelin oturumlarını iptal eder. Admin reseti yalnız admin şifresini ve admin oturumlarını etkiler. Eski `recipePasswordHash` yalnız bireysel personel hesabı bulunmayan legacy durumda korunur.
- Public bootstrap içinde admin varsayılanları veya reset challenge verileri yayınlanmaz.

Değişen dosyalar:

- `shared/scripts/menu-design-schema.js`
- `apps/api/src/admin-defaults.js`
- `apps/api/src/app.js`
- `apps/api/src/config.js`
- `apps/api/src/store/file-store.js`
- `apps/api/src/store/migrations.js`
- `apps/api/src/validators.js`
- `apps/api/package.json`
- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/styles/admin-components.css`
- `apps/auth/password-reset/index.html`
- `apps/api/tests/menu-design-schema.test.js`
- `apps/api/tests/integration.test.js`
- `apps/api/tests/server-routes.test.js`
- `scripts/check-critical-js.js`
- `REVISION_STATE.md`

Backend/API/veri modeli etkisi:

- Store şema sürümü `7` oldu; `adminDefaults.menuDesign`, `adminDefaults.systemSettings` ve `passwordResetChallenges` kalıcı alanları eklendi.
- Yeni admin yolları: `GET /api/admin/defaults`, `GET|PUT /api/admin/defaults/menu-design`, `GET|PUT /api/admin/defaults/system-settings`. Mevcut auth, publish, preview, pricing ve workforce sözleşmeleri değiştirilmedi.
- Mevcut şifre request/confirm yolları hedef hesap bağlamıyla güvenli biçimde genişletildi; üretimde SMTP zorunluluğu korundu. Sabit test kodu yalnız `NODE_ENV=test` altında kullanılabilir.

Doğrulama sonucu:

- `npm test`: başarılı; 46 testten 45'i geçti, hata yok, pasif Site modülüne ait 1 test bilinçli atlandı.
- `npm run check`: başarılı; 15 kritik JavaScript dosyası, 7 HTML yerel bağlantısı ve 5 kritik runtime SVG yolu doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.
- `npm run check:assets`: başarılı; bütün yerel HTML bağlantıları ve kritik runtime SVG yolları doğrulandı.
- Davranış testleri fabrika resetinde işletme verisinin korunduğunu, admin varsayılanının backend restart sonrasında kaldığını, QR tasarımının yalnız publish sonrası değiştiğini ve personel resetinin ortak şifreyi/başka hesabı etkilemediğini doğruladı.
- Yerel `localhost:6060` health ve admin/personel sayfa yüklemeleri başarılıdır. Şifre sayfasında yatay taşma yoktur; admin varsayılan kontrolleri ve modal erişilebilirlik bağları güncel pakette görünürdür.

Bilinen risk/konfigürasyon bağımlılığı:

- Gerçek e-posta gönderimi için yerel veya üretim ortamında `PASSWORD_RESET_EMAIL` ve SMTP değişkenleri geçerli değerlerle yapılandırılmalıdır. Yerel geliştirme yapılandırmasında bu değerler boş bırakıldığı için canlı SMTP gönderimi yapılmadı; uçtan uca reset davranışı test ortamında gerçek kalıcı store ve hedef kullanıcılarla doğrulandı.

Sonraki faza bırakılanlar: yalnız ana plandaki Faz 4 kapsamı. Faz 4 başlatılmadı.

## Faz 4 — Fiyat Tipleri, Toplu Fiyat ve Excel Sistemi

Tamamlananlar:

- `apps/api/src/pricing.js` içindeki tek kanonik fiyat kataloğu korunarak Standart, Boyut ve Shot built-in tipleri; dinamik tip/seçenek, birim, sıra, aktiflik ve ürün bazlı seçenek pasifleştirme akışları admin arayüzüne bağlandı. Ürün başına tek fiyat ailesi kuralı hem normalizasyonda hem Excel uygulamasında doğrulanır.
- Toplu fiyat ekranı kategori, fiyat tipi, seçenek, ürün araması ve seçili/tümü kapsamıyla çalışır. Doğrudan fiyat, tutar artır/azalt ve yüzde artır/azalt işlemleri eski/yeni fiyat önizlemesinden sonra tek atomik backend yazımına gider.
- Toplu fiyat ve Excel apply işlemleri revision, request ID, idempotency, seri store update, pricing audit, publish revision ve public/QR broadcast zincirini kullanır. Aynı request yeniden gönderildiğinde ikinci fiyat etkisi oluşmaz; stale revision 409 ile reddedilir.
- `GET /api/admin/pricing/history` ve `POST /api/admin/pricing/history/:id/undo` eklendi. Geçmiş yalnız güvenli özet alanlarını döndürür; geri alma kaynak kaydı işaretleyen yeni bir audit işlemi oluşturur, tam beklenen son durum eşleşmeden eski veriyi ezmez ve aynı kayıt ikinci kez geri alınamaz.
- Excel analiz/uygulama akışı açık sütun eşlemesi ve bilinçli sütun dışlama ile genişletildi. K/O/B, Single/Double, mevcut gramajlar, X/Y/Z gramaj yer tutucuları ve yeni sayısal gramaj seçenekleri gerçek fiyat tiplerine çözülür.
- Boş Excel hücreleri için mevcut fiyatı koru, fiyatı temizle ve seçeneği pasifleştir politikaları ayrıştırıldı. Karışık fiyat ailesi, geçersiz fiyat, çözülemeyen gramaj ve ürünü aktif fiyatsız bırakma girişimleri uygulanabilir plan üretmez.
- Excel sonucu işlem ID, değişen ürün/fiyat alanı, atlanan hücre, hatalı satır ve geri alma eylemini gösterir. Hata listesi UTF-8 CSV olarak indirilebilir; işlem geçmişi responsive admin kartında yenilenebilir ve geri alınabilir.
- Excel modalı ile geçmiş görünümüne bej–krem–espresso tasarım sistemine bağlı responsive eşleme, politika, sonuç, badge ve durum stilleri eklendi; cache anahtarları Faz 4 sürümüne yükseltildi.

Değişen dosyalar:

- `apps/admin/index.html`
- `apps/admin/scripts/pricing.js`
- `apps/admin/styles/admin-components.css`
- `apps/api/src/pricing-excel.js`
- `apps/api/src/pricing-routes.js`
- `apps/api/tests/pricing.test.js`
- `apps/api/tests/server-routes.test.js`
- `REVISION_STATE.md`

Backend/API/veri modeli etkisi:

- Yeni kalıcı paralel store oluşturulmadı. Mevcut `pricing`, `menuState`, `revisions`, `pricingAudit`, `pricingImportDrafts` ve `idempotencyRequests` alanları kullanılmaya devam eder.
- Yeni admin yolları `GET /api/admin/pricing/history` ve `POST /api/admin/pricing/history/:id/undo` olup mevcut admin auth ve request-origin korumasına bağlıdır.
- Mevcut fiyat tipi, toplu fiyat, Excel analyze/apply, `/api/menu`, public bootstrap, SSE/broadcast, canlı önizleme, publish ve auth sözleşmeleri korunmuştur.

Doğrulama sonucu:

- `npm test`: başarılı; 58 testten 57'si geçti, hata yok, geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı.
- Yeni kapsam; kanonik tek aileyi, ürün seçeneği aktifliğini, bütün toplu fiyat matematiğini, dinamik gramajı, açık eşleme/dışlamayı, üç boş hücre politikasını, karışık aile ve atomik plan reddini doğrular.
- Gerçek HTTP regresyonu; yetkisiz geçmiş/undo reddini, toplu fiyat apply, duplicate request replay, revision conflict, audit/history, tek kullanımlık undo ve fiyatın hem canonical menü hem public QR bootstrap üzerinde ileri/geri yansımasını doğrular.
- `npm run check`: başarılı; 15 kritik JavaScript dosyası ve bütün statik bağlantılar doğrulandı.
- `npm run check:duplicates`: başarılı; duplicate production asset bulunmadı.
- `npm run check:assets`: başarılı; 7 HTML dosyasındaki yerel bağlantılar ve 5 kritik runtime SVG yolu doğrulandı.
- `git diff --check`: whitespace hatası yok; yalnız mevcut Windows satır sonu bilgilendirmeleri bulunuyor.
- Yerel `localhost:6060/panel/#bulkPriceCard` hızlı tarayıcı kontrolünde gerçek fiyat verisi, kategori/tip/seçenek/ürün filtreleri, eski/yeni tablo, geçmiş kartı ve üç seçenekli boş hücre politikası yüklendi. Dar görünümde body yatay taşması, console error/warn veya kesilen modal akışı görülmedi; Excel modalının iç kaydırması ve disabled analiz/apply başlangıç durumu doğrulandı.

Sonraki faza bırakılanlar: ana plandaki Faz 5 personel, görev, sevkiyat ve shift sağlamlaştırma kapsamı. Faz 4 içinde bilinen açık kod, API veya veri modeli engeli yoktur; Faz 5'e geçiş uygundur ve açık kullanıcı onayı beklenmektedir.

## Faz 5 Öncesi Kapanış — Excel Veri Merkezi ve Kalıcı Ürün Kodu Mimarisi

Tamamlanan veri mimarisi:

- Menü, fiyat, reçete ve stok çalışma kitapları doğrudan canlı veri kaynağı yapılmadan; backend analizi, revision kontrollü taslak, Yönetici onayı, atomik store yazımı, audit, yedek, geri alma ve SSE bildirim zincirine bağlandı.
- Store şeması `10` sürümüne taşındı. Menü ürünü, reçete ve stok ürünü için kalıcı `productCode` alanları ile kapsam bazlı `productCodeRegistry` eklendi; legacy kayıtların kimlikleri korunurken eksik kaynak metadata alanları migration ile tamamlandı.
- Analiz/apply akışında request/operation kimliği, dosya hash'i, stale revision kontrolü, yüksek arşiv etkisi için açık onay, idempotent replay, canonical readback ve başarısızlıkta snapshot rollback uygulanır.
- Readback doğrulaması başarısız olursa beklenen/gerçek katalog ve ürün kodu fingerprint'leri, history bulunma durumu ve rollback sonucu hassas katalog içeriği yazılmadan hem sunucu loguna hem başarısız audit kaydına eklenir.
- Kodlu örnek çalışma kitapları canlı store'a yazılmadan analiz edildi. Geçerli yeni ürün ve fiyat satırları planlanabilir; aynı kodla çelişen reçete ölçüleri, yinelenen stok kodu ve belirsiz birleşik stok birimleri sessizce uygulanmaz ve inceleme raporuna alınır.

Excel ve ürün kodu davranışı:

- Self-closing boş XLSX hücrelerinin takip eden Ürün Kodu hücresini yutmasına neden olan ayrıştırıcı hatası giderildi. Türkçe para biçimleri, birden fazla fiyat ailesi, dinamik gramajlar, Yönetici tanımlı özel fiyat seçenekleri ve boş hücrede mevcut fiyatı koruma davranışı desteklenir.
- Kod eşleştirmesi önce ürün kodunu, sonra aynı kaynakta güvenli kategori/ürün eşleşmesini kullanır. Aynı kapsamda yinelenen kodlar ve stokta `STK-` ile başlamayan yeni kodlar kritik hata üretir; reçetenin farklı ölçüleri aynı kalıcı kodu paylaşabilir.
- Excel'den kaybolan Excel kaynaklı kayıtlar silinmez; `sourcePresent`, arşiv ve durum kaynağı metadata'sı güncellenir. Manuel aktif/pasif kararı korunur, yalnız Excel kaldırması nedeniyle pasifleşen güvenli eşleşme tekrar bulunduğunda yeniden etkinleşebilir.
- Fiyat seçeneklerinde de Excel/manual sahipliği korunur; Excel kaynaklı kaybolan seçenek arşivlenir, manuel durum Excel tarafından ezilmez. Menüde kesin karşılığı bulunmayan reçete bağlantısız ve uyarılı biçimde korunur.

Kaldırılan ikinci katalog kaynakları:

- `data/seeds/menu.json` ve `data/seeds/recipes.json` boş uyumluluk kabuklarıdır; JavaScript seed dosyaları gerçek katalog içermez. `seed-defaults.js` dosya veya gömülü katalog okumaz ve boş kurulumda örnek ürün oluşturmaz.
- Eski `/menu-data.js`, `/recipe-data.js` ve Excel import yolları `410 Gone` ile Excel Veri Merkezi'ne yönlendirir. QR Menü, Personel Reçete ve Stok ekranları boş store'da “Henüz veri aktarılmadı” durumunu gösterir ve kataloglarını yalnız API'den alır.
- Hedefli runtime taramasında gömülü gerçek ürün/reçete kataloğu, QR fallback ürünü veya seed dosyasını çalışma zamanı kaynağı olarak okuyan ikinci bir yol bulunmadı.

Değişen temel dosyalar:

- `apps/api/src/simple-xlsx.js`
- `apps/api/src/data-import.js`
- `apps/api/src/data-import-routes.js`
- `apps/api/src/catalog-cleanup.js`
- `apps/api/src/catalog-cleanup-routes.js`
- `apps/api/src/store/product-code-registry.js`
- `apps/api/src/store/migrations.js`
- `apps/api/src/store/file-store.js`
- `apps/api/src/store/seed-defaults.js`
- `apps/api/src/pricing.js`
- `apps/api/src/public-bootstrap.js`
- `apps/api/src/workforce-routes.js`
- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/personel/personel.js`
- `apps/personel/workforce.js`
- `apps/personel/stok/stok.js`
- `apps/qr-menu/scripts/app.js`
- `data/seeds/menu.json`
- `data/seeds/recipes.json`
- `data/seeds/menu-data.js`
- `data/seeds/recipe-data.js`
- `apps/api/tests/simple-xlsx.test.js`
- `apps/api/tests/data-import.test.js`
- `apps/api/tests/product-code-registry.test.js`
- `apps/api/tests/catalog-cleanup.test.js`
- `apps/api/tests/server-routes.test.js`
- `scripts/check-critical-js.js`
- `REVISION_STATE.md`

Doğrulama sonucu:

- `npm test`: 88 testten 87'si geçti, hata yok; geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı. Kapsam XLSX ayrıştırma, ürün kodu sicili, analiz/apply, yüksek arşiv onayı, idempotency, canonical readback, kalıcı yedek, history/undo, restart kalıcılığı ve sevkiyatın kodla tek stok etkisini içerir.
- Gerçek HTTP akışında `GET /api/menu`, `GET /api/recipes`, `GET /api/stock`, `GET /api/public/bootstrap` ürün kodlarını korudu. Personel oturumuyla yalnız `stockProductCode` gönderilen sevkiyat beklemede stoğu değiştirmedi; Yönetici onayı stoğu bir kez artırdı ve yinelenen onay idempotent kaldı.
- `npm run check`: başarılı; data import, katalog temizliği ve ürün kodu sicili dahil 20 kritik JavaScript dosyası, 7 HTML yerel bağlantısı ve 5 kritik runtime SVG doğrulandı.
- `npm run check:duplicates`: başarılı; yinelenen production asset bulunmadı. `git diff --check` whitespace hatası vermedi; yalnız Windows satır sonu bilgilendirmeleri bulundu.
- Dört kodlu örnek dosya canlı store'a yazılmadan birlikte analiz edildi: 933 satır ve 39 sayfa okundu, 509 fiyat seçeneği çözüldü, geçersiz ürün kodu veya eksik fiyat kalmadı. Apply yalnız gerçek veri çakışmaları nedeniyle güvenle engellendi: reçetede `SOG-STD-KUZKLG` için 3 farklı içerikli aynı ölçü kaydı ve stokta yinelenen `STK-TOZ-CIL`. Bağlantısız reçeteler ile birleşik birimli stok satırı uyarı/manuel inceleme olarak korundu.

Sonraki faza bırakılanlar: yalnız ana plandaki Faz 5 kapsamı. Faz 5 öncesi kod, API, migration veya doğrulama eksiği kalmadı; örnek Excel dosyalarındaki dört gerçek veri çakışması düzeltilmeden canlı apply yapılmaması beklenen güvenlik davranışıdır.

## Faz 5 Öncesi Atomik Aktarım Canonical Readback Hotfix'i

Kök neden ve backend çözümü:

- Excel apply işlemi expected fingerprint'i ara migration kopyasından, persisted fingerprint'i ise FileStore'un tekrar normalize ettiği disk verisinden üretiyordu. Eşdeğer iş verisi farklı temsil edildiğinde başarılı işlem yanlışlıkla readback hatası sayılıyordu.
- `FileStore.update` mutator sonucunu tek kez normalize eder, atomik rename ile yazar ve diske yazdığı aynı canonical state'i döndürür. Apply artık bu committed state ile `store.read()` persisted state'ini karşılaştırır; ayrı bir ara `migrateStore` kopyası kullanılmaz.
- Fingerprint sürümü `2` scope-aware yapıdadır. Menü, fiyat, reçete ve stok projeksiyonları ayrı oluşturulur; ürün/fiyat/kategori dizileri kararlı sıralanır, transient import/timestamp alanları recursive çıkarılır. Site, workforce, UI, history, backup ve idempotency kayıtları iş fingerprint'ine girmez.
- Audit; import kimliği/kapsamı, önceki/sonraki revizyon, committed/persisted katalog ve ürün kodu fingerprint'leri, validation durumu ve rollback sonucunu saklar. Mismatch halinde rollback yalnız bir kez çalışır; `dataImport`, publish ve pricing revizyonları önceki değere döner ve rollback readback'i ayrıca doğrulanır.
- Analyze işlemleri revizyon artırmadan `analyzed` veya `unchanged` history kaydı üretir. Aynı request ID replay'i history kaydını çoğaltmaz; değişikliksiz analiz apply isteği üretmez.

Yönetici arayüzü:

- Excel Veri Merkezi'nde workspace H1 tek ana başlık olarak bırakıldı; içeride yinelenen kicker/H1 kaldırıldı ve açıklama çalışma adımlarının üzerinde bir kez gösterildi.
- Geçmiş görünümü `Analiz edildi`, `Uygulandı`, `Değişiklik yok`, `Doğrulama başarısız — sistem geri aldı`, `Geri alındı` ve `Kullanıcı tarafından geri alındı` durumlarını backend alanlarından ayırır. Validation hatası normal `applied` statüsünden önceliklidir.
- Eski bağımsız Excel yükleme arayüzü veya listener kalmadığı hedefli taramayla yeniden doğrulandı; eski route'lar `410 Gone`, tek yazma noktası `/api/admin/data-imports` olarak kalır.

Değişen temel dosyalar:

- `apps/api/src/data-import.js`
- `apps/api/src/data-import-routes.js`
- `apps/api/src/store/file-store.js`
- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/styles/admin-compact.css`
- `apps/admin/styles/admin-components.css`
- `apps/api/tests/data-import.test.js`
- `apps/api/tests/data-import-routes-regression.test.js`
- `REVISION_STATE.md`

Hedefli doğrulama:

- Canonical/scope fingerprint, ilk apply, değişikliksiz ikinci analiz ve kontrollü mismatch/rollback testleri dahil hedefli paket: 44/44 başarılı.
- Gerçek `TAHMISCI-MENU-KODLU.xlsx`, izole geçici store ve gerçek HTTP endpointleriyle doğrulandı: ilk analiz 8 sayfa, 250 satır, 8 yeni kategori, 250 yeni ürün, 0 hata ve uygulanabilir; apply `200`, validation `verified`, tek revision; `/api/menu` 8 kategori/250 ürün; aynı request replay aynı operation/revision; restart readback kalıcı.
- Aynı gerçek Excel'in ikinci analizi 0 yeni kategori, 0 yeni ürün, 0 güncelleme, 250 değişiklik yok ve history `unchanged` sonucu verdi.
- Kontrollü persisted mismatch testinde committed/persisted fingerprint ayrımı audit'e yazıldı, yalnız bir rollback uygulandı, rollback doğrulandı ve katalog ile iş revizyonları başlangıç değerine döndü.
- `npm run check`: başarılı; 20 kritik JavaScript dosyası, 7 HTML yerel bağlantısı ve 5 runtime SVG doğrulandı.

Sonraki faza bırakılanlar: yalnız açık kullanıcı onayıyla Faz 5 kapsamı. Canonical apply/readback hotfix'i açısından bilinen açık engel yoktur; Faz 5 bu görevde başlatılmadı.

## Faz 5 — Personel, Görev, Sevkiyat ve Shift Sağlamlaştırma

Tamamlanan workforce mimarisi:

- Mevcut `workforce` store yapısı tek sahip olarak korundu. Görevler kişi bazlı assignment kayıtları, bağımsız madde ilerlemesi, revision, teslim zamanı, yönetici notu, iptal/salt-okunur durumu ve aktivite geçmişiyle genişletildi; toplu atamada bir personelin ilerlemesi diğer assignment kaydını değiştirmez.
- Personel görev maddesi yazmaları yalnız oturumdaki personele ait assignment üzerinde çalışır. Yönetici görev oluşturma ve iptal etme, personel madde güncelleme ve bütün kritik workforce yazmaları request ID/idempotency, backend doğrulaması, revision ve audit zincirine bağlandı.
- Sevkiyat bildirimi mevcut stok kataloğunu kullanır, pasif/arşivli ürünleri reddeder ve bildirim aşamasında stoğu değiştirmez. Yönetici onayı dönüşümleri backend'de yeniden hesaplar; stok artışları, `inbound_shipment` hareketleri, sevkiyat kararı ve hareket referansları tek store güncellemesinde yazılır. Aynı sevkiyat veya request ID stoğu ikinci kez etkileyemez; ret gerekçesi zorunludur ve ret stoğu değiştirmez.
- Shift taleplerinde geçmiş tarih ve yinelenen bekleyen talep backend'de engellenir. Talep kararları, ayarlar, taslak, otomatik öneri, taslağı uygulama ve yayınlama revision/idempotency korumasındadır. Taslaklar personel endpoint'ine sızmaz; yalnız yayınlanan plan görünür, önceki yayın revision'ları geçmişte korunur.
- Otomatik planlama yalnız gelecek hafta için açıklanabilir bir taslak önerir; dikkate alınan talepler, uygulanan kurallar, çatışmalar ve henüz uygulanmayan sınırlamalar Yönetici arayüzünde gösterilir. Yayın işlemi ayrıca ve açık Yönetici eylemidir.

Personel yaşam döngüsü ve oturum:

- Personel oluşturma, güncelleme, pasifleştirme, yeniden aktifleştirme ve kalıcı silme mevcut route'lar üzerinde idempotent/revision kontrollü hale getirildi. Pasifleştirme yalnız personel oturumlarını revoke eder; geçmiş görev, sevkiyat, stok hareketi ve shift kayıtları korunur.
- Kalıcı silme metin yazdıran eski akışı kullanmaz. Erişilebilir modalda ad/kullanıcı adı, geri alınamazlık ve geçmiş koruma açıklanır; açık onay kutusu olmadan tehlikeli buton etkinleşmez. İstek sürerken bütün kapatma yolları ve yinelenen DELETE kilitlenir; hata halinde modal gerçek backend mesajıyla açık kalır.
- Kalıcı silmede login kaydı kaldırılır, personel oturumları revoke edilir, geçmiş workforce referanslarına ad/kullanıcı adı snapshot'ı ve silinmiş personel göstergesi yazılır; kullanıcı adı yeniden kullanılabilir. İşlem audit kaydına alınır.
- `/api/workforce/me` 401/403 sonrasında polling durur, arayüze tek oturum-sonlandı olayı iletilir ve giriş görünümü açılır. Başarılı yeniden giriş polling'i tekrar başlatır; gizli sekmede gereksiz polling yapılmaz ve aktif form state'i sunucu yenilemesiyle silinmez.

Veri modeli ve migration:

- Store şeması `11` sürümüne çıkarıldı. Legacy tek metinli görevler maddeli task yapısına, eski `assignedUserIds` kayıtları kararlı ve yinelenmeyen kişi assignment'larına dönüştürülür; assignment progress/timestamp/revision alanları normalize edilir.
- Eski sevkiyat ve shift durumları normalize edilir. Onaylanmış legacy sevkiyatların stok uygulanma/hareket referansları korunarak yeniden stok etkisi oluşturması engellenir; eski yayınlanmış vardiya planları yayınlanmış olarak kalır.
- Pasif veya silinmiş personel referansları fiziksel olarak silinmez; assignment, sevkiyat, shift ve stok hareketlerinde snapshot/durum metadata'sı korunur. Güvenle dönüştürülemeyen kayıtlar `workforceMigrationArchive` içinde saklanır ve idempotent migration sonucu `workforceMigrationState` ile takip edilir.

Arayüz ve responsive sonuç:

- Yönetici görev formuna sıralanabilir maddeler, acil öncelik, teslim saati, yönetici notu, hedef özeti, durum filtreleri, kişi bazlı ilerleme ve aktivite görünümü eklendi. Sevkiyat filtreleri/detayı, zorunlu ret nedeni ve tek işlem uyarısı; Shift alanında boş gün, taslak öneri açıklaması ve yayın ayrımı tamamlandı.
- Personel Yapılacaklar ekranı gerçek assignment filtreleri ve salt-okunur iptal durumu; Sevkiyat ekranı backend stok kataloğu, anlamlı birimler, dönüşüm özeti, birleşen sepet satırı ve erişilebilir sticky işlem alanı; Shift ekranı geçmiş tarih koruması, form state'i ve revision çatışması geri bildirimi kullanır.
- Faz 1–4 ortak bej/kahverengi tasarım token'ları, sidebar, canlı önizleme, Excel Veri Merkezi, fiyat, QR menü, reçete, stok ve publish sözleşmeleri korunmuştur. Paralel workforce modeli, ikinci stok listesi veya ikinci event listener oluşturulmamıştır.

Değişen temel dosyalar:

- `apps/api/src/workforce-routes.js`
- `apps/api/src/app.js`
- `apps/api/src/store/migrations.js`
- `apps/api/src/store/file-store.js`
- `apps/admin/index.html`
- `apps/admin/scripts/app.js`
- `apps/admin/scripts/workforce.js`
- `apps/admin/styles/admin-compact.css`
- `apps/personel/workforce.js`
- `apps/personel/personel.css`
- `apps/api/tests/integration.test.js`
- `apps/api/tests/product-code-registry.test.js`
- `apps/api/tests/server-routes.test.js`
- `apps/api/tests/workforce-migration.test.js`
- `REVISION_STATE.md`

Doğrulama sonucu:

- Faz 5 hedefli paket; görev assignment bağımsızlığı, task idempotency/revision, iptal kilidi, geçmiş tarih ve duplicate shift talebi, taslak gizliliği, yayın replay'i, oturum/polling, kalıcı silme modalı, migration idempotency ve sevkiyatın kodla tek stok etkisi dahil `46/46` başarılıdır.
- `npm run check`: başarılı; 20 kritik JavaScript dosyası, 7 HTML yerel bağlantısı ve 5 kritik runtime SVG yolu doğrulandı.
- `npm test`: başarılı; 94 testten 93'ü geçti, hata yok; geçici olarak pasif Site modülüne ait 1 test bilinçli atlandı. İlk koşuda store şemasını `11` yapan Faz 5 migration'ına karşı eski ürün-kodu testinin sabit `10` beklentisi görüldü; beklenti yeni şema sürümüne güncellendi ve tam paket yeniden temiz geçti.

Sonraki faza bırakılanlar: Faz 6'nın PWA ve nihai güvenlik kapsamı bu fazda başlatılmadı. Faz 5 dışındaki Excel katalog/fiyat verisi değiştirilmedi; otomatik shift önerisinin şube/rol kapasite optimizasyonu mevcut veri modelinde güvenilir şube/rol ihtiyaç verisi bulunmadığı için uygulanmayan sınırlama olarak açıkça raporlanır.

## Faz 6 Öncesi Ara Revizyon — Uygulama Kimliği ve Shift Yerleşimi

Uygulama kimliği ve ikon altyapısı:

- Dijital Menü, Personel ve Yönetici için birbirinden bağımsız manifestler sırasıyla `/qr-menu/manifest.webmanifest`, `/personel/manifest.webmanifest` ve `/panel/manifest.webmanifest` yollarında tanımlandı. Kimlikler ve kapsamlar `/`, `/personel/` ve `/panel/` olarak ayrıldı.
- Her uygulama için 32×32 ve 48×48 favicon, 180×180 Apple Touch Icon, 192×192 ve 512×512 normal/maskable ikon ile 1024×1024 kaynak PNG üretildi. Personel görev/onay, Yönetici dişli/anahtar deliği rozetiyle aynı Tahmisçi ailesinde fakat ilk bakışta ayrışır; maskable dosyalar güvenli iç boşlukla ayrıca üretilir.
- `scripts/generate-app-icons.py` mevcut hafif Pillow çalışma ortamıyla deterministik boyut üretimi ve alfa/boyut doğrulaması sağlar; projeye yeni runtime bağımlılığı eklenmedi.
- Üç giriş HTML'i yalnız kendi manifest, favicon, Apple Touch Icon ve tema rengini yükler. Müşteri menüsündeki `siteInfo.favicon` / `seo.favicon` zinciri ve Yönetici ayarından yayınlanan dinamik favicon davranışı değiştirilmedi.
- Yeni service worker veya cache-first kuralı eklenmedi. API, oturum, workforce, Excel Veri Merkezi, yükleme ve SSE yolları mevcut ağ davranışını sürdürür; tam offline çalışma Faz 6'ya bırakıldı.

Shift Yönetimi yerleşimi:

- `apps/admin/styles/admin.css` Shift geometrisinin tek kaynak dosyası yapıldı: masaüstünde `250px minmax(0, 1fr) 296px`, 16px aralık; orta genişlikte talepler alt satıra, dar görünümde tüm bölümler tek kolona geçer.
- `apps/admin/styles/admin-compact.css` içindeki çakışan 170/180/230px kolon ve haftalık çizelge override'ları kaldırıldı. Saat satırları `minmax(0, 1fr) auto minmax(0, 1fr)` kullanır; inputlar yüzde yüz genişlik, sıfır minimum genişlik ve border-box ile kart içinde kalır.
- Haftalık çizelgede gerektiğinde yalnız çizelge alanı yatay kayar; personel sütunu opak sticky kalır. Talep başlığı ve bekleyen rozeti doğru shrink/nowrap davranışı, talep işlem butonları eşit kolon kullanır.
- `apps/admin/scripts/workforce.js` yalnız saat ayraçlarını erişilebilir ayrı hücrelere dönüştürdü; mevcut Shift endpointleri, event listener'lar, idempotency ve yayın akışı değişmedi.

Değişen temel dosyalar:

- `apps/qr-menu/index.html`, `apps/qr-menu/manifest.webmanifest`
- `apps/personel/index.html`, `apps/personel/manifest.webmanifest`
- `apps/admin/index.html`, `apps/admin/manifest.webmanifest`
- `apps/admin/styles/admin.css`, `apps/admin/styles/admin-compact.css`
- `apps/admin/scripts/workforce.js`
- `public/assets/app-icons/menu/*`, `public/assets/app-icons/personel/*`, `public/assets/app-icons/yonetici/*`
- `scripts/generate-app-icons.py`
- `apps/api/scripts/check-static-assets.js`
- `apps/api/tests/integration.test.js`, `apps/api/tests/server-routes.test.js`
- `REVISION_STATE.md`

Hedefli doğrulama:

- Üç HTML kimliği, manifest ayrımı, ikon zinciri ve dinamik menü favicon koruması hedefli testte başarılıdır.
- Üç manifest ve 24 üretim ikonunun gerçek HTTP yolları `200`, doğru MIME ve PNG boyutlarıyla doğrulandı.
- Shift kaynak/geometri sözleşmesi hedefli testte başarılıdır; gerçek workforce Shift talep onayı, taslak, uygulama, yayın ve idempotent replay testi geçti.
- İzole gerçek Yönetici oturumunda 1440×900 ölçümünde sidebar açık ve kapalıyken belge genişliği viewport ile eşit kaldı; altı saat inputunun tamamı kart içinde, talep rozeti nowrap ve başlıkla çakışmasızdı. 1024×768 ölçümünde talepler alta geçti, global yatay taşma oluşmadı ve yalnız haftalık çizelge kontrollü yatay kaydı.

Sonraki faza bırakılanlar: tam offline service worker, güncelleme bildirimi ve Faz 6 güvenlik kapsamı başlatılmadı. Bu ara revizyonda bilinen işlevsel engel yoktur.

## Faz 6 — Üç PWA, Güvenlik Sertleştirmesi ve Nihai Teslim

- QR Menü, Personel ve Yönetici uygulamaları sırasıyla `/`, `/personel/` ve `/panel/` kapsamlarında bağımsız manifest, service worker, offline kabuk, uygulama kimliği ve cache adı kullanır. Navigasyon ağ önceliklidir; yalnız güvenli statik dosyalar cache'e alınır.
- API, auth, Yönetici, workforce, Excel aktarımı, SSE, mutasyon, kişisel yanıt, `no-store`, `private`, `Set-Cookie`, JSON ve event-stream yanıtları service worker cache kapsamının dışındadır. Çevrimdışı yazma işlemleri başarı gibi gösterilmez.
- Waiting worker güncellemesi “Yeni sürüm hazır.” bildirimi ve “Şimdi Güncelle” onayıyla uygulanır. Kaydedilmemiş form varken kullanıcı uyarılır; `controllerchange` yalnız bir yenileme üretir.
- Aktif QR Menü, Personel, Yönetici, Reçete ve kimlik yüzeylerinin Google Fonts/Flaticon çalışma zamanı bağımlılığı kaldırıldı; yerel font, SVG ve ikonlar kullanılır. Aktif kimlik sayfalarındaki inline JavaScript yerel statik dosyalara taşındı.
- Normal API gövdesi, Excel analizi, avatar, görsel ve video yüklemeleri endpoint bazında sınırlandı. Dosya uzantısı, MIME ve gerçek imza birlikte doğrulanır; XLSX ZIP/path/expanded XML sınırları uygulanır.
- CSP, origin/fetch metadata, hassas yanıt `no-store`, kontrollü medya sunumu, rate limit, log redaksiyonu, production credential/veri yolu/trust proxy doğrulaması ve güvenli health çıktısı sertleştirildi. Graceful shutdown devam eden FileStore yazma kuyruğunu `drain()` ile tamamlar.
- Yerel smoke güncel boş katalog ve üç PWA mimarisine taşındı. Üretim ortam değişkenleri, kalıcı disk, backup/restore, HTTPS, proxy, rollback ve yayın sonrası smoke adımları `RELEASE_CHECKLIST.md` içinde kayıtlıdır.
- Değiştirilen ana alanlar: üç uygulamanın HTML/manifest/service worker/offline dosyaları; `shared/scripts/pwa-*`, `shared/styles/pwa-ui.css`; yerel kimlik scriptleri; API app/config/server/store/XLSX/güvenlik katmanı; smoke, kritik JS/statik varlık kontrolleri ve Faz 6 regresyon testleri.
- Son doğrulama: `npm test` — 113 test, 112 başarılı, 1 bilinçli skip, 0 hata; `npm run check` başarılı (32 kritik JS, 14 HTML, 5 SVG, 9 PWA yolu); `npm run check:duplicates` başarılı; `npm run test:local` başarılı.

Bilinen kod engeli yoktur. DNS, HTTPS sertifikası, gerçek production secret'ları, kalıcı disk mount'u ve dış backup hedefi dağıtım ortamı sorumluluğundadır. Kaynak kod **Nihai teslim adayı** durumundadır.

## Faz 6 Sonrası — Kalıcı Bildirim, Hatırlatma ve Teslim Sistemi

Backend ve kalıcı veri:

- Store şeması `13` sürümüne yükseltildi. `notifications`, `notificationPreferences`, `notificationOutbox`, `pushSubscriptions` ve `notificationSchedulerState` mevcut store'a geriye uyumlu/idempotent migration ile eklendi; menü, fiyat, reçete, stok, workforce, kullanıcı ve audit verileri korunur.
- Uygulama içi kayıt tek güvenilir bildirim kaynağıdır. E-posta ve Web Push aynı kayda bağlı outbox teslimleridir. Alıcı + olay `dedupeKey` ve kanal outbox anahtarı çift bildirim/teslimi engeller; retention okunmamış kayıtları ve bekleyen teslimleri düşürmez.
- Merkezi servis; güvenli metadata projeksiyonu, kategori/önem normalizasyonu, sahiplik, tercih, read/unread/archive, cursor/limit, kritik sistem bildirimi ve SSE yayınını yönetir. Personel başka kullanıcının kaydına erişemez; alıcı kimliği yalnız oturumdan çözülür.
- Backend scheduler yaklaşık 60 saniyede görev için 24 saat/2 saat/gecikme, yayınlanmış vardiya için 12 saat/2 saat hatırlatması üretir. Çakışan tick süreç kilidi ve store lease ile engellenir; tamamlanan/iptal edilen görev, izinli veya eski vardiya atlanır; değişen zaman/yayın revizyonu dedupe anahtarına girer.
- Ortak Nodemailer servisi şifre sıfırlama akışını koruyarak bildirim e-postasını da taşır. Outbox ağ çağrısını ana mutasyondan ayırır; 1 dakika, 5 dakika, 30 dakika ve 2 saat geri çekilmesi, maksimum deneme, maskelenmiş hata ve yeniden deneme sağlar. Kritik olmayan e-posta/push sessiz saat sonuna deneme tüketmeden ertelenir.
- `web-push` ve VAPID yapılandırması eklendi. Abonelik Yönetici/personel kimliğine bağlıdır; `404/410` aboneliği kaldırır, ana bildirimi silmez. Nodemailer `9.0.5` sürümüne yükseltilerek bilinen güvenlik uyarıları kapatıldı; dosya/URL erişimi mail seviyesinde devre dışıdır.

Gerçek olay bağlantıları:

- Görev atama, içerik/öncelik/teslim/kişi güncelleme, kaldırma, başlama ve tamamlama olayları etkilenen personele veya Yöneticiye kalıcı bildirim üretir. Küçük ilerleme değişimleri e-posta spam'i oluşturmaz.
- Sevkiyat bildiriminde Yönetici bilgilendirilir ve stok değişmez. Onay/red sonucu yalnız bildiren personele gider; onay exactly-once stok hareketini, tekrar isteklerde tek bildirim/tek stok etkisini korur.
- Vardiya/izin talebi ve kararı gerçek alıcıya gider. Taslak bildirim üretmez; yalnız yayınlanan ve değişen plan, yayın revizyonu ile etkilenen personele gönderilir.
- Reçete/eğitim/sınav atama, kaldırma, tamamlama ve tekrar-gerekli olayları; stok kritik/güvenli eşik geçişleri gerçek store mutasyonlarının tamamlandığı noktaya bağlandı. Personel pasifleştirme/kalıcı silme push aboneliklerini kaldırır ve bekleyen outbox teslimlerini iptal eder.

API ve arayüz:

- Personel için `/api/notifications`, Yönetici için `/api/admin/notifications` köklerinde liste, okunmamış sayaç, read/unread/archive/read-all, tercihler, push aboneliği ve yetkili SSE uçları eklendi. Yönetici ayrıca test bildirimi, teslim sağlığı ve başarısız outbox yeniden deneme uçlarına sahiptir.
- Yönetici ve Personel PWA'larına erişilebilir zil/`99+` rozeti, sağ çekmece, filtre, yükleniyor/hata/boş durum, deep link, kalıcı tercih, e-posta, hatırlatma, sessiz saat ve kullanıcı eylemiyle Web Push izni eklendi. SSE bağlantısı kontrollü polling/fetch yedeği kullanır.
- Her iki service worker push ve güvenli `notificationclick` yönlendirmesini destekler; bildirim API, auth, SSE ve abonelik yanıtları cache dışıdır. Mevcut offline/güncelleme davranışı korunur.

Yapılandırma ve dokümantasyon:

- `.env.example` dosyalarına `NOTIFICATIONS_EMAIL_ENABLED`, `NOTIFICATIONS_MANAGER_EMAIL`, VAPID alanları, worker açma/interval, 60 saniyelik reminder interval ve maksimum deneme eklendi. Otomatik worker test ortamında varsayılan kapalı, development/production ortamında açıktır.
- SMTP, VAPID, olay matrisi, API, güvenlik, outbox, scheduler, sessiz saat ve manuel kabul akışı `docs/NOTIFICATION_SYSTEM.md` içinde belgelendi.

Değişen temel dosyalar:

- `apps/api/src/notification-service.js`, `notification-routes.js`, `notification-scheduler.js`, `notification-delivery.js`
- `apps/api/src/mail-service.js`, `push-service.js`, `workforce-routes.js`, `app.js`, `config.js`
- `apps/api/src/store/file-store.js`, `store/migrations.js`, `apps/api/package.json`, `package-lock.json`
- `apps/admin/index.html`, `apps/admin/scripts/app.js`, `apps/admin/styles/notifications.css`, `apps/admin/sw.js`
- `apps/personel/index.html`, `personel.js`, `notifications.js`, `notifications.css`, `sw.js`
- `.env.example`, `apps/api/.env.example`, `scripts/check-critical-js.js`, `docs/NOTIFICATION_SYSTEM.md`, `TASK_STATE.md`
- Bildirim backend, olay, Yönetici/Personel UI ve service worker regresyon testleri.

Son doğrulama:

- Bildirim hedefli paketi; migration, retention, dedupe, görev/vardiya hatırlatmaları, sessiz saat, stok eşiği, outbox retry, SMTP kapalı, Push 410, yetki/cursor/preference, SSE, Yönetici/Personel UI ve gerçek görev–sevkiyat–shift–eğitim rotaları dahil başarılıdır.
- `npm test`: 146 test, 145 başarılı, 1 bilinçli pasif Site testi, 0 hata.
- `npm run check`: başarılı; 39 kritik JavaScript, 14 HTML yerel bağlantısı, 5 runtime SVG ve 9 PWA yolu doğrulandı.
- `npm run check:duplicates`: başarılı; yinelenen production asset bulunmadı.
- `npm run test:local`: başarılı; boş katalog, oturum, üç PWA ve 37 güncel HTML/statik bağlantı gerçek HTTP üzerinden doğrulandı.
- `npm audit`: bilinen güvenlik açığı bulunmadı.

Bilinen kod engeli yoktur. Gerçek SMTP/VAPID teslimi için production ortamına geçerli secret ve alan adı değerlerinin girilmesi gerekir; yapılandırma yokken uygulama içi bildirim çalışır ve dış kanal ana işlemi başarısız yapmaz.
