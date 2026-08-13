// content/updater.js
//
// Sürüm kontrolü. GitHub Releases API'sinden son yayınlanan sürümü okur,
// manifest'teki sürümle karşılaştırır ve yenisi varsa panelde bildirir.
//
// NEDEN OTOMATİK KURULUM YOK:
// Unpacked (geliştirici modu) bir uzantı KENDİ dosyalarını değiştiremez.
// chrome-extension:// altındaki kaynaklar salt okunurdur ve MV3'te bunu
// aşmanın bir API'si yoktur. chrome.runtime.requestUpdateCheck() yalnızca
// Web Store'dan yüklenmiş uzantılarda çalışır, burada hiçbir şey yapmaz.
//
// Bu yüzden akış: TESPİT ET → BİLDİR → indirmeyi tek tıkla başlat →
// kurulumu kullanıcı (veya update.ps1 scripti) tamamlar.

const Updater = {

    OWNER: "unseensenpai",
    REPO: "osm-reward-handler",

    // Kontrol sıklığı. GitHub anonim API limiti saatte 60 istek (IP başına);
    // 6 saat fazlasıyla güvenli ve kullanıcıyı yormaz.
    CHECK_INTERVAL_MS: 6 * 60 * 60 * 1000,

    latest: null,        // { version, tag, url, zipUrl, notes, publishedAt }
    dismissedTag: null,  // kullanıcının "şimdi değil" dediği sürüm

    async init() {
        const s = await Storage.get([
            "updateLastCheck", "updateLatest", "updateDismissedTag"
        ]);

        this.dismissedTag = s.updateDismissedTag || null;

        // Önceki kontrolün sonucunu hemen göster: her sayfa yüklemesinde
        // ağa çıkmaya gerek yok, bildirim anında görünsün.
        if (s.updateLatest) {
            this.latest = s.updateLatest;
            this.renderIfNewer();
        }

        const last = s.updateLastCheck || 0;
        const due = Date.now() - last > this.CHECK_INTERVAL_MS;

        // İlk kurulumda veya süre dolduysa kontrol et. Sayfa açılışını
        // yavaşlatmamak için biraz geciktir.
        if (due) setTimeout(() => this.check(), 5000);
    },

    currentVersion() {
        try {
            return chrome.runtime.getManifest().version;
        } catch (e) {
            return null;
        }
    },

    // "3.4.10" > "3.4.9" doğru sonuçlansın diye sayısal karşılaştırma.
    // Metin karşılaştırması ("3.4.10" < "3.4.9") yanlış olurdu.
    // Dönüş: a > b ise 1, a < b ise -1, eşitse 0.
    compareVersions(a, b) {
        const parse = (v) => String(v || "")
            .replace(/^v/i, "")
            .split(/[.\-+]/)
            .map(p => parseInt(p, 10))
            .map(n => Number.isFinite(n) ? n : 0);

        const pa = parse(a);
        const pb = parse(b);
        const len = Math.max(pa.length, pb.length);

        for (let i = 0; i < len; i++) {
            const x = pa[i] || 0;
            const y = pb[i] || 0;
            if (x > y) return 1;
            if (x < y) return -1;
        }
        return 0;
    },

    async check(manual = false) {
        const url = `https://api.github.com/repos/${this.OWNER}/${this.REPO}/releases/latest`;

        try {
            const resp = await fetch(url, {
                headers: { "Accept": "application/vnd.github+json" }
            });

            if (!resp.ok) {
                // 403 = API limiti (anonim, saatte 60). Sessiz geç: bir
                // sonraki turda tekrar denenir.
                Logger.info(`Sürüm kontrolü yapılamadı (HTTP ${resp.status}).`);
                if (manual) Logger.warning("Sürüm kontrolü şu an yapılamıyor, sonra tekrar deneyin.");
                return null;
            }

            const data = await resp.json();

            // ZIP asset'ini bul. Yoksa release sayfasına yönlendiririz.
            const asset = (data.assets || [])
                .find(a => /\.zip$/i.test(a.name || ""));

            this.latest = {
                version: String(data.tag_name || "").replace(/^v/i, ""),
                tag: data.tag_name,
                url: data.html_url,
                zipUrl: asset ? asset.browser_download_url : null,
                zipName: asset ? asset.name : null,
                notes: data.body || "",
                publishedAt: data.published_at
            };

            await Storage.set({
                updateLatest: this.latest,
                updateLastCheck: Date.now()
            });

            this.renderIfNewer(manual);
            return this.latest;

        } catch (e) {
            Logger.info(`Sürüm kontrolü başarısız: ${e.message}`);
            if (manual) Logger.warning("Sürüm kontrolü başarısız oldu.");
            return null;
        }
    },

    // Yeni sürüm var mı? Varsa paneli güncelle.
    renderIfNewer(manual = false) {
        const cur = this.currentVersion();
        if (!cur || !this.latest || !this.latest.version) return;

        const newer = this.compareVersions(this.latest.version, cur) > 0;

        if (!newer) {
            if (manual) Logger.success(`En güncel sürümdesiniz (v${cur}).`);
            this.hide();
            return;
        }

        // Kullanıcı bu sürüm için "şimdi değil" demişse elle kontrolde yine
        // göster, otomatik kontrolde rahatsız etme.
        if (!manual && this.dismissedTag === this.latest.tag) return;

        Logger.success(`Yeni sürüm mevcut: v${this.latest.version} (sizde v${cur}).`);
        UI.showUpdateBanner(this.latest, cur);
    },

    hide() {
        if (typeof UI !== "undefined" && UI.hideUpdateBanner) UI.hideUpdateBanner();
    },

    async dismiss() {
        if (!this.latest) return;
        this.dismissedTag = this.latest.tag;
        await Storage.set({ updateDismissedTag: this.latest.tag });
        this.hide();
    },

    // İndirmeyi başlat. Tarayıcının kendi indirme akışı kullanılır; uzantı
    // dosyayı kendi başına kuramaz (bkz. dosya başındaki not).
    download() {
        if (!this.latest) return;
        const target = this.latest.zipUrl || this.latest.url;
        window.open(target, "_blank", "noopener");
    },

    openReleasePage() {
        if (!this.latest) return;
        window.open(this.latest.url, "_blank", "noopener");
    }

    // NOT — "Otomatik kur" v3.4.7'de KALDIRILDI, geri eklemeyin.
    // Uzantı kendi disk yolunu göremez (yalnızca chrome-extension:// URL'i
    // görünür), sayfadan klasör açmak veya shell çalıştırmak da engellidir.
    // Buton bu yüzden yalnızca ".\update.ps1" metnini panoya kopyalayabiliyor,
    // klasörü bulmayı kullanıcıya bırakıyordu — pratikte hiçbir işe yaramadı.
    // update.ps1 hâlâ depoda ve çalışıyor: klasörüne gidip elle çalıştıran
    // için indirme + yedek + kurulumu tek adımda yapar.

};
