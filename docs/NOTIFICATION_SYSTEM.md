# Tahmisçi Bildirim Sistemi

## Mimari

Bildirimlerin tek güvenilir kaynağı kalıcı file-store içindeki `notifications` kayıtlarıdır. Push ve e-posta, aynı bildirime bağlı `notificationOutbox` teslim işleridir; ana görev, sevkiyat, vardiya, eğitim veya stok işlemi dış ağ teslimini beklemez. `dedupeKey` aynı olayın aynı alıcı için ikinci kez oluşturulmasını, outbox kanal anahtarı da çift e-posta/push teslimini engeller.

Kalıcı alanlar:

- `notifications`: alıcı, kategori, olay, güvenli içerik, deep link, okundu/arşivlendi zamanları ve dedupe anahtarı.
- `notificationPreferences`: Yönetici/personel kanal, kategori, hatırlatma, sessiz saat ve e-posta tercihleri.
- `notificationOutbox`: sınırlı denemeli e-posta ve Web Push kuyruğu.
- `pushSubscriptions`: oturum sahibine bağlı tarayıcı abonelikleri.
- `notificationSchedulerState`: hatırlatma tarayıcısının kısa süreli lease bilgisi.

Eski store dosyaları migration sırasında bu alanlarla idempotent biçimde genişletilir. Mevcut menü, reçete, stok, workforce, audit ve kullanıcı kayıtları değiştirilmez. Okunmamış bildirimler retention sırasında korunur.

## Olay matrisi

| Kaynak olay | Alıcı | Kategori | Teslim |
| --- | --- | --- | --- |
| Görev atandı, güncellendi veya kaldırıldı | Etkilenen personel | `task` | Uygulama içi, tercihe göre push/e-posta |
| Göreve başlandı veya görev tamamlandı | Yönetici | `task` | Uygulama içi, tercihe göre push/e-posta |
| Göreve 24 saat/2 saat kaldı veya süre geçti | Görev sahibi | `task` | Backend scheduler üzerinden bir kez |
| Sevkiyat bildirildi | Yönetici | `shipment` | Stok değişmeden bildirim |
| Sevkiyat onaylandı veya reddedildi | Bildiren personel | `shipment` | Exactly-once stok akışından sonra sonuç bildirimi |
| Vardiya/izin talebi gönderildi | Yönetici | `shift` | Uygulama içi, tercihe göre push/e-posta |
| Talep onaylandı veya reddedildi | Talep sahibi | `shift` | Yönetici notunun güvenli özetiyle |
| Vardiya planı yayınlandı veya değişti | Yalnız etkilenen personel | `shift` | Yayın revizyonu ile dedupe; taslakta bildirim yok |
| Vardiyaya 12 saat/2 saat kaldı | Vardiya sahibi | `shift` | Backend scheduler üzerinden bir kez; izinli gün hariç |
| Eğitim/reçete/sınav atandı, kaldırıldı, tamamlandı veya tekrar gerekli | İlgili personel/Yönetici | `training` | Uygulama içi, tercihe göre push/e-posta |
| Stok ilk kez kritik eşiğe düştü veya güvenli seviyeye döndü | Yönetici | `stock` | Eşik çevrimi ve ürün kimliği ile dedupe |

## API ve yetkilendirme

Ortak bildirim yolları aktif oturumdan rol ve kimliği çözer; istemciden gönderilen bir alıcı kimliğine güvenmez:

- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/:id/unread`
- `PATCH /api/notifications/:id/archive`
- `POST /api/notifications/read-all`
- `GET|PUT /api/notifications/preferences`
- `POST|DELETE /api/notifications/push-subscriptions`
- `GET /api/notifications/events`

Yönetici paneli aynı sözleşmenin `/api/admin/notifications` kökünü ve ayrıca teslim sağlığı/yeniden deneme yollarını kullanır. Mutasyonlar mevcut origin/CSRF ve idempotency yaklaşımına tabidir. Listeleme cursor/limit ile sınırlıdır. SSE yalnız oturum sahibinin güvenli bildirim projeksiyonunu gönderir, heartbeat kullanır ve cache dışıdır.

## E-posta kurulumu

Bildirim e-postaları ve şifre sıfırlama aynı ortak Nodemailer servisinden yararlanır. Gizli bilgiler yalnız environment üzerinden verilir:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
NOTIFICATIONS_EMAIL_ENABLED=false
NOTIFICATIONS_MANAGER_EMAIL=
```

