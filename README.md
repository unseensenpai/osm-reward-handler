# ⚽ OSM Reward Handler
![Popup Screenshot](assets/OSM_Reward_Handler_v2.4.2_Tool.png)
![Panel Screenshot](assets/OSM_Reward_Handler_v2.4.2_UI.png)

**English:** Online Soccer Manager Business Club ad reward automation.

**Türkçe:** Online Soccer Manager Business Club sayfasındaki reklam ödülü otomasyonu.

---

## Features / Özellikler

**English:**
- Automatic ad watching button click
- Video watching and reward claiming
- 10 ad cycle without page refresh
- Cooldown management with countdown timer
- In-game control panel
- Chrome popup interface
- Iframe ad closing support
- Turkish / English language support

**Türkçe:**
- Reklam izle butonuna otomatik tıklama
- Video izleme ve ödül claim etme
- Sayfa yenilemeden 10 reklam döngüsü
- Cooldown yönetimi ve geri sayım
- Oyun içi kontrol paneli
- Chrome popup arayüzü
- Iframe reklam kapatma desteği
- Türkçe / İngilizce dil desteği

---

## Screenshots / Ekran Görüntüleri

| Popup UI (v2.4.2) | In-Game Panel (v2.4.2) |
|--------------------|------------------------|
| ![Popup](assets/OSM_Reward_Handler_v2.4.2_Tool.png) | ![Panel](assets/OSM_Reward_Handler_v2.4.2_UI.png) |

---

## Installation / Kurulum

**English:**
1. Go to `chrome://extensions` in Chrome
2. Enable Developer mode
3. Click "Load unpacked" and select the project folder
4. Open OSM Business Club page

**Türkçe:**
1. Chrome'da `chrome://extensions` adresine gidin
2. Developer mode açın
3. "Load unpacked" ile proje klasörünü seçin
4. OSM Business Club sayfasını açın

---

## Usage / Kullanım

**English:**
1. Open Business Club page
2. Click "▶ Start" button on the top-left panel
3. Bot starts watching ads automatically
4. Click "⏸ Stop" button to pause

**Türkçe:**
1. Business Club sayfasını açın
2. Sol üstteki "▶ Başlat" butonuna tıklayın
3. Bot reklamları otomatik izlemeye başlar
4. "⏸ Durdur" butonu ile durdurabilirsiniz

---

## Disclaimer / Sorumluluk Reddi

**English:** This software is for **educational and experimental purposes only**. It is not recommended to be used for activities that may violate OSM terms of service. The developer is not responsible for any account restrictions, bans, or other sanctions resulting from its use. The software is provided as-is, without any warranty.

**Türkçe:** Bu yazılım **eğitim ve deney amaçlıdır**. OSM hizmet şartlarını ihlal edebilecek faaliyetler için kullanılması tavsiye edilmez. Kullanımından doğabilecek hesap kısıtlamaları, yasaklamalar veya diğer yaptırımlardan yazılım geliştiricisi sorumlu değildir. Yazılım olduğu gibi sunulmaktadır, herhangi bir garanti verilmez.

---

## Project Structure / Proje Yapısı

```
├── manifest.json
├── background.js
├── _locales/
│   ├── en/messages.json
│   └── tr/messages.json
├── icons/
│   ├── icon.svg
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── popup/
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   ├── i18n.js
│   └── flags/
│       ├── gb.svg
│       └── tr.svg
├── content/
│   ├── content.js
│   ├── i18n.js
│   ├── logger.js
│   ├── storage.js
│   ├── timer.js
│   ├── ui.js
│   └── automation.js
├── injected/
│   └── inject.js
├── iframe/
│   └── iframe-handler.js
├── styles/
│   └── panel.css
└── assets/
    ├── OSM_Reward_Handler_v2.4.2_Tool.png
    └── OSM_Reward_Handler_v2.4.2_UI.png
```

---

## License / Lisans

MIT
