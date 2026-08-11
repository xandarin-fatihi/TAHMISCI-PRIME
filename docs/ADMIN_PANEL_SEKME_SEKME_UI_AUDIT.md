# Tahmisçi Admin Paneli — Sekme Sekme UI Audit

## Kapsam ve yöntem

- Denetim, lokal çalışan gerçek panel üzerinde güncel `/yonetici/` yolu kullanılarak Chrome ile yapıldı.
- Ana referans görünüm 1440 × 900 px ve %100 tarayıcı ölçeğidir. Her sekmede içerik hiyerarşisi, görev akışı, sayfa yüksekliği, yatay taşma, işlem riski ve bilgi yoğunluğu incelendi.
- Bu çalışma üretim HTML/CSS/JS dosyalarını değiştirmez. Görsel taslaklar bağımsız bir tasarım artefaktı olarak `mockups/` altında tutulur.
- Tarama sırasında kritik uygulama konsol hatası görülmedi. Google Maps embed betiğine ait iki debug kaydı uygulama hatası değildir.

## Genel bulgular

| Ekran | Gözlenen durum | Öncelik | Risk |
|---|---|---:|---:|
| Genel Bakış | Temel özet güçlü, ikincil bloklar tek ekrana zor sığıyor | Orta | Düşük |
| Menü Düzenleme | Çok sayıda tema ve tipografi alanı uzun formda | Yüksek | Orta |
| Banner Düzenleme | Ürün seçimiyle birlikte yaklaşık 3305 px sayfa yüksekliği | Yüksek | Orta |
| Kategori Düzenleme | Temel akış anlaşılır, toplu işlemlerle tekil ayarlar karışıyor | Orta | Düşük |
| Ürün Düzenleme | En yoğun günlük işlem; içerik, fiyat, stil ve reçete aynı akışta | Yüksek | Orta |
| Toplu Fiyat Güncelleme | İşlem güçlü ancak etki/geri alma güveni yeterince görünür değil | Orta | Orta |
| Menü Çıktısı | Yetenekli fakat tasarım aracı mantığı eğitim gerektiriyor | Orta | Yüksek |
| Reçete Düzenleme | Menü bağlantısı ve public/gizli içerik sınırı kritik | Yüksek | Yüksek |
| Site Düzenleme | Yaklaşık 2662 px; çok sayıda iki dilli CMS alanı | Yüksek | Yüksek |
| Müdavimler | Üyeler, duyurular, kampanyalar ve ayarlar tek sayfada | Yüksek | Orta |
| Raporlar | Mevcut navigasyonda yok | Orta | Yüksek |
| Ayarlar | Çok sade; sistem durumu ve güvenli varsayılan akışı eksik | Düşük | Düşük |

## 1. Genel Bakış

### Mevcut Durum

Toplam kategori, ürün, aktif ürün, reçete ürünü ve canlı menü durumu üstte özetleniyor. Kategori dağılımı, son güncellemeler, kısa yollar, ziyaretçi trendi ve Müdavim özeti aynı ekranda bulunuyor. 1440 × 900 görünümünde yatay taşma yok; sayfa yüksekliği yaklaşık 959 px.

### Bulunan Sorunlar

- Kartlar eşit ağırlıkta olduğu için en kritik durumlar ile salt adetler aynı vurguya sahip.
- Son güncellemeler işlem türü, kullanıcı ve hedef kaynağı bakımından sınırlı.
- Ziyaretçi trendi ve Müdavim özeti ekranın altına yaklaşarak ilk bakışta kısmen kaybolabiliyor.
- Hızlı yollar günlük kullanım sıklığına göre kişiselleştirilemiyor.

### Kullanıcı Etkisi

Yönetici sistemin sağlıklı olup olmadığını görebiliyor ancak “şimdi ne yapmalıyım?” sorusunun cevabı yeterince öne çıkmıyor.

### Yeni Tasarım Önerisi

