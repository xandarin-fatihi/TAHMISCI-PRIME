# Lokal Geliştirme

Lokal çalışma production store, medya ve `.env` dosyasından ayrıdır. Komutlar repo kökünden çalıştırılır.

```bash
npm install
npm run dev:local
```

## Yerel adresler

- QR Menü: `http://localhost:6060/`
- Site: `http://localhost:6060/site/`
- Müdavim: `http://localhost:6060/mudavim/`
- Yönetici: `http://localhost:6060/yonetici/`
- Personel: `http://localhost:6060/personel/`
- Fatura: `http://localhost:6060/fatura/`
- Health: `http://localhost:6060/api/health`

## Yerel veri

- Store: `storage/local/local-dev-store.json`
- Medya: `storage/media/local-dev/`

Lokal başlatma sırasında bir saatten eski ve aktif bir sürece ait olmayan `local-dev-store.json.*.tmp` dosyaları güvenli biçimde temizlenir; ana store dosyasına dokunulmaz.

`npm run local:reset` yalnızca lokal store ve lokal medya hedeflerini siler; production verisine dokunmaz.
