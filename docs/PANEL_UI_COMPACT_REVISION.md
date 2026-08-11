# Panel UI ve Sistem Revizyonu

## Değiştirilen ana dosyalar

- `shared/styles/panel-foundation.css`
- `shared/scripts/save-coordinator.js`
- `shared/scripts/live-preview-receiver.js`
- `apps/admin/index.html`
- `apps/admin/styles/admin.css`
- `apps/admin/styles/admin-compact.css`
- `apps/admin/styles/admin-components.css`
- `apps/admin/scripts/app.js`
- `apps/admin/scripts/workforce.js`
- `apps/admin/scripts/live-preview.js`
- `apps/admin/scripts/pricing.js`
- `apps/personel/index.html`
- `apps/personel/personel.css`
- `apps/personel/personel-compact.css`
- `apps/personel/personel.js`
- `apps/personel/workforce.js`
- `apps/recipe/scripts/app.js`
- `apps/qr-menu/scripts/app.js`
- `apps/api/src/app.js`
- `apps/api/src/middleware/auth.js`
- `apps/api/src/publish-routes.js`
- `apps/api/src/pricing.js`
- `apps/api/src/pricing-excel.js`
- `apps/api/src/pricing-routes.js`
- `apps/api/src/public-bootstrap.js`
- `apps/api/src/store/migrations.js`
- `apps/api/src/workforce-routes.js`

## Scroll ve yoğunluk

- Personel dashboard `100dvh` kabuğuna alındı; `100svh` fallback olarak korundu.
- Dikey kaydırmanın tek sahibi admin/personel workspace alanı oldu.
- Workforce, stok ve profil bölümleri doğal akışta büyür; reçete iframe'i kendi kaydırmasını yönetir.
- Geniş shift ve sevkiyat tablolarında yalnızca kontrollü yatay kaydırma bırakıldı.
- Gizli workforce toolbar başlığı alan kaplamayacak şekilde kaldırıldı.
- 224–228 px açık sidebar, 68 px masaüstü ikon rayı, 40 px kontroller, 30–40 px sayfa başlıkları ve sıkı kart aralıklarıyla yaklaşık yüzde 75 görsel yoğunluk sağlandı.

## Tasarım sistemi

- Krem, bej, espresso, bakır ve durum renkleri ortak token katmanına taşındı.
- Yerel Poppins panel arayüzü; Georgia ana sayfa başlıkları için standartlaştırıldı.
- `.ui-button` primary, secondary, ghost, danger, icon, small ve block varyantları eklendi.
- Hover, active, `focus-visible`, disabled ve loading durumları ortaklaştırıldı.

## Admin paneli

- Topbar, sidebar, kartlar, formlar ve akordiyonlar ortak kompakt ölçülere getirildi.
- Admin navigasyonuna gerçek SVG ikonlar eklendi; tüm aktif sekmeler aynı shell yüzeyi ve kapalı ikon rayını kullanır.
- Personel Hesabı, Eğitim / Görev / Sınav Atama, Kayıt Defteri, Yapılacaklar, Sevkiyat ve Shift Yönetimi korunarak sıkılaştırıldı.
- Görev oluşturma/takip, sevkiyat liste/detay ve shift şablon/çizelge/talep düzenleri responsive hâle getirildi.
- Profil menüsüne gerçek ayarlar ve sunucu oturumunu sonlandıran çıkış eylemi bağlandı.
- Menü, ürün, stok, reçete ve fiyat alanlarına gerçek uygulama rotalarını kullanan ortak canlı önizleme bağlandı.
- Eşzamanlı personel önizlemeleri aynı mod için tek güvenli preview-token isteğini paylaşır.
- Esnek fiyat profili ve toplu fiyat düzenleme arayüzleri kalıcı API'lerle bağlandı.
- Excel fiyat şablonu için dosya, analiz, eşleşme, değişiklik önizlemesi, admin onayı ve sonuç aşamaları eklendi.

## Personel paneli

- Yapılacaklar, Sevkiyat ve Shift sayfaları tek workspace scroll'u içinde kompaktlaştırıldı.
- Görev maddesi, sevkiyat gönderimi ve shift talebi işlemleri backend cevabından sonra yenilenir.
- Sevkiyat kataloğu/sepeti ve haftalık shift kartları masaüstü, tablet ve mobil kırılımlarda düzenlendi.
- Reçete iframe'i yalnızca ilgili bölüm açıldığında yüklenir.

## Kalıcı oturum, yayın ve fiyat sözleşmesi

- Admin ve personel oturumları opaque kimlikli, HttpOnly cookie ve sunucu tarafında kalıcı kayıt kullanır.
- Önizleme erişimi süreli, hash saklanan ve yazma yetkisi olmayan token ile sınırlandırıldı.
- `POST /api/admin/publish` revision kontrolü, idempotency anahtarı ve tek atomik store işlemi kullanır.
- Menü, reçete, stok, workforce sevkiyat onayı ve fiyat yazımları ortak publish revision'ını günceller.
- Eski tek fiyat alanları geriye uyumlu biçimde kanonik fiyat seçeneklerine çevrilir; QR menü kanonik seçenekleri okur.
- Excel aktarımı kategori+ürün anahtarı, revision kontrolü ve idempotency ile atomik uygulanır; boş fiyat hücreleri mevcut değeri korur.

## Korunan ID, hook ve endpoint'ler

- Mevcut HTML ID'leri ve `data-*` hook'ları değiştirilmedi.
- Mevcut workforce, stok, reçete, auth ve public bootstrap yolları korunarak genişletildi.
- `onay_bekliyor`, `onaylandı`, `reddedildi`, `cancelled`, `draft` ve `published` durum değerleri korundu.
- Auth cookie, `credentials: "include"`, rol kontrolü ve request-origin doğrulaması korundu.

## Kapsam dışında bırakılanlar

- Müşteri sitesinin içerik ve görsel tasarım dili değiştirilmedi.
- Menü editöründe kullanıcıya sunulan özel font seçenekleri kaldırılmadı.
- Sahte kayıt, frontend-only başarı durumu ve paralel stok/personel veri kaynağı eklenmedi.
