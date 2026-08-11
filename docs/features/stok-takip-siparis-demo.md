# Stok Takip / Sipariş Demo

## Modül amacı

Stok Takip / Sipariş demo modülü, Tahmisçi operasyonunda kullanılan ürünlerin stok miktarlarını, eşik durumlarını, sarf hareketlerini ve sipariş önerilerini canlı sistemi bozmadan test etmek için hazırlanmıştır.

Bu fazda gerçek backend, database, mail, SMS veya WhatsApp entegrasyonu yoktur. Demo `demo/stok-takip/` altında mock state ile çalışır.

Lokal önizleme yolu:

```text
http://localhost:8080/personel/#stok
```

## Neden ayrı demo klasörde?

- Mevcut web sitesi, QR menü, admin panel, reçete ve personel yetkilendirme akışı etkilenmez.
- Gelecekte canlı sisteme taşınacak component ve veri modeli izole şekilde denenir.
- Backend entegrasyonu yapılmadan önce ekran akışı, eşik mantığı ve kullanım senaryoları doğrulanır.

## Demo klasörü

```text
demo/stok-takip/
  index.html
  stok-demo.css
  stok-demo.js
  stok-demo-data.js
  README.md
```

## Admin akışı

Admin demo ekranında:

- Toplam ürün, sipariş eşiğine yaklaşan, kritik stok, bugün yapılan hareket ve bekleyen sipariş önerisi özetleri görünür.
- Arama, ürün adı, kategori ve marka içinde tek harften itibaren filtreleme yapar.
- Kategori filtreleri Excel sheet mantığına göre ürünleri ayırır.
- Ürün kartları görsel/placeholder, ürün adı, kategori, marka, mevcut adet, birim, sipariş eşiği, kritik eşik ve stok durumunu gösterir.
- `+ Arttır` butonu stok girişi modalını açar.
- `− Eksilt` butonu stok çıkışı modalını açar.
- `Sarf` butonu sebep zorunlu sarf modalını açar.
- Kart detayı son hareketleri ve ürün notunu gösterir.
- Sağ panelde sipariş önerileri, bildirim ayarları mock UI ve son hareketler bulunur.

## Personel akışı

Personel görünümü admin ekranından sadeleştirilmiştir:

- Arama ve kategori filtresi korunur.
- Ürün kartları daha hızlı işlem için kullanılır.
- Varsayılan personel işlemleri stoktan düşme ve sarf işlemidir.
- Sarf sebebi zorunludur.
- Yapılan hareketler aynı mock state içinde admin tarafına yansıyacak şekilde kaydedilir.

## Ürün data modeli

```js
{
  id,
  category,
  productName,
  imageUrl,
  stockQuantity,
  unit,
  orderThreshold,
  criticalThreshold,
  brand,
  note,
  lastUpdatedAt,
  status
}
```

Temel zorunlu alanlar:

- ürün adı
- ürün görseli veya kategori placeholder
- ürün adedi
- sipariş eşiği

## Hareket data modeli

```js
{
  id,
  productId,
  productName,
  type: "stock_in" | "stock_out" | "waste" | "order_suggestion",
  quantity,
  unit,
  reason,
  note,
  actor: "admin" | "personel" | "system",
  createdAt
}
```

Örnek hareketler:

- Tam Yağlı Süt `-2 paket` sarf edildi.
- Vanilya Şurubu `+6 şişe` stok girişi yapıldı.
- Badem Sütü kritik stok seviyesine düştü.
- Bardak 12 oz `-1 koli` kullanıldı.

## Excel push mantığına hazırlık

Demo data, menü/reçete Excel push yaklaşımına benzer şekilde kurgulanmıştır:

- Her Excel sheet adı stok kategorisidir.
- Her satır o kategorideki bir stok ürünüdür.
- Demo import yapmaz; fakat model doğrudan import edilebilir kolonlara göre hazırlanmıştır.

### Excel kolon taslağı

Her sheet = kategori.

```text
Ürün Adı | Görsel URL | Marka | Ürün Adedi | Birim | Sipariş Eşiği | Kritik Eşik | Not | Aktif
```

Örnek:

```text
Sheet: Sütler
Tam Yağlı Süt |  | Tahmisçi Tedarik | 22 | paket | 15 | 8 | 1 paket = 1 L | Evet
```

## Kategori ve birim kuralları

Başlangıç kategori yapısı:

- Sütler
- Şuruplar
- Soslar
- Kahve
- Temizlik
- Sarf Malzeme
- Diğer

Önemli süt kuralı:

- Süt ana stok ekranında litre olarak değil paket/adet mantığıyla takip edilir.
- Örnek: `Tam Yağlı Süt: 22 paket`
- İçerik bilgisi gerekiyorsa not alanında `1 paket = 1 L` yazılır.

Diğer birimler:

- Şurup: şişe
- Sos: şişe
- Kahve: paket veya kg
- Temizlik: adet / kutu
- Bardak: adet / koli

## Eşik mantığı

Durum hesabı:

