# Lokal Geliştirme

Lokal çalışma production store, medya ve `.env` dosyasından ayrıdır. Komutlar repo kökünden çalıştırılır.

```bash
npm install
npm run dev:local
```

Adresler:
- Site: `http://localhost:8080/`
- Menü: `http://localhost:8080/#menu`
- Admin giriş: `http://localhost:8080/login.html`
- Yönetici paneli: `http://localhost:8080/yonetici/`
- Personel: `http://localhost:8080/personel/`
- Personel stok: `http://localhost:8080/personel/#stok`
- Reçete: `http://localhost:8080/recete/`
- QR menü: `http://localhost:8080/qr-menu/`
- Health: `http://localhost:8080/api/health`

Lokal veriler:
- Store: `storage/local/local-dev-store.json`
- Medya: `storage/media/local-dev/`

Testler:

```bash
npm run check
npm test
npm run test:local
```

`npm run local:reset` yalnızca lokal store ve lokal medya hedeflerini siler; production verisine dokunmaz.
