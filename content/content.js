// content/content.js

// IframeHandler'ı hemen başlat - beklemeye gerek yok
// document_start ile çalıştığı için DOM henüz hazır olmayabilir,
// IframeHandler içindeki setInterval DOM hazır olunca çalışacak
if (typeof IframeHandler !== "undefined") {
    IframeHandler.start();
}

(async () => {

    Logger.info("==========================================");
    Logger.info("OSM Reward Handler v2 başlatılıyor...");
    Logger.info("==========================================");

    // i18n'i önceden yükle
    await ContentI18N.init();

    // inject.js'i sayfa context'ine script src ile enjekte et (CSP allowlist'te extension origin var)
    try {
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL("injected/inject.js");
        script.onload = () => {
            script.remove();
            window.__INJECT_READY = true;
            window.dispatchEvent(new CustomEvent("__INJECT_READY"));
            Logger.success("inject.js yüklendi.");
        };
        script.onerror = () => {
            Logger.error("inject.js yüklenemedi.");
        };
        (document.head || document.documentElement).appendChild(script);
    } catch (e) {
        Logger.error("inject.js yüklenemedi: " + e.message);
    }

    // Storage hazırla
    await Storage.init();

    // Body oluşmasını bekle
    if (!document.body) {
        await new Promise(resolve => {
            window.addEventListener("DOMContentLoaded", resolve, { once: true });
        });
    }

    // UI oluştur
    UI.init();

    // Timer devam ediyorsa geri sayımı sürdür
    await Timer.resume();

    // Storage durumuna göre UI'ı ayarla
    const state = await Storage.get(["automationStarted", "botPaused", "isBanned", "targetTime"]);

    if (state.isBanned) {

        if (state.targetTime && state.targetTime <= Date.now()) {
            await Storage.set({ isBanned: false, targetTime: null });
            state.isBanned = false;
        } else {
            UI.setStopped();
            UI.setStatus("statusWaiting");
            UI.setCooldown();
            if (UI.retryButton) {
                UI.retryButton.style.display = "block";
            }
            Logger.success("Bootstrap tamamlandı.");
            return;
        }
    }

    if (state.botPaused) {
        UI.setPaused(true);
    } else if (state.automationStarted) {
        // Otomasyon açık: buton her durumda "durdur" göstersin (yönlendirme
        // sırasında da kullanıcı durdurabilsin). Eskiden setStarted yalnızca
        // BusinessClub'dayken çağrılıyordu, o yüzden yönlendirme/başka sayfada
        // durdur butonu kayboluyordu.
        UI.setStarted();

        const isBusinessClub = window.location.href.toLowerCase().includes("businessclub");
        if (!isBusinessClub) {
            Logger.info("BusinessClub sayfasında değil, yönlendiriliyor...");
            UI.setStatus("statusRedirecting");
            setTimeout(() => {
                window.location.href = "https://tr.onlinesoccermanager.com/BusinessClub";
            }, 2000);
            return;
        }

        UI.setStatus("statusRunning");
        await Automation.start();
    } else {
        UI.setStopped();
        UI.setStatus("statusIdle");
        UI.setAdCounter(null);
        UI.setCountdown("--:--:--");
    }

    Logger.success("Bootstrap tamamlandı.");

})();
