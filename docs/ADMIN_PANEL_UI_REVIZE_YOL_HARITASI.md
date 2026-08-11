# Tahmisçi Admin Paneli — UI Revize Yol Haritası

## Uygulama ilkeleri

1. Mevcut API, data/id hook, yetki, store ve yayın akışları korunur.
2. Önce ortak panel kabuğu ve tekrar eden bileşenler standartlaştırılır; ekranlar tek tek bu standarda taşınır.
3. Görsel revize ile veri modeli revizesi aynı teslimata sıkıştırılmaz.
4. Her ekran mevcut işlemler için regresyon testi geçmeden sonraki aşamaya alınmaz.
5. “Raporlar” gibi mevcut olmayan alanlarda önce veri sözleşmesi ve yetki kapsamı tanımlanır; sahte metrik üretilmez.

## Ortak tasarım altyapısı

İlk geliştirme dalgasında aşağıdaki ortak parçalar hazırlanmalıdır:

- Panel sayfa başlığı: kicker, başlık, birincil/ikincil aksiyonlar.
- Sol navigasyon: aktif durum, daraltılmış görünüm, klavye odağı.
- Panel/kart, KPI kartı, tablo, arama, filtre chip’i ve durum rozeti.
- İki/üç kolonlu editör kabukları ve sabit canlı önizleme paneli.
- Kaydedilmemiş değişiklik göstergesi, kaydet/yayınla bildirimleri ve tehlikeli işlem onayı.
- 1440, 1366, 1024 ve mobil kırılımları için ortak grid davranışı.

## Aşama 1 — Temel kabuk ve günlük menü operasyonları

### 1. Genel Bakış

**Neden ilk:** Ortak kart, tipografi, tablo, boşluk ve başlık standardını en düşük işlem riskiyle doğrular.

**Uygulama kapsamı**

- KPI hiyerarşisi ve canlı durum göstergesi.
- Son güncellemeler, kısa yollar, kategori dağılımı ve Müdavim özeti.
- İkinci satırın tek ekrana daha dengeli yerleşmesi.

**Kabul kriterleri**

- Mevcut metrikler aynı kaynaklardan gelir.
- Kritik durum ilk bakışta anlaşılır.
- 1024–1440 px aralığında yatay taşma olmaz.
- Mobilde kartlar okunabilir sırada kırılır.

**Risk:** Düşük.

### 2. Menü Düzenleme

**Neden ikinci:** Tema, tipografi ve kart standardı sonraki ürün/kategori ekranlarının görsel temelini oluşturur.

**Uygulama kapsamı**

- Tema, Tipografi, Kartlar ve Popüler Alanlar sekmeleri.
- Sık kullanılan/gelişmiş alan ayrımı.
- Sabit mobil canlı önizleme.
- Mevcut kayıt formatına adapter katmanı; alan adları değiştirilmez.

**Kabul kriterleri**

- Tüm mevcut ayarlar kaydedilip tekrar okunur.
- TR/EN ve menü render davranışı değişmez.
- Önizleme form değişikliklerini kaydetmeden gösterir.
- Kaydedilmemiş değişiklik uyarısı çalışır.

**Risk:** Orta.

### 3. Ürün Düzenleme

**Neden üçüncü:** En sık kullanılan veri akışıdır; Menü Düzenleme ile belirlenen kart/önizleme standardından faydalanır.

**Uygulama kapsamı**

- Aranabilir ve kategori filtreli ürün listesi.
- Temel Bilgiler, Fiyat, Görsel, İçerik & Reçete sekmeleri.
- Sabit ürün kartı önizlemesi.
- Tehlikeli işlemlerin ayrı alana taşınması.

**Kabul kriterleri**

- Standart ve varyant fiyatları kayıpsız çalışır.
- Aktif/pasif, stok, popülerlik ve sıralama davranışı korunur.
- Reçete bağlantısı ve public ölçü değişmeden kaydedilir.
- Ürün listesinde seçim, arama ve kategori geçişi bozulmaz.

**Risk:** Orta.

### 4. Kategori Düzenleme

