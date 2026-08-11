# Geçiş Notları

Eski iç içe `TAHMİSÇİ/TAH` yapısı kaldırıldı. Public route'lar Express static alias ve redirect'leriyle korunur: `/`, `/panel/`, `/recete/`, `/qr-menu/`, `/login.html`, `/password-reset/`, `/assets/`, `/media/`.

Eski fiziksel klasörlere symlink bırakılmadı. Production veri migration'ı otomatik çalışmaz; `DATA_FILE` ve `MEDIA_DIR` ortam değişkenleriyle mevcut dış veri yolları kullanılmaya devam edebilir.
