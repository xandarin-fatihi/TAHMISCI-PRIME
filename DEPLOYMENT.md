# TAHMISCI PRIME Production Dağıtımı

Bu kılavuz tek sunucuda Nginx + PM2 örneğini açıklar. Gerçek secret, store, kullanıcı medyası ve yedekler uygulama checkout’u dışında tutulur.

## 1. Sunucu önkoşulları

- Güncel Linux dağıtımı ve yalnız gerekli portlara izin veren firewall
- Node.js 20 LTS (uygulamanın alt sınırı Node.js 18)
- npm ve PM2
- Nginx ve geçerli TLS sertifikası
- Uygulamayı root olmayan ayrı bir sistem kullanıcısı ile çalıştırma
- Store, medya ve yedek için izlenen kalıcı disk

Örnek dizinler:

```text
/srv/tahmisci/current                 salt-okunur uygulama checkout'u
/etc/tahmisci/tahmisci.env           chmod 600 production environment
/var/lib/tahmisci/store/store.json   kalıcı atomik store
/var/lib/tahmisci/media              kalıcı kullanıcı medyası
/var/backups/tahmisci                kalıcı yedekler
```

Uygulama kullanıcısına store dosyasının parent dizininde oluşturma, yazma ve atomik rename; medya ve yedek dizinlerinde gerekli okuma/yazma yetkilerini verin. Bu dizinleri Nginx ile doğrudan statik olarak yayınlamayın ve medya dizininde çalıştırma izni vermeyin.

## 2. Kurulum ve doğrulama

Temiz release checkout’unda:

```bash
npm ci --omit=dev
npm run check
npm test
```

Test/kalite adımını ayrı build aşamasında tüm bağımlılıklarla çalıştırıyorsanız production hostta yalnız `npm ci --omit=dev` yeterlidir. `node_modules` hiçbir zaman release arşivine veya Git’e eklenmez.

## 3. Production environment

`.env.production.example` dosyasını repo dışına kopyalayın:

```bash
sudo install -d -m 750 -o tahmisci -g tahmisci /etc/tahmisci
sudo install -m 600 -o tahmisci -g tahmisci .env.production.example /etc/tahmisci/tahmisci.env
```

Dosyada bütün `REPLACE_*` değerlerini bağımsız ve kriptografik rastgele secret’larla değiştirin. Örnek `example.com` domainlerini gerçek HTTPS originleriyle değiştirin. `JWT_SECRET` ile `PASSWORD_MANAGER_KEY` aynı değer olmamalıdır.

Production minimum sözleşmesi:

- `NODE_ENV=production`
- `MAIN_DOMAIN`, `ADMIN_DOMAIN`, `ALLOWED_ORIGINS`
- `JWT_SECRET`, `PASSWORD_MANAGER_KEY`
- `COOKIE_SECURE=true`, deployment’a uygun `COOKIE_SAME_SITE`
- tek yerel Nginx hop için `TRUST_PROXY=1` (`true` kullanmayın)
- repo dışında `DATA_FILE`, `MEDIA_DIR`, `BACKUP_DIR`
- `ALLOW_LOCALHOST_ORIGINS=false`

Hazır/migre edilmiş store’da `DEFAULT_PANEL_PASSWORD` ve `DEFAULT_RECIPE_PASSWORD` boş kalmalıdır. Yeni boş kurulumda gerekiyorsa güçlü tek kullanımlık değerleri yalnız ilk açılış için environment üzerinden verin, ilk girişte parolaları değiştirin ve ardından bu değerleri kaldırın.

SMTP kullanılmıyorsa `PASSWORD_RESET_EMAIL`, `SMTP_USER`, `SMTP_PASS` ve `SMTP_FROM` boş bırakılmalıdır. Web Push kullanılmıyorsa iki VAPID anahtarı da boş olmalıdır; tek bir VAPID anahtarı tanımlamayın. Uygulama içi bildirimler dış teslim kanalları olmadan çalışmaya devam eder.

## 4. Migration ve ilk yedek

Mevcut production store’u değiştirmeden önce servis trafiğini durdurun ve disk seviyesinde ayrı bir snapshot alın. Environment’ı yükleyerek migration ve uygulama yedeğini çalıştırın:

```bash
set -a
. /etc/tahmisci/tahmisci.env
set +a
npm --workspace tahmisci-menu-backend run backup
npm --workspace tahmisci-menu-backend run migrate
```

Komutların gerçek dış `DATA_FILE` ve `BACKUP_DIR` değerlerini kullandığını doğrulayın. Yedeğin checksum’ını ve okunabilirliğini kontrol edin. Restore provasını canlı store’un üstünde değil, ayrı bir dizin ve ayrı process üzerinde yapın.

## 5. PM2 ile başlatma

PM2 ecosystem dosyası minimum production environment eksikse başlatmayı reddeder. Dosya store kullandığı için `instances: 1` ve `fork` modu kasıtlıdır; cluster moduna geçmeyin.