Beş ana KPI korunmalı; canlı durum ayrı renk/durum göstergesiyle vurgulanmalı. Alt alan üç dengeli kolon ve tek satırlık ikinci özet bandı olarak kurgulanmalı. Son güncellemelerde zaman, kaynak ve işlem tipi; kısa yollarda ise birincil görevler görünmeli.

### Taslak Görsel

[admin-genel-bakis.png](../mockups/admin-genel-bakis.png)

### Uygulama Önceliği

**Orta.** Panelin ortak kabuk, kart ve tablo standardını belirlemek için önce ele alınmalıdır.

### Uygulama Riski

**Düşük.** Mevcut API verileriyle uygulanabilir; veri modeli değişikliği gerektirmez.

## 2. Menü Düzenleme

### Mevcut Durum

Genel menü görünümü, toplu punto ayarları, popüler ürünler ve “Bana Öner” ayarları aynı sayfada bulunuyor. Tema, gradient, tipografi, kutu, overlay ve görünürlük alanları uzun bir form oluşturuyor. Sayfa yüksekliği yaklaşık 1368 px.

### Bulunan Sorunlar

- Sık kullanılan ayarlar ile ileri seviye görsel detaylar aynı önem düzeyinde.
- Ayarın hangi bölümü etkilediği form içinde yeterince görünür değil.
- Popüler ürün ve öneri mantığı tema ayarlarının altında kayboluyor.
- Değişikliğin mobil menüye etkisi kaydetmeden önce net izlenmiyor.

### Kullanıcı Etkisi

Kullanıcı doğru alanı bulmak için tarama yapıyor; birbirine benzeyen stil alanlarında hata ve tutarsızlık riski artıyor.

### Yeni Tasarım Önerisi

Tema, Tipografi, Kartlar ve Popüler Alanlar sekmelerine ayrılmış iki kolonlu editör kullanılmalı. Sağ kolonda gerçek mobil menüye yakın canlı önizleme sabit kalmalı. Gelişmiş overlay/kutu ayarları açılır gruba alınmalı.

### Taslak Görsel

[admin-menu-duzenleme.png](../mockups/admin-menu-duzenleme.png)

### Uygulama Önceliği

**Yüksek.** Günlük ve yüksek etkili bir düzenleme alanıdır.

### Uygulama Riski

**Orta.** Alan adları ve mevcut kayıt formatı korunarak yalnızca sunum katmanı bölünmelidir.

## 3. Banner Düzenleme

### Mevcut Durum

Kategori üstü sunu alanı ve seçili ürün sunusu yönetiliyor. Medya, metin ve geniş ürün seçimi aynı uzun akışta. 1440 × 900 testinde yatay taşma yok; sayfa yüksekliği yaklaşık 3305 px.

### Bulunan Sorunlar

- Ürün listesi ana düzenleme görevini aşağı itiyor.
- Banner listesi ile aktif banner bağlamı yeterince belirgin değil.
- Görsel/video yükleme, metin ve bağlı ürün seçimi tek hizada okunmuyor.
- Canlı sonuç uzun formun sonunda kaldığı için bağlam kaybı oluşuyor.

### Kullanıcı Etkisi

Banner düzenlemek gereğinden uzun sürüyor; yanlış ürün veya yanlış banner üzerinde işlem yapma olasılığı yükseliyor.

### Yeni Tasarım Önerisi

Sol kolon banner listesi, orta kolon İçerik/Medya/Ürün Seçimi sekmeleri, sağ kolon sabit canlı önizleme olmalı. Ürünler arama ve kategori filtresiyle açılan seçim alanında tutulmalı.

### Taslak Görsel

[admin-banner-duzenleme.png](../mockups/admin-banner-duzenleme.png)

### Uygulama Önceliği

**Yüksek.** En uzun ve en fazla bağlam kaybı üreten ekranlardan biridir.

### Uygulama Riski

