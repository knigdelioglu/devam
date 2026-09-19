# Devam

ChatGPT web arayüzünde bir yanıt bittikten sonra isteğe bağlı olarak `devam et` yazıp gönderen, macOS'ta Chrome ile çalışan Manifest V3 eklentisi.

Resmî bir ChatGPT ürünü değildir; API anahtarı, sunucu veya hesap bilgisi istemez.

## Kurulum

1. `git clone https://github.com/knigdelioglu/devam.git`
2. Chrome'da `chrome://extensions` aç ve **Geliştirici modu**nu etkinleştir.
3. **Paketlenmemiş öğe yükle** ile bu klasörü (`manifest.json` dosyasının olduğu kök dizini) seç.
4. `https://chatgpt.com` üzerinde bir sohbet aç, Devam eklenti simgesini aç, tekrar sınırını ayarla ve **Başlat**'a bas.

## Davranış

- Yalnızca başlatıldığı sekmede çalışır. Yenileme ve sekme kapatma otomatik devamı kapatır.
- Başlamış yeni bir yanıtı gözlemlemeden eski cevaba mesaj göndermez.
- Yanıtın tamamlandığını doğrulamak için üretimin bitmesini ve metnin 3,5 saniye sabit kalmasını bekler.
- Mesaj kutusunda sana ait taslak varsa üzerine yazmadan durur.
- Varsayılan 20 devam; açılır pencereden 1–100 arası ayarlanabilir.
- Başka sohbete geçişte durur. Yeni sohbete ilk geçiş (`/` → `/c/...`) normaldir.
- ChatGPT arayüzü değişirse doğru düğmeyi bulamayabilir; API limitlerini ya da erişim engellerini aşmaz.

## Geliştirme

Derleme ve ek paket yoktur. Dosyaları değiştirdikten sonra `chrome://extensions` üzerinden eklentiyi ve ChatGPT sekmesini yenile.