E-posta kapalı veya SMTP eksikse ana iş ve uygulama içi bildirim başarıyla tamamlanır; teslim işi yapılandırılmamış/başarısız olarak izlenir. Geçici hatalarda sırasıyla yaklaşık 1 dakika, 5 dakika, 30 dakika ve 2 saat gecikmeyle yeniden denenir. Saklanan hata özeti kullanıcı adı, parola veya transporter ayrıntısı içermez.

## Web Push kurulumu

VAPID anahtarlarını kaynak koda yazmayın:

```env
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:bildirimler@example.com
```

Push izni yalnız kullanıcının “Bildirimleri etkinleştir” eyleminden sonra istenir. Abonelik oturum sahibine bağlanır. Push sağlayıcısından `404` veya `410` dönmesi halinde geçersiz abonelik kaldırılır; ana bildirim kaydı korunur. Service worker tıklaması mevcut PWA penceresinde güvenli deep linki açar veya yeni pencere oluşturur. Bildirim API’leri, SSE ve abonelik mutasyonları service worker cache’ine girmez.

## Scheduler ve teslim worker'ı

Sunucu hazır olduğunda hatırlatma scheduler'ı ve sınırlı batch işleyen outbox worker'ı başlar. Scheduler varsayılan olarak 60 saniyede bir çalışır, çakışan tick'leri süreç içi kilit ve store lease ile engeller, timer'ları `unref` eder. E-posta ve push teslimleri kritik olmayan bildirimlerde kullanıcının sessiz saat bitimine, deneme hakkı tüketmeden ertelenir. Sunucu kapanırken iki worker durdurulur ve mail servisi kapatılır. Zaman hesabı `Europe/Istanbul` varsayımıyla, testlerde enjekte edilebilir saat üzerinden yapılır.

```env
NOTIFICATION_WORKERS_ENABLED=true
NOTIFICATION_WORKER_INTERVAL_MS=15000
NOTIFICATION_REMINDER_INTERVAL_MS=60000
NOTIFICATION_MAX_ATTEMPTS=5
```

## Arayüz

Yönetici ve Personel PWA'larında erişilebilir zil, `99+` sınırlı okunmamış rozeti, sağ çekmece, kategori/okunmamış filtreleri, okuma-arşivleme eylemleri, deep link ve kanal tercihleri bulunur. SSE ilk tercihtir; bağlantı kesilirse kontrollü fetch/polling devam eder. Push desteği olmayan tarayıcıda yalnız push kontrolü devre dışı kalır.

## İşletim ve manuel doğrulama

1. Yönetici ve personeli ayrı oturumlarda açın.
2. Yönetici görev atadığında personel rozetinin yenilemesiz arttığını ve görev deep linkini doğrulayın.
3. Personel görevi tamamladığında Yönetici bildiriminin geldiğini doğrulayın.
4. Sevkiyat bildirimi sırasında stoğun değişmediğini; onayda yalnız bir kez arttığını ve sonucun personele ulaştığını doğrulayın.
5. Taslak vardiyada bildirim olmadığını, yayınlanan/değişen vardiyada yalnız etkilenen personele bildirim gittiğini doğrulayın.
6. E-posta/push tercihlerini kullanıcı etkileşimiyle açıp tek teslim oluştuğunu doğrulayın.
7. Mobil ve masaüstünde çekmece, odak sırası, çevrimdışı durum ve PWA güncelleme akışını kontrol edin.