**Orta.** Mevcut medya ve banner bağlarını bozmadan form durumunun sekmeler arasında korunması gerekir.

## 4. Kategori Düzenleme

### Mevcut Durum

Kategori seçimi, ad, aktiflik, ikon, kutu/gradient/görsel/overlay ve toplu ürün görünümü ayarları aynı ekranda yer alıyor. “Soğuklar” seçiliyken tekil ve toplu işlemler birlikte sunuluyor.

### Bulunan Sorunlar

- Kategori sırası tablo mantığında görünür değil.
- Tekil kategori ayarı ile kategori altındaki ürünlere uygulanacak toplu değişiklikler yakın duruyor.
- Riskli toplu uygulamalarda etkilenecek ürün sayısı yeterince öne çıkmıyor.

### Kullanıcı Etkisi

Basit ad/sıra değişikliği kolay; toplu görsel ve stil işlemlerinde kapsam hatası yaşanabilir.

### Yeni Tasarım Önerisi

Sol tarafta sıralanabilir kategori tablosu, sağda seçili kategori editörü kullanılmalı. Toplu ürün görünümü ayrı ve ikincil bir “Gelişmiş toplu işlemler” alanına alınmalı.

### Taslak Görsel

[admin-kategori-duzenleme.png](../mockups/admin-kategori-duzenleme.png)

### Uygulama Önceliği

**Orta.**

### Uygulama Riski

**Düşük.** Mevcut alanlar değişmeden gruplandırılabilir.

## 5. Ürün Düzenleme

### Mevcut Durum

Kategori sekmeleri, uzun ürün listesi ve seçili ürün formu bulunuyor. Ürün adı, açıklama, fiyat varyantları, durum, tip, sıcaklık, popülerlik, aktiflik, kart stili, görsel, kalori, alerjen, manuel içerik, reçete bağlantısı ve public ölçü tek sayfada yönetiliyor. Sayfa yüksekliği yaklaşık 1338 px.

### Bulunan Sorunlar

- Günlük temel alanlar ile nadir kullanılan görsel/reçete ayarları aynı yoğunlukta.
- Seçili ürün bağlamı uzun kaydırmada zayıflıyor.
- Fiyat, durum ve reçete bağlantısındaki kritik değişikliklerin özet önizlemesi yok.
- Ürün kartının sitedeki gerçek görünümü anlık görülmüyor.

### Kullanıcı Etkisi

Yanlış ürünü veya yanlış fiyat varyantını düzenleme riski yüksek; yeni kullanıcı için öğrenme yükü fazla.

### Yeni Tasarım Önerisi

Üç kolonlu yapı: filtrelenebilir ürün listesi, sekmeli ürün editörü, sabit kart önizleme. Sekmeler Temel Bilgiler, Fiyat, Görsel ve İçerik & Reçete olmalı. Tehlikeli işlemler en altta ayrı tutulmalı.

### Taslak Görsel

[admin-urun-duzenleme.png](../mockups/admin-urun-duzenleme.png)

### Uygulama Önceliği

**Yüksek.** En sık kullanılan ve veri hatasının doğrudan müşteriye yansıdığı ekrandır.

### Uygulama Riski

**Orta.** Form durumunun, fiyat varyantlarının ve reçete bağlantısının kayıpsız taşınması gerekir.

## 6. Toplu Fiyat Güncelleme

### Mevcut Durum

Kategori, arama, ürün seçimi, sabit/yüzde, artır/azalt ve tutar ayarları bulunuyor. Ürün listesi sayfa içinde kaydırılıyor; yatay taşma görülmedi.

### Bulunan Sorunlar

- Seçilen ürün sayısı ve toplam etki işlem öncesinde yeterince güçlü değil.
- Eski/yeni fiyat karşılaştırması yalnızca işlem zihinsel olarak kurulduktan sonra anlaşılıyor.
- Geri alma veya işlem geçmişi görünür bir güvenlik ağı değil.

### Kullanıcı Etkisi

