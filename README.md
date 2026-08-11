# TAHMISCI PRIME

Tahmisçi’nin QR menüsü, Yönetici paneli, Personel paneli ve Express API’sini tek çalışma alanında barındıran production kaynak deposudur. Kalıcı işletme verisi bu repoda tutulmaz; uygulama `DATA_FILE`, `MEDIA_DIR` ve `BACKUP_DIR` ile tanımlanan dış disk alanlarını kullanır.

## Uygulama girişleri

- `/` — yayınlanmış dijital menü
- `/yonetici/` — Tahmisçi Yönetici Paneli
- `/personel/` — Personel Paneli
- `/panel/` — geriye uyumluluk için `/yonetici/` yönlendirmesi
- `/api/health` — hassas veri içermeyen servis sağlık kontrolü

Teknik `/api/admin/**` rotaları ve `admin` rol anahtarı geriye uyumluluk için korunur.

## Gereksinimler

- Node.js 18 veya üzeri (production için güncel Node.js 20 LTS önerilir)
- npm
- HTTPS reverse proxy (örnek Nginx yapılandırması dahildir)
- Kalıcı store, medya ve yedek dizinleri
- Production süreç yöneticisi (örnekte PM2)

## Yerel geliştirme

```bash
npm ci
npm run dev:local
```

Yerel araçlar yalnız geliştirme içindir. `TAHMISCI_LOCAL_DEV` production ortamında kabul edilmez; production config doğrulaması lokal credential ve geçici veri yollarını reddeder.

## Doğrulama komutları

```bash
npm test
npm run check
npm run check:duplicates
npm run test:local
```

## Production dağıtımı

1. [`.env.production.example`](.env.production.example) dosyasını repo dışındaki güvenli bir konuma kopyalayın.
2. Placeholder ve domain değerlerini gerçek deployment değerleriyle değiştirin; dosyayı hiçbir zaman Git’e eklemeyin.
3. Kalıcı veri dizinlerini hazırlayın ve yalnız uygulama kullanıcısına yazma yetkisi verin.
4. [Dağıtım kılavuzunu](DEPLOYMENT.md) ve [yayın kontrol listesini](RELEASE_CHECKLIST.md) tamamlayın.

PM2 yapılandırması eksik production değişkenlerinde fail-fast davranır ve dosya tabanlı store bütünlüğü için tek instance çalıştırır. Örnek reverse proxy dosyası: [`deploy/nginx/tahmiscicoffee.com.conf.example`](deploy/nginx/tahmiscicoffee.com.conf.example).

## Güvenlik ve veri sınırı

- Gerçek `.env`, private key, sertifika, token ve parola repoya alınmaz.
- `storage/` içinde yalnız dizin iskeletini koruyan `.gitkeep` dosyaları versiyonlanır.
- Kullanıcı medyası, store, audit/revision kayıtları, yedekler, loglar ve geçici Excel analizleri Git dışında kalır.
- Production deploy’dan önce secret taraması, backup ve ayrı dizinde restore provası zorunludur.

Mimari ve işletim ayrıntıları için [`docs/`](docs/) dizinine bakın.
