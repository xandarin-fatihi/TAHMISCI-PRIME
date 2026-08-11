# Güvenlik Notları

- Runtime store, medya ve backup dosyaları `storage/` altında Git dışında tutulur.
- `.env` ve gerçek gizli bilgiler takip edilmez.
- `/recipe-data.js` ve `/menu-data.js` public değildir; admin oturumu gerektirir.
- Reçete API'leri public bootstrap içinde hazırlık ve gizli reçete alanlarını sızdırmaz.
- Production config lokal test verilerini ve zayıf geliştirme anahtarlarını reddeder.
