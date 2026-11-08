# Tahmisçi Stok Takip / Sipariş Demo

Bu klasör canlı Tahmisçi sistemine bağlı olmayan izole stok takip / sipariş demo modülüdür.

## Dosyalar

- `index.html`: Admin ve personel demo arayüzü
- `stok-demo.css`: Bej/kahverengi Tahmisçi demo stilleri
- `stok-demo.js`: Mock state, filtreleme, stok hareketleri ve modal davranışları
- `stok-demo-data.js`: Excel sheet mantığına uygun demo ürün ve hareket verisi

## Çalıştırma

Mevcut lokal backend ile:

```powershell
npm run dev:local
```

Adres:

```text
http://localhost:8080/stok/
```

Backend açmadan doğrudan dosya olarak önizlemek için:

```powershell
Start-Process .\demo\stok-takip\index.html
```

## Akış

- Admin görünümü: stok kartları, stok giriş/çıkış, sarf, sipariş önerileri, bildirim mock UI ve son hareketler.
- Personel görünümü: hızlı arama, kategori filtresi, stoktan düşme, sarf sebebi ve kendi hareketlerini mock state içinde işleme.
- Tüm değişiklikler tarayıcı oturumunda demo state üstünde çalışır; canlı store/backend değiştirilmez.

## Not

Bu demo gelecekte admin panel ve personel/reçete arayüzüne taşınmak üzere modüler tutulmuştur. Canlı entegrasyon planı için:

```text
docs/features/stok-takip-siparis-demo.md
```
