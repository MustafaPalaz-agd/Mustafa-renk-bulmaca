# Renk Çarkı — Online

Tarayıcıda çalışan, gerçek zamanlı çok oyunculu bir renk yakalama oyunu.
Sunucu her tur **16.7 milyon renkten** rastgele bir hedef seçer ve aynı hedefi bütün oyunculara gönderir.
Oyuncular çark + parlaklık ile tahmin yapar; hedefe en yakın renk kazanır.

## Çalıştırma

```bash
cd online-agd
npm install
npm start
```

Tarayıcıda aç: **http://localhost:3000**

### Telefonla / arkadaşlarla oynamak

1. Bilgisayarla telefonlar aynı Wi-Fi ağında olsun.
2. Bilgisayarın yerel IP adresini bul (örn. `192.168.1.130`).
3. Telefonda `http://192.168.1.130:3000` adresini aç.
4. Windows güvenlik duvarı sorarsa Node.js için **özel ağ** erişimine izin ver.

## Nasıl oynanır?

- Ana menüde adını yaz, **Oda Oluştur** veya 4 haneli **oda kodu** ile katıl.
- En az 2 oyuncu olunca oda sahibi **Oyunu Başlat** butonuna basar.
- Lobide oda sahibi **tur sayısını** seçer: 3, 5, 10, 20 veya **sınırsız (∞)**.
- Her tur başında rastgele bir hedef renk gösterilir.
- Çarktan rengi seç, alttaki **Parlaklık** çubuğuyla koyuluğunu ayarla.
- Hazır olduğunda **Tahmini Kilitle**. Herkes kilitlerse tur erken biter.
- Tur sonunda hedef, bütün tahminler ve **en yakın 4 renk** çark üzerinde gösterilir.
- En yakın oyuncu 3, ikinci 2, üçüncü 1 puan alır.
- Seçilen tur sayısı dolunca en yüksek toplam puana sahip oyuncu şampiyon olur.
- Sınırsız modda oyun devam eder; oda sahibi **Oyunu Bitir** ile final skorlarını açabilir.

## Teknik yapı

```
online-agd/
├─ server.js          # Express + Socket.IO, oda yönetimi ve sunucu otoriteli turlar
├─ package.json
└─ public/
   ├─ index.html      # Ana menü, lobi ve oyun ekranları
   ├─ style.css       # Modern, duyarlı arayüz
   └─ app.js          # Socket istemcisi, renk çarkı ve Canvas çizimi
```

- **Sunucu otoriteli:** Hedef renk, tahminlerin alınması, süreler ve puanlar sunucuda yönetilir.
- **Senkron hedef:** Hedef renk sunucuda seçilir; her state paketinde bütün oyunculara aynı anda gönderilir.
  İstemci hedef rengi kendisi belirlemez.
- **Algısal karşılaştırma:** Tahminler sRGB → CIE Lab dönüşümüyle karşılaştırılır; insan gözüne daha yakın
  bir sıralama için Delta E mesafesi kullanılır.
- **Tam RGB aralığı:** Renk çarkı hue + doygunluğu, parlaklık çubuğu value kanalını kontrol eder.
- **Gizli tahminler:** Tur sırasında diğer oyuncuların renkleri gösterilmez; sadece seçim yapıp yapmadıkları görünür.
- Odalar bellekte tutulur. Sunucu yeniden başlatılırsa odalar kapanır.
- Oyuncu ayrılırsa odadan çıkarılır; 2+ oyuncu kaldıysa oyun devam eder, 1 oyuncu kalırsa lobiye dönülür.
  Oda sahibi ayrılırsa host devredilir.
