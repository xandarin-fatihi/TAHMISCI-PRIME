# API Özeti

Backend `apps/api/` altında Express ile çalışır. Public URL'ler değişmez; fiziksel dosya yapısı `apps/`, `public/assets/`, `data/` ve `storage/` altında ayrılmıştır.

Public uçlar:
- `GET /api/health`
- `GET /api/public/bootstrap`
- `GET /api/public/events`
- `GET /api/menu`
- `GET /api/menu/events`
- `GET /api/site`
- `GET /api/site/events`
- `POST /api/feedback`

Yetkili uçlar:
- Admin oturumu: `/api/admin/login`, `/api/admin/logout`, `/api/admin/me`, `/api/admin/session/refresh`
- Menü yönetimi: `PUT /api/menu`
- Reçete yönetimi: `GET /api/recipes`, `PUT /api/recipes`
- Site yönetimi: `PUT /api/site`, `/api/admin/site/revisions`
- Medya: `/api/media`
- Ödev, sınav, aktivite ve kullanıcı yönetimi: `/api/admin/*`

Public bootstrap hazırlanış adımları, admin notları, şifreler, tokenlar, kullanıcılar, ödev/sınav/aktivite verileri ve gizli reçete alanlarını döndürmez.

Runtime veri hedefleri:
- Default store: `storage/local/store.json`
- Default medya: `storage/media/`
- Production için önerilen dış veri yolu: `/var/lib/tahmisci/`