Tek hata çok sayıda ürüne yayılabileceğinden tereddüt ve geri dönüş maliyeti yükseliyor.

### Yeni Tasarım Önerisi

Sol tarafta seçilebilir ürün tablosu; sağ üstte kural, sağ altta eski/yeni fiyat önizlemesi kullanılmalı. Kaydetmeden önce etkilenen ürün adedi ve değişim özeti zorunlu gösterilmeli.

### Taslak Görsel

[admin-toplu-fiyat-guncelleme.png](../mockups/admin-toplu-fiyat-guncelleme.png)

### Uygulama Önceliği

**Orta.**

### Uygulama Riski

**Orta.** Onay, atomik kayıt ve mümkünse geri alma kaydı gerektirir.

## 7. Menü Çıktısı

### Mevcut Durum

JPG/PDF/PNG işlemleri; Alanlar, Stil, Katmanlar, Şablonlar ve Çıktı sekmeleri; şablon kütüphanesi ve 1080 × 1920 TV önizlemesi bulunuyor. Sayfa yaklaşık 1003 px yüksekliğinde.

### Bulunan Sorunlar

- Basit çıktı alma ile gelişmiş tasarım düzenleme aynı deneyimde.
- Katman, güvenli alan, ölçü ve şablon kavramları ilk kullanımda ağır.
- İndirme formatı ve tasarım kaydetme eylemleri birbirine yakın.

### Kullanıcı Etkisi

Deneyimli kullanıcı güçlü araçlar elde ediyor; sıradan yönetici yalnızca güncel menüyü çıkarmak isterken fazla karar veriyor.

### Yeni Tasarım Önerisi

Sol editör ve sağ gerçek oranlı çıktı önizlemesi kullanılmalı. Üstte “Hızlı Çıktı” ve “Gelişmiş Tasarım” modları ayrılmalı; mevcut sekmeler gelişmiş modda korunmalı.

### Taslak Görsel

[admin-menu-ciktisi.png](../mockups/admin-menu-ciktisi.png)

### Uygulama Önceliği

**Orta.**

### Uygulama Riski

**Yüksek.** Canvas/çıktı koordinatları ve mevcut şablonlarla piksel uyumu korunmalıdır.

## 8. Reçete Düzenleme

### Mevcut Durum

Kategori/ürün seçimi, kategori/ürün/ölçü ekleme ve Excel aktarımı var. İçerik, ölçülü hazırlanış, ürün notu, aktiflik ve sıra düzenleniyor. Sayfa yüksekliği yaklaşık 1065 px.

### Bulunan Sorunlar

- Menü bağlantısı ve public içerik sonucu yeterince görünür değil.
- İçerik ile hazırlama alanlarının gizlilik farkı sadece metinsel bağlamla anlaşılıyor.
- Ölçü ekleme ve reçete çoğaltma işlemleri formun akışını kalabalıklaştırıyor.
- Silme işleminin bağlı menü ürününe etkisi güçlü biçimde gösterilmiyor.

### Kullanıcı Etkisi

Yanlış alanın public siteye çıkacağı endişesi ve bağlı ürünün bozulması riski bulunuyor.

### Yeni Tasarım Önerisi

Sol reçete listesi, orta reçete editörü, sağda Menü Bağlantısı ve Güvenli Yayın özeti kullanılmalı. Public içerik, gizli hazırlanış ve barista notu görsel olarak ayrılmalı.

### Taslak Görsel

[admin-recete-duzenleme.png](../mockups/admin-recete-duzenleme.png)

### Uygulama Önceliği

**Yüksek.**

### Uygulama Riski

**Yüksek.** Stable reçete bağlantıları ve public projection güvenliği etkilenmemelidir.

## 9. Site Düzenleme

### Mevcut Durum