**Neden dördüncü:** Ürün listesi ve kart desenleri hazır olduktan sonra kategori–ürün ilişkisi aynı dilde sadeleştirilebilir.

**Uygulama kapsamı**

- Sıralanabilir sol kategori tablosu.
- Sağda seçili kategori editörü.
- Toplu ürün görünüm işlemlerinin gelişmiş alana ayrılması.

**Kabul kriterleri**

- Kategori sırası ve aktiflik kaydedilir.
- Kategori seçimi ürün verisini etkilemez.
- Toplu işlem öncesi etkilenen ürün sayısı gösterilir.

**Risk:** Düşük.

### 5. Banner Düzenleme

**Neden beşinci:** Ürün/kategori seçicileri hazır olduktan sonra dev ürün listesini yeniden kullanmak mümkün olur.

**Uygulama kapsamı**

- Banner listesi, sekmeli editör ve canlı önizleme.
- Filtreli ürün seçici.
- Görsel/video yükleme ve medya rolü özeti.

**Kabul kriterleri**

- Mevcut banner sırası, görünürlük ve medya yolları korunur.
- Ürün seçimi arama/kategori filtresiyle çalışır.
- Önizleme gerçek banner oranına yakın davranır.
- Tek ekran akışında yatay taşma oluşmaz.

**Risk:** Orta.

## Aşama 2 — Sadakat, reçete ve site yayın akışları

### 6. Müdavimler

**Neden altıncı:** Ortak liste + detay + canlı önizleme desenleri tamamlandıktan sonra yüksek etkileşimli sadakat modülü güvenle ayrıştırılabilir.

**Uygulama kapsamı**

- Üyeler, Duyurular, Ödüller, Kampanyalar ve Ayarlar alt sekmeleri.
- Üye listesi ve sabit detay paneli.
- Duyuru blok sırası ile kullanıcı görünümüne yakın canlı önizleme.

**Kabul kriterleri**

- Ziyaret/ödül işlemleri aynı üyeye ve aynı endpoint’e gider.
- Duyuru ekleme, sıralama, silme ve yayınlama korunur.
- Seçili üye bağlamı işlem boyunca görünür kalır.
- Yetkisiz işlem görünmez veya backend tarafından reddedilir.

**Risk:** Orta.

### 7. Reçete Düzenleme

**Neden yedinci:** Ürün ekranındaki reçete bağlantısı sabitlendikten sonra reçete tarafı aynı bağlantı modeline göre düzenlenebilir.

**Uygulama kapsamı**

- Reçete listesi, editör ve Menü Bağlantısı/Güvenli Yayın paneli.
- Public içerik, hazırlanış ve barista notunun görsel ayrımı.
- Ölçü, çoğaltma ve silme işlemlerinin kontrollü akışı.

**Kabul kriterleri**

- Stable reçete bağlantısı ad değişikliğinde kopmaz.
- Public API yalnızca güvenli içeriği döndürür.
- Hazırlanış ve barista notu public çıktıya sızmaz.
- Silme öncesi bağlı menü ürünleri uyarısı görünür.

**Risk:** Yüksek.

### 8. Site Düzenleme

**Neden sekizinci:** Ortak editör, medya yükleme, dil ve önizleme bileşenleri önceki ekranlarda doğrulanmış olur.

**Uygulama kapsamı**

- Sol bölüm navigasyonu ve bölüm sırası.
- Ortada TR/EN/Medya/Gelişmiş sekmeli bölüm editörü.
- Sağda sabit canlı site önizlemesi.
- Kaydet ve Yayınla, revision ve kirli durum akışı.

**Kabul kriterleri**

- SiteState alanları ve medya URL’leri kayıpsız korunur.
- Türkçe/İngilizce fallback davranışı bozulmaz.
- Hero ve reels yerleşimi değişmez.
- Yayın sonrası SSE açık siteye güncelleme taşır.
- Revision geri alma işlevi doğrulanır.

**Risk:** Yüksek.

## Aşama 3 — Toplu ve özel amaçlı araçlar

### 9. Toplu Fiyat Güncelleme

**Neden dokuzuncu:** Ürün/fiyat editörü stabil olduktan sonra aynı doğrulama ve fiyat formatı toplu işleme uygulanabilir.