```bash
cd /srv/tahmisci/current
set -a
. /etc/tahmisci/tahmisci.env
set +a
pm2 startOrReload apps/api/ecosystem.config.cjs --env production --update-env
pm2 save
```

Sunucu yeniden başlatmalarında PM2 startup servisini uygulama kullanıcısı için kurun. Environment dosyasını systemd `EnvironmentFile=` ile yükleyen kontrollü bir unit/drop-in tercih edin; secret’ları ecosystem dosyasına veya shell history’ye yazmayın.

Kontrol:

```bash
pm2 status
pm2 logs tahmisci-api --lines 100
curl --fail --silent http://127.0.0.1:8080/api/health
```

Başlangıç loglarında geçici JWT, varsayılan credential, lokal veri yolu veya config doğrulama uyarısı varsa trafiği açmayın.

## 6. Nginx ve HTTPS

`deploy/nginx/tahmiscicoffee.com.conf.example` dosyasını inceleyip `/etc/nginx/sites-available/` altında gerçek yapılandırmaya dönüştürün. Örnek:

- HTTP’yi HTTPS’e kalıcı yönlendirir ve `www` adresini canonical apex domaine taşır.
- Yönetici panelini ayrı alt alan adı açmadan aynı domain üzerindeki `/yonetici/` yolunda sunar.
- İstekleri yalnız `127.0.0.1:8080` upstream’ine yollar.
- SSE endpointlerinde proxy buffering/cache’i kapatır ve uzun read timeout kullanır.
- API cevaplarını proxy cache’e almaz.
- Service worker ile manifestleri revalidate/no-cache eder.
- Büyük medya/Excel akışları için üst sınırı 130 MB tutar; endpoint limitleri ayrıca Express tarafından uygulanır.
- `/panel` uyumluluk yönlendirmesini uygulamaya bırakır; `/yonetici/` tek canonical Yönetici yoludur.

TLS sertifikası örnekteki apex, `www` ve Yönetici hostlarını kapsamalıdır. HSTS’yi yalnız bütün alt domainlerin HTTPS üzerinden hazır olduğu doğrulandıktan sonra etkinleştirin.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Yayın kabulü

HTTPS üzerinden en az şu kontrolleri uygulayın:

```text
GET /                         200, yayınlanmış dijital menü
GET /yonetici/                Yönetici giriş/panel akışı
GET /personel/                Personel giriş/panel akışı
GET /panel/                   /yonetici/ canonical yönlendirmesi
GET /api/health               200 ve hassas olmayan cevap
```

Ardından iki oturumun ayrımını, publish akışını, dört Excel analiz/apply akışını, görev–sevkiyat–shift süreçlerini, SSE güncellemelerini ve üç PWA’nın manifest/service-worker/offline davranışını doğrulayın. Browser cache ve Service Worker testlerini gerçek HTTPS origininde yapın.

Secret taraması, `npm test`, `npm run check`, `npm run check:duplicates` ve mümkünse `npm run test:local` sonuçlarını release kaydına ekleyin. `test:local` production store üzerinde çalıştırılmaz; kendi izole local-smoke verisini kullanmalıdır.

## 8. Güncelleme ve rollback

Her deploy öncesi:

1. Store snapshot/uygulama yedeği alın ve readback doğrulayın.
2. Yeni checkout’ta bağımlılık, test ve statik kontrolleri tamamlayın.
3. Migration’ı dış `DATA_FILE` üzerinde kontrollü çalıştırın.
4. PM2’yi `startOrReload ... --update-env` ile yenileyin.
5. Health ve kritik smoke senaryoları geçmeden release’i tamamlandı saymayın.

Rollback gerektiğinde yeni trafiği durdurun, önceki uyumlu kod release’ine dönün ve yalnız şema uyumluluğu doğrulanmış snapshot’ı geri yükleyin. Mevcut store’u ayrıca saklamadan üzerine yazmayın. PWA rollback’inde Service Worker/cache sürümünün istemcileri eski hatalı worker’da bırakmadığını doğrulayın.

## 9. Operasyonel güvenlik

- Environment, PM2 dump, log ve backup dosyalarında secret/kişisel veri bulunmadığını periyodik tarayın.
- PM2/Nginx log rotation ve disk doluluk alarmı tanımlayın.
- Store write/rename, backup, 5xx, auth/rate-limit ve notification outbox hatalarını izleyin.
- Nginx yalnız gerekli hostları kabul etmeli; Node portu internete açılmamalıdır.
- TLS yenileme, backup retention ve ayrı lokasyona kopyalama otomasyonu izlenmelidir.
- Üretim secret’larını düzenli döndürün; Git geçmişine giren bir secret’ı yalnız silmekle yetinmeyip derhal revoke edin.

Nihai trafik açma kararı için `RELEASE_CHECKLIST.md` içindeki bütün maddeleri tamamlayın.
