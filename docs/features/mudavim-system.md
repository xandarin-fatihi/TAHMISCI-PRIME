# Tahmisçi Müdavim Sistemi

Müdavim alanı gerçek backend hesabı ve sunucu oturumu kullanır; tarayıcı depolaması kimlik veya oturum kaynağı değildir.

## Hesap ve giriş

- Giriş e-posta ve parola ile yapılır.
- Kayıt sırasında ad soyad, profil adı, e-posta, parola, doğum tarihi ve izin tercihleri alınır.
- E-posta doğrulaması tamamlanana kadar hesap doğrulama bekleyen durumda kalır.
- Doğrulama, parola sıfırlama ve oturum işlemleri ortak hesap güvenliği altyapısı üzerinden yürür.
- Her geçerli e-posta alan adı kullanılabilir; teknik hesap kapsamları arasındaki mevcut benzersizlik kuralı korunur.

## Veri kaynağı

Canonical kayıtlar backend store içindeki `mudavimAccounts` koleksiyonundadır. Yönetici panelindeki Müdavim üyeleri de aynı kaynaktan yalnız güvenli profil alanlarını okur; parola hash'i, doğrulama challenge'ı, session token veya başka güvenlik sırları istemciye gönderilmez.

## Mevcut ürün sınırı

Müdavim profil ve hesap ekranları gerçek hesap verisini gösterir. Ziyaret işlemleri, QR sadakat taraması, seviye, ödül kazanımı ve ödül kullanımı bu aşamada uygulanmış bir loyalty motoru değildir; veri yoksa arayüz “Henüz ziyaret kaydı yok” durumunu gösterir.

Telefonla giriş, SMS OTP ve localStorage tabanlı mock üyelik bu mimarinin parçası değildir.