- `stockQuantity > orderThreshold` → Yeterli
- `stockQuantity <= orderThreshold && stockQuantity > criticalThreshold` → Siparişe yaklaşıyor
- `stockQuantity <= criticalThreshold` → Kritik

Sipariş önerisi:

- Sipariş eşiğine yaklaşan ve kritik ürünler sağ panelde listelenir.
- Önerilen miktar demo içinde hedef stok seviyesine göre hesaplanır.
- Seçilen ürünlerle demo sipariş özeti modalı açılır.
- Gerçek sipariş gönderimi bu fazda yoktur.

## Arttırma / eksiltme modal mantığı

Stok girişinde:

- Miktar zorunludur.
- Sıfır veya negatif değer kabul edilmez.
- Girilen miktar mevcut stoğa eklenir.
- Hareket geçmişine `stock_in` kaydı düşer.

Stok çıkışında:

- Miktar zorunludur.
- Sıfır veya negatif değer kabul edilmez.
- Mevcut stoktan fazla eksiltme kabul edilmez.
- Girilen miktar stoktan düşülür.
- Hareket geçmişine `stock_out` kaydı düşer.

## Sarf sebebi mantığı

Sarf işleminde:

- Miktar zorunludur.
- Sarf sebebi zorunludur.
- Mevcut stoktan fazla sarf yapılamaz.
- Stoktan düşülür.
- Hareket geçmişine `waste` tipiyle kayıt düşer.

Örnek sebepler:

- raftan kullanıldı
- ürün bitti
- döküldü / zayi oldu
- temizlikte kullanıldı
- hazırlıkta kullanıldı
- diğer

## Bildirim fikri

Demo içinde gerçek mail, SMS veya WhatsApp gönderimi yoktur.

Mock UI şunları gösterir:

- Panel içi bildirim
- E-posta
- SMS / WhatsApp, yakında etiketi
- E-posta alıcısı
- Telefon alıcısı

Gelecekte:

- Ürün sipariş eşiğine yaklaşınca panel içi bildirim üretilebilir.
- Ürün kritik seviyeye düşünce admin bildirimi ve opsiyonel e-posta tetiklenebilir.

## Reçete ile ilişki

Bu fazda reçeteden otomatik stok düşme yazılmamıştır.

Gelecek fikir:

- Reçete ekranında `hazırlandı` butonu eklenirse, seçili reçetedeki malzemeler stoktan otomatik düşülebilir.
- Önce reçete malzeme modeli ile stok ürünü arasında kalıcı bağlantı gerekir.
- Ölçü bazlı tüketim katsayıları backend tarafında hesaplanmalıdır.

## Gelecek backend endpoint taslağı

Kodlanmadı; canlı entegrasyon için önerilen API uçları:

- `GET /api/stock/products`
- `POST /api/stock/products`
- `PATCH /api/stock/products/:id`
- `POST /api/stock/products/import-excel`
- `POST /api/stock/movements`
- `GET /api/stock/movements`
- `GET /api/stock/order-suggestions`
- `POST /api/stock/notifications/test`

## Database taslağı

Önerilen tablolar:

- `stock_categories`
- `stock_products`
- `stock_movements`
- `stock_order_suggestions`
- `stock_notification_settings`

## Canlı sisteme entegrasyon için gerekli adımlar

1. `demo/stok-takip/` içindeki UI parçaları admin panel component yapısına taşınır.
2. Admin panele `Stok Takip / Sipariş` sekmesi eklenir.
3. Personel/reçete arayüzüne sade `Stok` ekranı eklenir.
4. Excel import/push sistemine stok kolonları eklenir:
   - Ürün Adı
   - Görsel URL
   - Marka
   - Ürün Adedi
   - Birim
   - Sipariş Eşiği
   - Kritik Eşik
   - Not
   - Aktif
5. Backend’de stok ürünleri, hareketleri, sipariş önerileri ve bildirim ayarları için endpointler açılır.
6. Store/database migration idempotent yazılır.
7. Sarf ve stok hareketleri için admin/personel yetki kontrolü eklenir.
8. Bildirim sistemi için mail/SMS/WhatsApp sağlayıcısı seçilir.
9. Reçete otomatik tüketim fazı için reçete malzemesi ↔ stok ürünü bağlantısı tasarlanır.

## Kabul durumu

Demo şu özellikleri kapsar:

- İzole klasörde çalışır.
- Canlı sayfalara dokunmaz.
- Admin stok ekranı vardır.
- Personel stok ekranı vardır.
- Arama tek harfle filtreler.
- Kategori filtreleri çalışır.
- Ürün kartları görsel/adet/eşik gösterir.
- Artı/eksi işlemleri modal ile çalışır.
- Kart detayı açılır.
- Sarf sebebi zorunludur.
- Sarf işlemi hareket geçmişine yazılır.
- Sipariş önerileri eşik ve kritik durumdan hesaplanır.
- Bildirim ayarı mock UI görünür.
- Sütler paket/adet mantığıyla takip edilir.
