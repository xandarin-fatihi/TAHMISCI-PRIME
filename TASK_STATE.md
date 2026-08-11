# TAHMİSÇİ Çalışma Durumu

## Kaynak ve hedef

Tek geçerli kaynak açık `TAHMISCI-SITE` çalışma ağacıdır. ZIP/arşiv kopyaları kaynak kabul edilmez. Hedef; QR Menü, Yönetici ve Personel uygulamalarını aynı kalıcı backend, Excel Veri Merkezi ve yetki modeli üzerinde üretime hazır bir teslim adayı hâline getirmektir. Ayrıntılı değişiklik geçmişinin ana kaydı `REVISION_STATE.md` dosyasıdır.

## Aktif durum

Faz 6 ile Faz 6 sonrası kalıcı bildirim sistemi tamamlandı. Faz 1–5 kazanımları korunarak final kabul kapısındaki `npm test`, `npm run check`, `npm run check:duplicates` ve `npm run test:local` komutlarının tamamı güncel mimari üzerinde başarıyla sonuçlandı. Kaynak kod **Nihai teslim adayı** durumundadır.

## Faz özeti

- **Faz 1 — Temel sözleşmeler:** Yönetici/personel oturum ayrımı, request-origin koruması, ortak işlem koordinatörü, revision/idempotency ve taslak/yayın ayrımı tamamlandı.
- **Faz 2 — Ortak panel sistemi:** Bej–krem–espresso tasarım tokenları, doğal kompakt yoğunluk, tek dikey scroll sahibi, responsive sidebar ve ortak buton/form sistemi tamamlandı.
- **Faz 3 — Canlı önizleme:** Kısa ömürlü ve salt-okunur preview oturumu, izinli origin/iframe zinciri, güvenli taslak geçmişi ve doğrulanmış yayın akışı tamamlandı.
- **Faz 4 — Fiyatlandırma:** Tek kanonik fiyat modeli, dinamik fiyat tipleri, toplu fiyat, Excel analiz/uygulama, audit, revision ve güvenli geri alma tamamlandı.
- **Faz 5 — Workforce:** Kişi bazlı görev ilerlemesi, sevkiyatın yalnız Yönetici onayıyla tek stok etkisi, vardiya taslak/yayın ayrımı, personel yaşam döngüsü, migration ve polling/oturum dayanıklılığı tamamlandı.
- **Faz 6 — Nihai teslim:** Üç bağımsız PWA kapsamı, sınırlı güvenli cache, çevrimdışı durum, kontrollü güncelleme, dış runtime bağımlılıklarının temizlenmesi, güvenlik/üretim kontrolleri, güncel lokal smoke ve release dokümantasyonu tamamlandı.
- **Faz 6 sonrası — Bildirim merkezi:** Yönetici/personel için kalıcı uygulama içi bildirim, yetkili SSE, backend görev/vardiya hatırlatmaları, ortak SMTP outbox, Web Push, sessiz saat, teslim sağlığı ve gerçek olay bağlantıları tamamlandı.

## Kanonik veri ve backend

- Menü, fiyat, reçete ve stok kataloglarının tek aktarım kapısı backend Excel Veri Merkezi'dir. Dosyalar analiz edilmeden canlı store'a yazılmaz; apply atomik, revision kontrollü, idempotent, auditli ve geri alınabilirdir.
- Çalışma zamanı istemcileri katalogları yalnız API'den okur. Boş store geçerli durumdur; seed veya frontend fallback ürünü oluşturulmaz.
- Kalıcı ürün/kategori/reçete/stok kimlikleri ve ürün kodu sicili korunur. Excel kaynak durumu, arşivleme ve manuel aktif/pasif sahipliği birbirini ezmez.
- Store şeması migration ile geriye uyumlu ilerler; kullanıcı verisi sıfırlanmaz. Kalıcı yazımlar geçici dosya + atomik rename kullanır.
- Devre dışı eski website modülünün `/api/site` sözleşmesi `410 Gone`; QR Menü public veriyi `/api/public/bootstrap` üzerinden alır.

## Uygulamalar ve oturumlar

- **QR Menü:** `/`, manifest `/qr-menu/manifest.webmanifest`, PWA kapsamı `/`.
- **Personel:** `/personel/`, manifest `/personel/manifest.webmanifest`, PWA kapsamı `/personel/`.
- **Yönetici:** `/yonetici/`, manifest `/yonetici/manifest.webmanifest`, PWA kapsamı `/yonetici/`; eski `/panel/` yalnız 301 uyumluluk yönlendirmesidir.
- Yönetici ve personel cookie/oturumları ayrıdır. Yönetici cookie'si personel kimliği sayılmaz; personel işlemleri yalnız oturumdaki aktif personele uygulanır.
- Hassas veya kişiye özel API cevapları service worker/cache alanına yazılmaz. Çevrimdışıyken yazma işlemi başarılı gibi gösterilmez.

## Korunan işlevsel sözleşmeler

- `/yonetici/`, legacy `/panel/` 301 yönlendirmesi, `/api/admin/**`, `/personel/`, `/api/workforce/**` ve mevcut auth yolları.
- Menü, reçete, stok, fiyat, görev, sevkiyat, vardiya, izin, audit, SSE ve publish veri modelleri.
- Yönetici onayından önce sevkiyatın stoğu değiştirmemesi; onay replay'inin ikinci stok etkisi oluşturmaması.
- Personel görev ilerlemesinin assignment bazında bağımsız olması; yalnız yayınlanan shift planının personelde görünmesi.
- Excel apply/hash/readback/rollback ve geri alma sözleşmesi.
- Canlı önizleme, logo/sidebar, profil ve responsive panel davranışları.

## Nihai doğrulama kapısı

1. `npm test`
2. `npm run check`
3. `npm run check:duplicates`
4. `npm run test:local`
5. `RELEASE_CHECKLIST.md` üzerindeki ortam, depolama, proxy, backup ve işlevsel kabul maddeleri üretim ortamında doğrulanır.

Kod kabul kapısı sonucu: `npm test` 146 testte 145 başarılı, 1 bilinçli skip ve 0 hata; diğer üç komut da hatasız tamamlandı.

## Bilinen operasyonel sınır

Domain/DNS, HTTPS sertifikası, production secret değerleri, kalıcı disk bağlama ve dış backup hedefi repository tarafından otomatik sağlanmaz; dağıtım sahibi `RELEASE_CHECKLIST.md` ile bunları üretim ortamında tamamlar. Canlı Excel apply yalnız analiz sonucu `canApply=true` olduğunda yapılır. Çalışma ağacındaki kullanıcı değişiklikleri korunur; otomatik reset, clean, ZIP veya örnek veri yükleme yapılmaz.