**Uygulama kapsamı**

- Ürün seçim tablosu.
- Güncelleme kuralı paneli.
- Eski/yeni fiyat ve değişim önizlemesi.
- İşlem geçmişi/geri alma bağlantısı.

**Kabul kriterleri**

- Seçilmeyen ürün değişmez.
- Yüzde ve tutar hesapları aynı yuvarlama kuralını kullanır.
- İşlem atomik kaydedilir.
- Uygulama öncesi etki özeti zorunludur.

**Risk:** Orta.

### 10. Menü Çıktısı

**Neden onuncu:** Güncel ürün/kategori görünümleri stabil olmadan çıktı tasarımcısını revize etmek tekrar iş doğurur.

**Uygulama kapsamı**

- Hızlı Çıktı ve Gelişmiş Tasarım ayrımı.
- Sol araç paneli, sağ gerçek oranlı çıktı önizlemesi.
- Mevcut şablon ve katmanların korunması.

**Kabul kriterleri**

- JPG/PDF/PNG çıktıları mevcut çözünürlükte alınır.
- Kaydedilmiş şablonlar kaybolmaz.
- Katman konumu ve güvenli alanlar piksel bazında regresyon testinden geçer.

**Risk:** Yüksek.

### 11. Raporlar

**Neden on birinci:** Ekran bugün mevcut değildir; önceki modüller net veri sözleşmeleri sağladıktan sonra doğru rapor kaynağı kurulabilir.

**Uygulama kapsamı**

- İlk sürüm: ziyaret, Müdavim, menü sağlığı, kategori dağılımı, reçete bağlantısı ve geri bildirim özeti.
- Tarih filtresi ve mevcut veriler için dışa aktarma.
- Satış/ciro alanlarının veri kaynağı oluşana kadar gösterilmemesi.

**Kabul kriterleri**

- Gösterilen her metriğin backend kaynağı belgelenir.
- Yetkisiz kullanıcı rapor verisine erişemez.
- Tarih filtresi tüm kartlarda aynı zaman aralığını uygular.
- Eksik veri “0” diye uydurulmaz; açık “veri yok” durumu gösterilir.

**Risk:** Yüksek.

### 12. Ayarlar

**Neden son:** Ortak panel davranışları tamamlandığında gerçek varsayılanlar, sistem durumu ve bağlantı ayarlarının kapsamı netleşir.

**Uygulama kapsamı**

- Panel, Varsayılanlar, Bağlantılar ve Güvenlik sekmeleri.
- Backend, menü, reçete ve site durum özeti.
- Güvenli varsayılana dönme onayı.

**Kabul kriterleri**

- Tema ve panel tercihleri restart sonrası korunur.
- Sıfırlama kapsamı onaydan önce gösterilir.
- Kullanıcı yetkileri mevcut ayrı sekmeye yönlendirilir.
- Ayarlar ekranı hassas anahtar veya şifre göstermez.

**Risk:** Düşük.

## Her aşama için test kapısı

- Fonksiyon: mevcut kaydetme, silme, sıralama, filtre ve önizleme davranışları.
- Yetki: admin yazma işlemleri, public/private veri sınırı.
- Görsel: 1024, 1366 ve 1440 px; mobilde yatay taşma.
- Erişilebilirlik: klavye sırası, `focus-visible`, 44 px dokunma alanı, anlamlı durum metni.
- Veri: yeniden yükleme ve backend restart sonrası kaydın korunması.
- Gözlem: kritik konsol hatası, 404 ve başarısız medya isteği olmaması.

## Önerilen teslim paketleri

1. **Paket A — Ortak kabuk + Genel Bakış + Menü + Ürün + Kategori**
2. **Paket B — Banner + Müdavimler**
3. **Paket C — Reçete + Site Düzenleme**
4. **Paket D — Toplu Fiyat + Menü Çıktısı**
5. **Paket E — Raporlar veri sözleşmesi + Ayarlar**

Her paket ayrı feature flag veya geri alınabilir commit dizisiyle yayınlanmalı; veri modeli gerektiren işler yalnızca geriye uyumlu migration ile yapılmalıdır.