Header, hero ve medya, öne çıkanlar, menü, hakkımızda, QR, iletişim/sosyal, footer, SEO/dil/sıra ve revision alanları bulunuyor. Türkçe/İngilizce ve çok sayıda medya kontrolü nedeniyle sayfa yaklaşık 2662 px yüksekliğinde.

### Bulunan Sorunlar

- Bölümler art arda açıldığı için hangi alanın düzenlendiği kayboluyor.
- Dil, medya ve yayın durumu aynı formda tekrar ediyor.
- Canlı önizleme düzenlenen bölüme sabitlenmiyor.
- Kaydedilmemiş değişiklik ve yayın/revision durumu görünür bağlam oluşturmuyor.

### Kullanıcı Etkisi

Tek bir metin değişikliği için uzun sayfa taranıyor; yanlış bölümü yayınlama ve medya rolünü karıştırma riski yüksek.

### Yeni Tasarım Önerisi

Sol tarafta bölüm navigasyonu ve sırası, ortada seçili bölümün TR/EN/Medya sekmeli editörü, sağda canlı site önizlemesi kullanılmalı. “Kaydet ve Yayınla” tüm sayfada sabit ve kirli durum göstergeli olmalı.

### Taslak Görsel

[admin-site-duzenleme.png](../mockups/admin-site-duzenleme.png)

### Uygulama Önceliği

**Yüksek.**

### Uygulama Riski

**Yüksek.** SiteState şeması, medya rolleri, dil fallback’i ve revision akışı korunmalıdır.

## 10. Müdavimler

### Mevcut Durum

İstatistikler, duyuru yönetimi, üye listesi/detayı, ödüller, kampanyalar ve ayarlar aynı uzun sayfada bulunuyor. Sayfa yüksekliği yaklaşık 2226 px.

### Bulunan Sorunlar

- Üye operasyonu ile içerik/kampanya yönetimi aynı bilgi mimarisinde.
- Seçili üye bağlamı uzun kaydırmada kayboluyor.
- Duyuru blokları ve kullanıcı görünümünün canlı önizlemesi yeterince yakın değil.
- Bir üyenin ziyaret/ödül işlemleri ile global ayarlar yan yana risk oluşturuyor.

### Kullanıcı Etkisi

Günlük ziyaret işleme görevi yavaşlıyor; yanlış üyeye işlem yapma ve duyuru sırasını yanlış yayınlama olasılığı artıyor.

### Yeni Tasarım Önerisi

Üyeler, Duyurular, Ödüller, Kampanyalar ve Ayarlar alt sekmelere ayrılmalı. Üye listesi + sabit detay paneli temel görünüm olmalı. Duyurular ekranında blok sırası ve gerçek kullanıcı paneline yakın canlı önizleme birlikte gösterilmeli.

### Taslak Görsel

[admin-mudavimler.png](../mockups/admin-mudavimler.png)

### Uygulama Önceliği

**Yüksek.**

### Uygulama Riski

**Orta.** Mevcut üye/ziyaret/duyuru işlemleri aynı endpoint ve yetkilerle korunmalıdır.

## 11. Raporlar

### Mevcut Durum

Gerçek panel navigasyonunda ayrı bir **Raporlar** sekmesi bulunmuyor. Bu nedenle taranacak mevcut ekran yoktur.

### Bulunan Sorunlar

- İstenen bilgi mimarisi ile çalışan panel navigasyonu farklı.
- Satış, ciro veya sipariş verisi için doğrulanmış bir kaynak görülmedi.
- Raporların yetki, tarih filtresi ve dışa aktarma kapsamı tanımlı değil.

### Kullanıcı Etkisi

Yönetici menü sağlığı, ziyaret, Müdavim ve geri bildirim özetlerini farklı ekranlardan toplamak zorunda.

### Yeni Tasarım Önerisi

İlk sürüm yalnızca mevcut kaynakları birleştirmeli: ziyaret trendi, Müdavim özeti, aktif/gizli ürün, kategori dağılımı, reçeteye bağlı ürün ve geri bildirim özeti. Satış/ciro verisi ek API kaynağı olmadan gösterilmemeli.

