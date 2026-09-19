# Devam

ChatGPT'de yanıt tamamlanınca yalnızca seçilen sekmede otomatik devam mesajı gönderen macOS / Chrome Manifest V3 eklentisi. Resmî ChatGPT ürünü değildir. API anahtarı veya sunucu gerekmez.

## Kurulum

1. `git clone https://github.com/knigdelioglu/devam.git` veya mevcut klasörde `git pull` çalıştır.
2. Chrome'da `chrome://extensions` aç, **Geliştirici modu**nu etkinleştir.
3. **Paketlenmemiş öğe yükle** ile bu reponun `manifest.json` dosyasının bulunduğu klasörü seç.
4. Yeni commit'lerden sonra Chrome'da eklentinin **Yeniden yükle** simgesine bas **ve açık ChatGPT sekmelerini yenile**. Aksi halde eski content script çalışmaya devam eder.

## Başlatma seçenekleri

- **Şimdi devam et:** Bir sohbet daha önce tamamlanmışsa önce yanıtın sabit olduğunu doğrular, ardından devam mesajı gönderir. ChatGPT zaten üretiyorsa yeni mesaj göndermeden o yanıtı bekler.
- **Yanıtı bekle:** Daha önce tamamlanmış bir cevaba dokunmaz; başlayan/mevcut yanıtın bitmesini bekler.
- Her sekmenin durumu ve tekrar sayacı ayrıdır. Bir sekmede başlatmak diğer ChatGPT sekmelerini etkilemez.
- Başlangıçta kapalıdır. Sekme yenilenince veya başka sohbete geçince durur.

## Akıllı mod (varsayılan: açık)

Eklentinin gönderdiği mesaj `devam et` talimatıyla birlikte iki makinece okunabilir son satır işaretini ister:

- `[[DEVAM:SUR]]`: Yapılacak iş kalmış; sonraki devama izin ver.
- `[[DEVAM:TAMAM]]`: Model işin bittiğini söylüyor; otomatik devamı durdur.

Akıllı modla ilk defa devralınan, daha önce bu protokolü almamış yanıtta işaret bulunması beklenmez; eklenti ilk devam mesajıyla protokolü başlatır. Bundan sonraki yanıtlarda işaret çıkmazsa tahmin edip devam etmek yerine durur. İşaretler modelin **beyanıdır**, gerçek işin eksiksiz tamamlandığının doğrulaması değildir. Akıllı mod kapatılırsa her seferinde yalnızca `devam et` gönderilir ve tekrar sınırına kadar eski davranışa dönülür.

## Koruma ve sınırlar

- Gönderme öncesinde stop düğmesinin kaybolmasını ve son cevabın yaklaşık 3,5 saniye sabit kalmasını bekler.
- Kullanıcının mesaj kutusundaki taslağına yazmaz; eklenti tarafından hazırlanan mesaj değiştirilirse göndermez.
- Her sekmede ayrı en fazla 1–100 otomatik gönderim (varsayılan 20).
- Mesaj gönderimi / yeni yanıt doğrulanamazsa, sayfa/sohbet değişirse veya ChatGPT arayüzündeki düğmeler tanınmazsa durabilir.
- ChatGPT'nin kullanım sınırlarını aşmaz. İşaretler sohbet metninde görünür.
- Sayfa DOM'u ChatGPT tarafından değiştirilebilir; manuel tarayıcı testi ve seçici uyarlaması gerekebilir.

## Geliştirme

Derleme, bağımlılık veya Node.js gerekmez. `manifest.json`, `content.js`, `popup.html`, `popup.css` ve `popup.js` doğrudan Chrome'a yüklenir.
