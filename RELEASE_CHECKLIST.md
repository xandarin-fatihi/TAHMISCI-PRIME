# TAHMİSÇİ Üretim Yayın Kontrol Listesi

Bu liste her ilk kurulumda ve sürüm yükseltmesinde doldurulur. Secret, cookie, token, Excel içeriği veya müşteri/personel verisi bu belgeye yazılmaz.

## 1. Domain, DNS ve HTTPS

- [ ] `MAIN_DOMAIN` QR Menü domainine, `ADMIN_DOMAIN` Yönetici domainine yönleniyor; DNS kayıtları doğru sunucuyu gösteriyor.
- [ ] `PUBLIC_SITE_URL` gerçek `https://` QR Menü originidir.
- [ ] `ALLOWED_ORIGINS` yalnız gerçek HTTPS originlerini içeriyor; `*`, localhost ve geliştirme originleri yok.
- [ ] Geçerli TLS sertifikası ve otomatik yenileme etkin; HTTP kalıcı olarak HTTPS'e yönleniyor.
- [ ] `/`, `/yonetici/` ve `/personel/` doğru hostta açılıyor; `/panel/` kalıcı olarak `/yonetici/` yoluna yönleniyor ve bilinmeyen host istekleri reddediliyor/yönlendiriliyor.

## 2. Environment ve secret doğrulaması

- [ ] `NODE_ENV=production`; `TAHMISCI_LOCAL_DEV` tanımlı değil ve lokal smoke/dev credential değerleri kullanılmıyor.
- [ ] `JWT_SECRET` ve `PASSWORD_MANAGER_KEY` birbirinden farklı, rastgele ve en az 32 karakter; secret manager/environment üzerinden sağlanıyor.
- [ ] `DEFAULT_PANEL_PASSWORD` / `DEFAULT_RECIPE_PASSWORD` yalnız zorunlu ilk kurulum gerekiyorsa güçlü ve tek kullanımlık; hazır hesaplarda tanımlı değil.
- [ ] `COOKIE_SECURE=true`; `COOKIE_SAME_SITE` deployment topolojisine uygun (`lax`/`strict`, zorunlu çapraz site durumunda yalnız `none` + Secure).
- [ ] `MAIN_DOMAIN`, `ADMIN_DOMAIN`, `PUBLIC_SITE_URL`, `ALLOWED_ORIGINS`, `DATA_FILE`, `MEDIA_DIR` ve `BACKUP_DIR` deployment manifestinde açıkça tanımlı.
- [ ] SMTP/parola sıfırlama kullanılacaksa `PASSWORD_RESET_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` birlikte doğrulandı.
- [ ] Başlangıç logunda ortam doğrulama hatası, geçici geliştirme JWT uyarısı veya varsayılan credential uyarısı yok.

## 3. Reverse proxy ve güvenli cookie

- [ ] Proxy gerçek istemci IP/protokol başlıklarını güvenli biçimde iletiyor; dış istemci bu başlıkları doğrudan enjekte edemiyor.
- [ ] `TRUST_PROXY` `true` değil; gerçek proxy hop sayısı (`1` gibi) veya güvenilen ağ/CIDR ile sınırlandırılmış.
- [ ] Proxy timeout/buffering ayarları SSE bağlantılarını kesmiyor; event-stream yanıtları cache'lenmiyor.
- [ ] HTML, manifest ve service worker revalidate/no-cache; sürümlü statik varlıklar kontrollü uzun cache başlıkları alıyor.
- [ ] API, auth, upload ve Excel cevapları CDN/proxy cache'ine girmiyor; hassas cevaplarda `Cache-Control: no-store` görülüyor.

## 4. Kalıcı depolama ve izinler

- [ ] `DATA_FILE` geçici container katmanında değil, kalıcı diskte; uygulama kullanıcısı parent dizinde oluşturma/yazma/atomik rename yapabiliyor.
- [ ] `MEDIA_DIR` kalıcı diskte; uygulama kullanıcısı okuyup yazabiliyor, yürütme izni yok ve kullanıcı yüklemeleri uygulama kodu gibi çalıştırılamıyor.
- [ ] `BACKUP_DIR` kalıcı ve mümkünse ayrı hata alanında; uygulama/backup hesabı yazabiliyor, web/static route doğrudan servis etmiyor.
- [ ] Excel/upload geçici dosyaları private storage/OS temp alanında; public static dizine yazılmıyor ve artık dosyalar yaşam döngüsüyle temizleniyor.
- [ ] Disk kapasitesi, inode, dosya sahipliği ve izinleri doğrulandı; store/media/backup için izleme ve alarm tanımlı.

## 5. Backup, restore ve rollback

- [ ] İlk yayın öncesi `npm --workspace tahmisci-menu-backend run backup` çalıştırıldı; üretilen snapshot farklı bir kalıcı hedefe kopyalandı.
- [ ] Backup checksum, tarih, uygulama sürümü ve store şema sürümü kayıt altına alındı; backup içinde secret bulunmadığı doğrulandı.
- [ ] Restore provası ayrı dizin/instance üzerinde yapıldı: servis durduruldu, mevcut store ayrıca korundu, snapshot `DATA_FILE` konumuna alındı, migration ve readback doğrulandı.
- [ ] Excel aktarımı öncesi otomatik snapshot ve aktarım history/undo kaydı görüldü; başarısız apply canlı veriyi değiştirmedi.
- [ ] Uygulama rollback prosedürü hazır: önceki kod sürümüne dön, uyumlu store snapshotını geri yükle, migration/health/smoke çalıştır, sonra trafiği aç.
- [ ] PWA rollback'te service worker/cache sürümü yeniden artırılıyor; eski hatalı waiting/active worker'ın istemcilerde kalmadığı doğrulanıyor.