### Taslak Görsel

[admin-raporlar.png](../mockups/admin-raporlar.png)

### Uygulama Önceliği

**Orta.** Önce veri sözleşmesi ve yetki kapsamı netleşmelidir.

### Uygulama Riski

**Yüksek.** Var olmayan veriyi üretme veya farklı kaynakları hatalı yorumlama riski vardır.

## 12. Ayarlar

### Mevcut Durum

Panel teması, mobil panel tercihi, mevcut durumu varsayılan kaydetme, sıfırlama ve hızlı bağlantılar bulunuyor. Sayfa tek ekrana sığıyor.

### Bulunan Sorunlar

- Varsayılan kaydetme/sıfırlama eylemlerinin kapsamı net değil.
- Backend, menü, reçete ve site bağlantı durumu görünür değil.
- Kullanıcı yetkilendirme ayrı sekmede olmasına rağmen bilgi mimarisi bunu açıklamıyor.

### Kullanıcı Etkisi

Yönetici sistem durumunu doğrulamak için başka ekranlara geçiyor; sıfırlama işleminin etkisini kestirmekte zorlanıyor.

### Yeni Tasarım Önerisi

Panel, Varsayılanlar, Bağlantılar ve Güvenlik sekmeleri kullanılmalı. Sistem durumu sağ panelde görünmeli; sıfırlama açık onay ve kapsam özetiyle yapılmalı. Kullanıcı yetkileri mevcut ayrı sekmeye yönlendirilmelidir.

### Taslak Görsel

[admin-ayarlar.png](../mockups/admin-ayarlar.png)

### Uygulama Önceliği

**Düşük.**

### Uygulama Riski

**Düşük.** Öncelikle sunum ve açıklık iyileştirmesidir.

## İstek Listesi Dışında Bulunan Sekmeler

### Kullanıcı Yetkilendirme

Kullanıcı hesabı, barista listesi, eğitim, ödev, sınav, kayıt defteri ve aktivite alanları aynı sayfada bulunuyor. Yaklaşık 1840 px yüksekliğe sahip. Yetki ve eğitim işlerinin ayrı alt sekmelerde ele alınması; kullanıcı durumunun sabit detay panelinde gösterilmesi önerilir. Bu ekran için istenen PNG listesinde dosya olmadığı için bağımsız mockup üretilmedi.

### Dilek & Şikayet

Geri bildirim analizi ile Tümü, Puanlama, İstek, Şikayet, Öneri ve Favoriler filtreleri bulunuyor. Ekran 1440 × 900 görünümüne sığıyor. Filtre sayıları, durum/atanan kişi ve çözüm süresi öne çıkarılmalıdır. Bu ekran için istenen PNG listesinde dosya olmadığı için bağımsız mockup üretilmedi.

## Öncelikli beş problem

1. **Ürün Düzenleme:** En sık kullanılan, en yoğun ve müşteri ekranına doğrudan veri gönderen form.
2. **Menü Düzenleme:** Sık kullanılan görsel ayarlar ile ileri seviye kontrollerin karışması.
3. **Banner Düzenleme:** 3305 px’ye ulaşan ürün seçimi ve önizleme bağlamı kaybı.
4. **Site Düzenleme:** 2662 px’ye ulaşan, çok dilli ve medya yoğun CMS akışı.
5. **Müdavimler:** Üye işlemleri ile duyuru/kampanya yönetiminin aynı uzun sayfada birleşmesi.

## En düşük riskle başlanabilecek ekran

**Kategori Düzenleme.** Mevcut veri alanları ve işlem mantığı korunarak yalnızca sol liste + sağ editör yerleşimine geçilebilir. Bu ekran; ortak tablo, seçim, editör paneli, durum rozeti ve kaydetme desenlerini düşük veri riskiyle doğrulamak için en uygun pilot ekrandır.
