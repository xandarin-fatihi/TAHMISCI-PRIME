# Tahmisçi Müdavim Sistemi

Bu alan yayın öncesi UI prototipidir. Backend, database, gerçek SMS/OTP, Google auth veya API endpoint içermez.

## Amaç

Tahmisçi müşterisinin dijital müdavim kartıyla ziyaretlerini takip etmesini ve 10 içecekte 1 tatlı hakkı kampanyasını net görmesini sağlamak.

## Girişsiz Landing

- `/mudavim` ilk açılışta kart/dashboard göstermez.
- Ekran sade karşılama, fayda maddeleri ve `Giriş Yap` / `Kayıt Ol` çağrılarıyla açılır.
- Sağdaki eski büyük kart kaldırıldı; kahve görseli yalnızca yumuşak hero atmosferi olarak kullanılır.
- Girişsiz header: `Giriş Yap`, `Kayıt Ol`, `Kampanyalar`, `Siteye Dön`.

## Giriş Akışı

- Giriş yöntemi telefon numarası + şifredir.
- `Beni hatırla`, `Şifremi unuttum?` ve Google ile devam UI seçenekleri bulunur.
- Telefon ve şifre doluysa mock state giriş başarılı kabul edilir.

## Kayıt Akışı

1. Telefon numarası alınır.
2. 6 haneli kod onay ekranı gösterilir.
3. Şifre ve şifre tekrar alanları doğrulanır.
4. Profil tamamlanır: ad soyad, profil adı, doğum tarihi, e-posta.
5. KVKK onayı zorunlu, kampanya bildirimi opsiyoneldir.
6. Başarı ekranından `Kartımı Gör` ile dashboard açılır.

## Dashboard

Giriş sonrası landing kapanır ve Müdavim paneli açılır:

- Müdavim Kartım
- QR / müşteri kodu
- Ziyaret ilerlemesi
- Aktif ödül
- Ödüllerim
- Kampanyalar
- Geçmiş ziyaretler
- Profil

Kart dili nötr tutulur: kişi adı yerine `Müdavim Kartım`, `Gold Müdavim`, `THM-4821`, `Kasada kodunu okut` gibi ürün dili kullanılır.

## Mock State

Mock state şu alanları taşır:

- `memberCode`
- `memberLevel`
- `visitCount`
- `rewardTarget`
- `activeReward`
- `recentVisits`
- `profile`
- `campaigns`

Gerçek veri yazılmaz; local UI state yalnızca sunum davranışı sağlar.

## Scroll ve Header

- Header 72-88px aralığında kompakt tutulur.
- Modal kapalıyken body scroll açıktır.
- Modal açıkken body scroll kilitlenir, kapanınca tekrar açılır.
- Mobilde yatay taşma engellenir.

## Backend Fazına Geçiş

- Gerçek SMS OTP sağlayıcı entegrasyonu.
- Telefon + şifre auth ve session yönetimi.
- KVKK/onay kayıtları.
- QR doğrulama ve kasada okutma akışı.
- Admin panelde kampanya ve ödül kuralları yönetimi.
- Admin panelde “Bugün doğum günü olan müdavimler” alanı.
- Favori içecek alanı ve kampanya bildirim tercihleri.