## 6. Health, log ve süreç yönetimi

- [ ] `GET /api/health` 200 ve yalnız hassas olmayan `ok` durumu döndürüyor.
- [ ] Süreç yöneticisi restart/backoff ve SIGTERM için yeterli kapanış süresi sağlıyor; deploy sırasında atomik store yazımı yarıda kesilmiyor.
- [ ] Loglarda parola, Authorization, cookie, session/token, previewToken, Excel satır içeriği veya kişisel veri bulunmuyor.
- [ ] 4xx/5xx oranı, disk hatası, store read/write/rollback hatası ve başarısız login/rate-limit olayları merkezi log/alarma bağlı.
- [ ] Production hata cevaplarında stack trace veya dahili dosya yolu yok.

## 7. Yönetici ve Personel kabulü

- [ ] Yönetici girişi/çıkışı çalışıyor; çıkış cookie'yi temizliyor ve sunucu oturumunu revoke ediyor.
- [ ] Personel girişi/çıkışı çalışıyor; pasif/silinmiş hesap giremiyor ve Yönetici cookie'si personel hesabı sayılmıyor.
- [ ] Yetkisiz Yönetici/Personel API istekleri reddediliyor; Origin/CSRF ve nesne sahipliği kontrolleri çalışıyor.
- [ ] Profil/avatar, sidebar açık-kapalı, responsive görünüm ve klavye odağı masaüstü/mobilde doğrulandı.

## 8. Excel Veri Merkezi ve yayın

- [ ] TAHMISCI-MENU, TAHMISCI-FIYAT, TAHMISCI-RECETE ve TAHMISCI-STOK dosyaları birlikte analiz edildi; dosya hashleri ve analiz özeti doğru.
- [ ] Kritik hata/belirsiz eşleşme varsa `canApply=false`; hiçbir kısmi veri yazılmadı.
- [ ] Uygulanabilir analiz tek atomik apply ile tamamlandı; canonical readback, revision, audit ve snapshot başarılı.
- [ ] Aynı request/operation yeniden gönderildiğinde ikinci apply veya ikinci audit etkisi oluşmadı.
- [ ] QR Menü kategori/ürün/fiyat/reçete içeriğini backend canonical verisinden gösteriyor; boş katalogda örnek ürün görünmüyor.
- [ ] “Kaydet ve Yayınla” sonrası public bootstrap/yayın revisionı değişiyor; kaydedilmemiş taslak public görünmüyor.

## 9. Workforce kabulü

- [ ] Görev bir veya birden fazla personele atandı; yalnız hedef personelde göründü ve kişilerin madde ilerlemesi birbirini etkilemedi.
- [ ] Personel sevkiyat bildirdiğinde durum `onay_bekliyor`, stok miktarı değişmedi.
- [ ] Yönetici onayı stoğu yalnız bir kez artırdı; tekrar onay/replay ikinci stok hareketi üretmedi. Ret stok miktarını değiştirmedi.
- [ ] Personel vardiya/izin talebi Yönetici panelinde göründü; karar/not personele yansıdı.
- [ ] Shift taslağı personele görünmedi; yayınlanan plan doğru hafta ve revision ile göründü.

## 10. Üç PWA ve çevrimdışı davranış

- [ ] QR Menü “Tahmisçi Dijital Menü” adı/ikonu ile kuruldu; manifest `/qr-menu/manifest.webmanifest`, scope/start `/`.
- [ ] Personel “Tahmisçi Personel” adı/ikonu ile kuruldu; manifest/scope/start `/personel/`.
- [ ] Yönetici “Tahmisçi Yönetici” adı/ikonu ile kuruldu; manifest/scope/start `/yonetici/`.
- [ ] Üç service worker ayrı cache adı/scope kullanıyor; biri diğer uygulamanın cache veya sayfasını temizlemiyor/yönetmiyor.
- [ ] Manifest, normal/maskable ikonlar, service worker ve offline kabuklar HTTPS üzerinden 200 ve doğru MIME ile dönüyor.
- [ ] Offline QR Menü son güvenli kabukta veri güncelliği uyarısı gösteriyor; Personel/Yönetici “Bağlantı yok” durumunda sahte veri veya başarı göstermiyor.
- [ ] POST/PUT/PATCH/DELETE, `/api/admin/**`, `/api/workforce/**`, auth, profil/avatar, Excel ve SSE cevapları Cache Storage içinde yok.
- [ ] Yeni service worker geldiğinde “Yeni sürüm hazır” bildirimi açılıyor; “Şimdi Güncelle” tek `controllerchange` sonrası bir kez yeniliyor.
- [ ] Kaydedilmemiş Yönetici/Personel formu varken güncelleme otomatik reload yapmıyor; kullanıcı uyarısı ve form verisi korunuyor.

## 11. Otomatik doğrulama ve yayın kararı

- [ ] `npm test`
- [ ] `npm run check`
- [ ] `npm run check:duplicates`
- [ ] `npm run test:local`
- [ ] Test çıktısındaki toplam/geçen/atlanan sayıları release kaydına eklendi; hata veya bilinçli skip gizlenmedi.
- [ ] Yayın sonrası health, iki login, dört Excel, publish, görev, sevkiyat, shift ve üç PWA için kısa smoke tekrarlandı.
- [ ] Blocker yoksa release “Nihai teslim adayı” olarak etiketlendi; tek sonraki adım kontrollü production deploy ve ilk backup doğrulamasıdır.
