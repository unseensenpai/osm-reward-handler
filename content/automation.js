// content/automation.js

const Automation = {

    started: false,
    currentAdCount: 0,
    injectReady: false,
    banParseFailStreak: 0,
    tooLateStreak: 0,
    bypassMode: false,
    modalCloseMode: false,
    consecutiveApiFails: 0,

    async start() {

        if (this.started) return;
        this.started = true;

        // Sayfa kaynaklı reward API çağrılarını da logla (modal odak kaybı
        // modunda watched/consume'u SAYFA yapıyor, bizim callApi değil).
        this.installRewardResponseLogger();

        // inject.js hazır mı kontrol et (content.js script.onload'dan)
        if (window.__INJECT_READY) {
            this.injectReady = true;
            Logger.success("inject.js zaten hazır.");
        } else {
            window.addEventListener("__INJECT_READY", () => {
                this.injectReady = true;
                Logger.success("inject.js hazır oldu.");
            }, { once: true });
        }

        const state = await Storage.get([
            "botPaused",
            "isBanned",
            "adsWatched",
            "bypassMode",
            "modalCloseMode"
        ]);

        this.bypassMode = state.bypassMode || false;
        this.modalCloseMode = state.modalCloseMode || false;

        if (state.botPaused) {
            Logger.info("Bot durdurulmuş.");
            UI.setStatus("statusPaused");
            return;
        }

        if (state.isBanned) {
            Logger.warning("Bekleme süresi devam ediyor.");
            UI.setStatus("statusWaiting");
            UI.setCooldown();
            return;
        }

        this.currentAdCount = state.adsWatched || 0;

        Logger.success("Otomasyon başlatıldı.");
        UI.setStatus("statusRunning");
        UI.setStarted();
        UI.setAdCounter(this.currentAdCount);

        if (this.bypassMode) {
            Logger.info("⚡ API Bypass modu aktif.");
            this.apiAdLoop();
        } else {
            // Normal ve Modal Odak Kaybı modları aynı buton-bul-tıkla döngüsünü paylaşır;
            // fark handleVideo içinde (modalCloseMode ? erken kapat : tam izle).
            this.modalLoop();
        }
    },

    // ======================
    // MODAL DÖNGÜSÜ (Normal + Modal Odak Kaybı modları)
    // ======================

    // Normal + Modal Odak Kaybı modlarının ortak döngüsü. Butonu bulur, modalı
    // açar; sonuç handleVideo/checkModalState içinde ele alınır. HAPPY PATH'TE
    // location.reload YOK — yeni reklamlar arkada tıklama ile açılır.
    async modalLoop() {
        Logger.success("Modal döngüsü başladı.");
        const prefs = await Storage.get(["modalCloseMode"]);
        this.modalCloseMode = prefs.modalCloseMode || false;
        this.waitForButtonAndOpen();
    },

    // Butonu kısa aralıklarla arar. Bulunca openRewardModal çağırır. Buton uzun
    // süre yoksa (30 deneme ~45sn) SON ÇARE olarak sayfayı yeniler.
    waitForButtonAndOpen() {
        let attempts = 0;
        const maxAttempts = 30;

        const interval = setInterval(async () => {
            attempts++;

            const state = await Storage.get(["botPaused", "isBanned"]);
            if (state.botPaused) {
                clearInterval(interval);
                Logger.info("Bot durduruldu.");
                UI.setStatus("statusPaused");
                return;
            }
            if (state.isBanned) {
                clearInterval(interval);
                Logger.info("Ban süresi işliyor, döngü duruyor.");
                return;
            }

            if (attempts > maxAttempts) {
                clearInterval(interval);
                Logger.warning("Buton bulunamadı (~45sn); SON ÇARE sayfa yenileniyor.");
                setTimeout(() => location.reload(), 3000);
                return;
            }

            const button = this.findButton();
            if (!button) return;

            clearInterval(interval);
            Logger.success("Reklam butonu bulundu.");
            this.openRewardModal(button);
        }, 1500);
    },

    async openRewardModal(button) {
        Logger.info("Reklam modalı açılıyor...");

        // Not: Odak kaybı modu artık videos/start'ı beklemiyor (start ~700ms
        // sürüyor ve o sırada reklam yükleniyordu). handleVideo doğrudan slider
        // süresi kadar bekleyip kapatıyor; bu yüzden latch armlamaya gerek yok.

        await this.clickButtonViaKnockout(button);

        const modal = await this.waitForModalElement(5000);
        if (!modal) {
            this.disarmVideoStartLatch();
            Logger.warning("Modal açılmadı, tekrar denenecek.");
            // Reload YOK: kısa bekle, yeni tur.
            await this.delay(1500);
            this.waitForButtonAndOpen();
            return;
        }

        this.checkModalState();
    },

    checkModalState() {
        if (this.isBanModalVisible()) {
            this.handleCooldown(); // döngüyü durdurur, timer başlar
            return;
        }
        this.handleVideo();
    },

    async handleVideo() {
        UI.setStatus("statusAdWatching");
        UI.setStarted();
        UI.setAdCounter(this.currentAdCount + 1);

        if (this.modalCloseMode) {
            // videos/start'ı BEKLEME: start yanıtı ~700ms sürüyordu ve bu süre
            // içinde video oynatıcı yüklenip reklam başlıyordu. Amaç modalı
            // reklam yerleşmeden kapatmak. Bu yüzden modal açılır açılmaz sadece
            // panelden ayarlanan slider kadar bekle ve kapat (100ms = neredeyse
            // anında). start latch'ini sadece temizle.
            this.disarmVideoStartLatch();

            const prefs = await Storage.get(["modalCloseDelayMs"]);
            const bufferMs = Number.isFinite(prefs.modalCloseDelayMs)
                ? prefs.modalCloseDelayMs
                : 1000;

            Logger.info(`Odak kaybı: modal ${bufferMs}ms sonra kapatılacak.`);
            await this.delay(bufferMs);

            // Tampon sırasında cap dolup ban modalı belirmiş olabilir. Kapatmaya
            // çalışmadan önce kontrol et; ban varsa reklam modalını kapatmaya
            // GİRME, doğrudan cooldown'a geç (aksi halde ban modalı yanlışlıkla
            // kapanıp döngü süreyi okumadan istek atmaya devam eder).
            if (this.isBanModalVisible()) {
                this.handleCooldown();
                return;
            }

            this.closeRewardModal();
            await this.delay(500);
        } else {
            await this.waitForAdToEnd();

            if (this.isBanModalVisible()) {
                this.handleCooldown();
                return;
            }

            this.closeRewardModal();
        }

        // Ban değilsek turu say ve ARKADA yeni modal açmaya devam et (stack).
        if (this.isBanModalVisible()) {
            this.handleCooldown();
            return;
        }

        await this.recordReward();
        Logger.success("Tur tamamlandı, yeni reklam açılıyor.");
        // Kısa gecikme: preroll sürerken yeni tıklama üst üste modal yığar (5-9 puan burst).
        setTimeout(() => this.waitForButtonAndOpen(), 3000);
    },

    // Reklam modalı görünür ve butonu tekrar aktif olana / video bitene kadar bekler
    // (Normal mod: reklamı tam izletir).
    waitForAdToEnd() {
        return new Promise(resolve => {
            const adBtnSelector = '[data-bind*="openWatchVideosModal"]';
            const maxWait = 120000;
            const startTime = Date.now();

            const adBtn = document.querySelector(adBtnSelector);
            let wasInactive = adBtn && adBtn.classList.contains("inactive-btn");

            const checkInterval = setInterval(() => {
                const btn = document.querySelector(adBtnSelector);
                if (btn && btn.classList.contains("inactive-btn")) wasInactive = true;

                if (wasInactive && btn && !btn.classList.contains("inactive-btn")) {
                    clearInterval(checkInterval); resolve(true); return;
                }
                const modal = document.querySelector(".modal-dialog, .modal, [role='dialog']");
                if (!modal || modal.style.display === "none") {
                    clearInterval(checkInterval); resolve(true); return;
                }
                const video = document.querySelector("video");
                if (video && video.ended) {
                    clearInterval(checkInterval); resolve(true); return;
                }
                if (Date.now() - startTime > maxWait) {
                    clearInterval(checkInterval);
                    Logger.warning("Reklam maksimum bekleme aşıldı, devam ediliyor.");
                    resolve(true); return;
                }
            }, 500);
        });
    },

    // Başarılı turda sayaçları günceller.
    async recordReward() {
        this.currentAdCount++;
        const data = await Storage.get(["totalAdsWatched"]);
        await Storage.set({
            adsWatched: this.currentAdCount,
            totalAdsWatched: (data.totalAdsWatched || 0) + 1
        });
        UI.setStatus("statusRunning");
        UI.setAdCounter(this.currentAdCount);
        Logger.info(`Toplam izlenen reklam: ${(data.totalAdsWatched || 0) + 1}`);
    },

    // ======================
    // API BYPASS DÖNGÜSÜ
    // ======================

    // API Bypass: start -> (bekle) -> watched -> consumereward. 401/başarısızlıkta
    // Modal Odak Kaybı taktiğine düşer (auth şu an 401 dönüyor). Cap dolarsa
    // timestampUntilUnreached ile TAM süreyi timer'a verir.
    async apiAdLoop() {
        Logger.info("API Bypass döngüsü başladı.");
        this.consecutiveApiFails = 0;
        const CYCLE_DELAY = 3000;

        while (true) {
            const state = await Storage.get(["botPaused", "isBanned", "bypassMode"]);
            if (!state.bypassMode) {
                this.bypassMode = false;
                Logger.info("Bypass kapatıldı, modal döngüsüne geçiliyor.");
                this.modalLoop();
                return;
            }
            if (state.botPaused) { UI.setStatus("statusPaused"); return; }
            if (state.isBanned) { Logger.info("Ban işliyor, bypass duruyor."); return; }

            UI.setStatus("statusAdWatching");
            UI.setAdCounter(this.currentAdCount + 1);

            const startResponse = await this.callVideoStart();
            if (!startResponse) {
                if (await this.bypassFallbackOrGiveUp()) return;
                continue;
            }
            this.consecutiveApiFails = 0;

            // Cap: TAM süreyi API'den al.
            if (startResponse.isCapReached === true && startResponse.timestampUntilUnreached) {
                const now = Math.floor(Date.now() / 1000);
                const remaining = startResponse.timestampUntilUnreached - now;
                if (remaining > 0) {
                    const minutes = Math.ceil(remaining / 60);
                    Logger.warning(`Cap dolu, ${minutes} dakika (API) bekleniyor.`);
                    UI.setStatus("statusWaiting");
                    UI.setCooldown();
                    await Timer.start(minutes);
                    return;
                }
            }

            await this.delay(1500);

            const watchedResponse = await this.callWatched();
            const rewardId = this.extractRewardId(watchedResponse);
            if (!rewardId) {
                Logger.warning("watched yanıtından rewardId çıkarılamadı; tur atlanıyor.");
                if (await this.bypassFallbackOrGiveUp()) return;
                continue;
            }
            Logger.info(`rewardId alındı: ${rewardId}, consume ediliyor.`);

            const claim = await this.callClaimReward(rewardId);
            if (!claim) {
                Logger.warning("consumereward başarısız; puan birikmesin diye tur atlanıyor.");
                if (await this.bypassFallbackOrGiveUp()) return;
                continue;
            }

            // TEŞHİS: consume yanıtı cüzdan durumu döndürüyor (amount = toplam
            // boss coin, unclaimedCoins = talep edilmemiş, nextClaimTimestamp =
            // sıradaki claim zamanı). Bunlar tur tur değişiyor mu görmek için
            // logla — zaman-kapısı teorisini doğrular/çürütür.
            if (claim && typeof claim === "object") {
                const now = Math.floor(Date.now() / 1000);
                const next = claim.nextClaimTimestamp;
                const gate = (typeof next === "number")
                    ? (next > now ? `KAPALI (${next - now}sn sonra)` : "AÇIK")
                    : "?";
                Logger.info(`Cüzdan: amount=${claim.amount} unclaimed=${claim.unclaimedCoins} nextClaim=${gate}`);

                // Ekrandaki boss coin göstergesini sayfanın KENDİ fonksiyonuyla
                // güncelle (consume yanıtı zaten cüzdan verisi). API bypass'ta
                // sayfa bunu kendi çağırmıyor, o yüzden biz tetikliyoruz.
                this.refreshPageWallet(claim);
            }

            this.consecutiveApiFails = 0;
            await this.recordReward();
            Logger.success("API ile ödül alındı.");
            await this.delay(CYCLE_DELAY);
        }
    },

    // Bypass hatası: 3 kez üst üste başarısızsa Modal Odak Kaybı taktiğine düş
    // (auth çalışmıyor). true dönerse çağıran döngü RETURN etmeli.
    async bypassFallbackOrGiveUp() {
        this.consecutiveApiFails++;
        Logger.warning(`Bypass API başarısız (${this.consecutiveApiFails}. kez).`);
        if (this.consecutiveApiFails >= 3) {
            Logger.warning("API 3 kez başarısız; Modal Odak Kaybı taktiğine geçiliyor.");
            this.consecutiveApiFails = 0;
            this.modalCloseMode = true; // bu oturum için modal tactic kullan
            this.modalLoop();
            return true;
        }
        await this.delay(3000);
        return false;
    },

    async callVideoStart() {
        return this.callApi(
            "https://web-api.onlinesoccermanager.com/api/v1.1/user/videos/start",
            "actionId=BusinessClub&capVariation=0"
        );
    },

    async callWatched() {
        return this.callApi(
            "https://web-api.onlinesoccermanager.com/api/v1.1/user/videos/watched",
            "actionId=BusinessClub&rewardVariation=0&capVariation=0"
        );
    },

    async callClaimReward(rewardId) {
        return this.callApi(
            "https://web-api.onlinesoccermanager.com/api/v1/user/bosscoinwallet/consumereward",
            `rewardId=${encodeURIComponent(rewardId)}`
        );
    },

    // watched yanıtından rewardId'yi çıkarır. Yanıtın kesin şekli elimizde yok
    // (HAR response body'lerini kaydetmemiş), o yüzden savunmalı: önce bilinen
    // olası alanları dene, bulunamazsa yanıttaki ilk UUID'yi (consumereward'ın
    // beklediği format: 8-4-4-4-12 hex) yakala.
    extractRewardId(resp) {
        if (!resp || typeof resp !== "object") return null;

        const candidates = [
            resp.rewardId,
            resp.reward && resp.reward.rewardId,
            resp.reward && resp.reward.id,
            resp.data && resp.data.rewardId,
            resp.id
        ];
        for (const c of candidates) {
            if (typeof c === "string" && c.length > 0) return c;
        }

        // Son çare: yanıtın tamamında UUID ara.
        try {
            const uuid = JSON.stringify(resp).match(
                /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
            );
            if (uuid) return uuid[0];
        } catch (e) {}

        return null;
    },

    // videos/start yanıtı sayfa tarafında (inject.js fetch/XHR hook) yakalanır ve
    // OSM_API_RESPONSE olarak postMessage edilir. Modal yolunda butona basmadan
    // ÖNCE dinleyici kurarız (arm), böylece yanıtı kaçırmayız; handleVideo o
    // yanıtı bekleyip modalı kapatır.
    _startResponse: {
        armed: false,
        fired: false,
        firedAt: null,
        armedAt: null,
        resolvers: [],
        handler: null
    },

    armVideoStartLatch() {
        const latch = this._startResponse;
        if (latch.armed) return;

        latch.armed = true;
        latch.fired = false;
        latch.firedAt = null;
        latch.armedAt = Date.now();
        latch.resolvers = [];

        const startPattern = /\/api\/v1\.\d\/user\/videos\/start/;
        latch.handler = (e) => {
            if (e.source !== window || !e.data) return;
            if (e.data.type === "OSM_API_RESPONSE" &&
                typeof e.data.url === "string" &&
                startPattern.test(e.data.url)) {
                latch.fired = true;
                latch.firedAt = Date.now();
                Logger.info(`videos/start, tıklamadan ~${latch.firedAt - latch.armedAt}ms sonra geldi.`);
                const pending = latch.resolvers.splice(0);
                pending.forEach(fn => fn(true));
            }
        };
        window.addEventListener("message", latch.handler);
    },

    disarmVideoStartLatch() {
        const latch = this._startResponse;
        if (latch.handler) window.removeEventListener("message", latch.handler);
        latch.armed = false;
        latch.fired = false;
        latch.firedAt = null;
        latch.armedAt = null;
        latch.handler = null;
        latch.resolvers = [];
    },

    // Latch armlanmışsa videos/start yanıtını bekler. Zaten geldiyse hemen döner.
    waitForVideoStart(timeoutMs = 8000) {
        const latch = this._startResponse;
        if (latch.fired) return Promise.resolve(true);

        return new Promise(resolve => {
            let done = false;
            const finish = (fired) => {
                if (done) return;
                done = true;
                const idx = latch.resolvers.indexOf(finish);
                if (idx !== -1) latch.resolvers.splice(idx, 1);
                resolve(fired);
            };
            latch.resolvers.push(finish);
            setTimeout(() => finish(false), timeoutMs);
        });
    },

    // Sayfanın KENDİ yaptığı reward API çağrılarını (modal odak kaybı modunda
    // watched/consume'u sayfa yapar) tek seferlik kurup loglar. inject.js her
    // yanıtı OSM_API_RESPONSE olarak yayınlıyor; bizim callApi'den gelenlerin
    // callId'si var, sayfanınkilerin yok — sadece sayfanınkileri logla ki
    // callApi loglarıyla çift olmasın.
    _rewardLoggerInstalled: false,
    installRewardResponseLogger() {
        if (this._rewardLoggerInstalled) return;
        this._rewardLoggerInstalled = true;

        const rewardPattern = /videos\/(start|watched)|consumereward|userrewards|bosscoinwallet/i;
        window.addEventListener("message", (e) => {
            if (e.source !== window || !e.data) return;
            if (e.data.type !== "OSM_API_RESPONSE") return;
            if (e.data.callId) return; // bizim çağrımız, callApi zaten logladı
            const url = e.data.url;
            if (typeof url !== "string" || !rewardPattern.test(url)) return;
            const name = url.split("?")[0].split("/").slice(-1)[0];
            Logger.info(`⟲ SAYFA ${name}  body=${String(e.data.body ?? "(bos)")}`);
        });
    },

    // Consume sonrası ekrandaki boss coin göstergesini sayfanın kendi
    // updateWallet/refreshBossCoinsWallet fonksiyonuyla güncelletir. Cüzdan
    // verisini sayfa context'ine (inject.js) postMessage'lar; asıl çağrı orada
    // yapılır çünkü appViewModel sayfa scope'unda.
    refreshPageWallet(wallet) {
        window.postMessage({ type: "__OSM_UPDATE_WALLET", wallet: wallet }, "*");
    },

    async callApi(endpoint, body) {
        if (!this.injectReady) {
            Logger.info("inject.js hazır değil, bekleniyor...");
            await new Promise(resolve => {
                const check = () => {
                    if (this.injectReady) { resolve(); return; }
                    setTimeout(check, 500);
                };
                check();
            });
        }

        // Log'da endpoint'in son parçası yeter (watched/start/consumereward).
        const shortName = endpoint.split("/").slice(-1)[0];
        Logger.info(`→ İSTEK ${shortName}  body=${body || "(yok)"}`);

        return new Promise(resolve => {
            const id = Date.now() + "_" + Math.random();
            let resolved = false;

            const handler = (e) => {
                if (e.source !== window || !e.data) return;
                if (e.data.type === "OSM_API_RESPONSE" && e.data.callId === id) {
                    window.removeEventListener("message", handler);
                    if (resolved) return;
                    resolved = true;

                    const { body: text, ok, status } = e.data;

                    // Tam yanıt gövdesini logla (teşhis: reward şekli görünsün).
                    Logger.info(`← YANIT ${shortName}  status=${status}  body=${String(text ?? "(bos)")}`);

                    // HTTP hatası: gövde ne olursa olsun başarısız say.
                    if (ok === false) {
                        Logger.warning(`API ${status} döndü (${shortName}).`);
                        resolve(null);
                        return;
                    }

                    // Başarılı ama gövdesiz (204 vb.) — consumereward böyle dönebilir.
                    const trimmed = String(text ?? "").trim();
                    if (trimmed === "") {
                        resolve({ __empty: true, status });
                        return;
                    }

                    try {
                        resolve(JSON.parse(trimmed));
                    } catch (err) {
                        Logger.warning(`API yanıtı JSON değil (${shortName}): ${trimmed.slice(0, 200)}`);
                        resolve({ __raw: trimmed, status });
                    }
                }
            };

            window.addEventListener("message", handler);

            window.postMessage({
                type: "__OSM_API_CALL",
                endpoint: endpoint,
                body: body,
                id: id
            }, "*");

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    window.removeEventListener("message", handler);
                    Logger.warning("API çağrısı timeout (" + endpoint + ")");
                    resolve(null);
                }
            }, 15000);
        });
    },

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // Modal metninden ban dakikasını çıkarır. Metin sayısız gelirse (son saniye
    // durumu) ilk seferinde 5 dk, üst üste ikinci hatada 60 dk döner.
    parseBanMinutes(text) {
        const match = (text || "").match(/(\d+)\s*dakika/i);
        if (match) {
            this.banParseFailStreak = 0;
            return Number(match[1]);
        }
        this.banParseFailStreak = (this.banParseFailStreak || 0) + 1;
        return this.banParseFailStreak >= 2 ? 60 : 5;
    },

    // Modal DOM'a gelene kadar yoklar. Modalın açılma süresi ile kapatma
    // gecikmesi ayrı şeylerdir; ikisi tek sayıya bağlanırsa düşük gecikmede
    // modal daha render olmadan "açılmadı" sanılıp butona tekrar tıklanır.
    waitForModalElement(timeoutMs = 5000, intervalMs = 50) {
        // Bootstrap modalı kapanınca elemanı DOM'da bırakıp gizler. Salt varlığa
        // bakmak önceki turdan kalan modalı "açıldı" sanmaya yol açıyordu
        // (log: "Modal 1ms içinde açıldı"), o yüzden görünürlük şart.
        const find = () => {
            const nodes = document.querySelectorAll(".modal-dialog, .modal, [role='dialog']");
            for (const n of nodes) {
                if (n.offsetParent !== null) return n;
            }
            return null;
        };

        return new Promise(resolve => {
            const existing = find();
            if (existing) return resolve(existing);

            const deadline = Date.now() + timeoutMs;

            const timer = setInterval(() => {
                const modal = find();
                if (modal) {
                    clearInterval(timer);
                    resolve(modal);
                } else if (Date.now() >= deadline) {
                    clearInterval(timer);
                    resolve(null);
                }
            }, intervalMs);
        });
    },

    findButton() {

        const button = document.querySelector(
            '[data-bind*="openWatchVideosModal"]'
        );

        if (!button) return null;

        if (button.classList.contains("inactive-btn")) {
            Logger.warning("Buton pasif (limit dolmuş).");
            return null;
        }

        return button;
    },

    async clickButtonViaKnockout(button) {

        // Knockout.js viewModel'ini bul
        try {
            if (typeof ko !== "undefined") {
                const context = ko.contextFor(button);
                if (context && context.$root) {
                    const fn = context.$root.openWatchVideosModal;
                    if (typeof fn === "function") {
                        Logger.info("Knockout context üzerinden tıklandı.");
                        fn.call(context.$root);
                        return true;
                    }
                }

                const data = ko.dataFor(button);
                if (data && typeof data.openWatchVideosModal === "function") {
                    Logger.info("Knockout data üzerinden tıklandı.");
                    data.openWatchVideosModal();
                    return true;
                }
            }
        } catch (e) {
            Logger.debug("Knockout yöntemi başarısız: " + e.message);
        }

        try {
            if (typeof jQuery !== "undefined") {
                jQuery(button).trigger("click");
                Logger.info("jQuery trigger ile tıklandı.");
                return true;
            }
        } catch (e) {}

        try {
            button.click();
            Logger.info("DOM click ile tıklandı.");
            return true;
        } catch (e) {}

        try {
            const event = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 0
            });
            button.dispatchEvent(event);
            Logger.info("MouseEvent dispatch ile tıklandı.");
            return true;
        } catch (e) {}

        return false;
    },

    async handleCooldown() {

        // Bu turda video açılmadı; armlanmış start dinleyicisi varsa temizle.
        this.disarmVideoStartLatch();

        Logger.warning("Limit uyarısı alındı.");

        const text = document.querySelector(".modal-body p")?.textContent ?? "";
        const minutes = this.parseBanMinutes(text);

        Logger.info(`${minutes} dakika bekleniyor.`);

        UI.setStatus("statusWaiting");
        UI.setCooldown();

        // Cooldown modalını HEMEN kapat; süre boyunca önde durmasın. Eskiden
        // buton Timer'dan SONRA ve tek zayıf seçiciyle tıklanıyordu, o yüzden
        // modal önde asılı kalıyordu.
        await this.dismissCooldownModal();

        await Timer.start(minutes);
    },

    // BAN modalının kökünü döndürür. Modal Odak Kaybı modunda arkada BAŞKA
    // modallar da açık kalabildiği için ilk ".modal-dialog"u seçmek yanlış
    // modalı yakalıyordu (log "kapatıldı" der, ban modalı ekranda kalırdı).
    // O yüzden: görünür OLACAK ve "Video açılamıyor" başlığını İÇERECEK.
    findBanModal() {
        const titles = document.querySelectorAll(".modal-title");
        for (const title of titles) {
            // Görünürlüğü başlığın kendisinde ölç: Bootstrap kapanınca elemanı
            // DOM'da bırakıp gizler, offsetParent null olur.
            if (title.offsetParent === null) continue;
            if (!title.textContent.includes("Video açılamıyor")) continue;
            // Başlıktan yukarı çıkıp modal kökünü bul (Tamam butonu orada).
            return title.closest(".modal, .modal-dialog, [role='dialog']") || title.parentElement;
        }
        return null;
    },

    // Ban modalının Tamam butonuna basar. Çıplak .click() Knockout handler'ını
    // tetiklemeyebiliyor (reklam butonunda da aynı sorun vardı), o yüzden
    // clickButtonViaKnockout zinciri kullanılır.
    async tryDismissCooldownModal() {
        const modal = this.findBanModal();
        if (!modal) return false;

        const okBtn =
            modal.querySelector('[data-bind*="okAction"]') ||
            modal.querySelector(".modal-footer .btn, .modal-footer button") ||
            modal.querySelector('[data-bind*="close"]') ||
            modal.querySelector(".modal-header .close, [data-dismiss='modal']");

        if (!okBtn) return false;

        await this.clickButtonViaKnockout(okBtn);

        // Gerçekten kapandı mı? Kapanmadıysa false dön ki tekrar denensin.
        await this.delay(300);
        return this.findBanModal() === null;
    },

    // Modal API yanıtından biraz sonra açılabildiği için kısa aralıklarla dener.
    async dismissCooldownModal(attempts = 6, intervalMs = 500) {
        for (let i = 0; i < attempts; i++) {
            if (await this.tryDismissCooldownModal()) {
                Logger.info("Cooldown modalı Tamam ile kapatıldı.");
                return true;
            }
            await this.delay(intervalMs);
        }

        // Buton yolu tutmadıysa genel kapatma taktiğine düş (ESC/backdrop).
        this.closeRewardModal();
        await this.delay(300);
        const closed = this.findBanModal() === null;
        Logger.info(`Cooldown modalı ${closed ? "kapatıldı" : "KAPATILAMADI"} (fallback).`);
        return closed;
    },

    // Görünür modalda "Video açılamıyor" başlığı var mı? (ban tespiti)
    isBanModalVisible() {
        return this.findBanModal() !== null;
    },

    // Reklam oynatıcı aktif mi? (too_late tespiti: videos/start yakalanmadı ama
    // oynatıcı başlamış olabilir)
    isAdPlaying() {
        const modal = document.querySelector(".modal.in, .modal[style*='block'], .modal-dialog");
        if (!modal) return false;
        const video = modal.querySelector("video");
        if (video && !video.paused && !video.ended) return true;
        return !!modal.querySelector("iframe");
    },

    // Reklam/ödül modalını kapatır. Önde birden çok reklam modalı yığılabildiği
    // için (stack taktiği), sekmedeki TÜM görünür reklam/ödül modallarını tek
    // seferde kapatır. Ban modalına dokunmaz — onu handleCooldown yönetir ve
    // erken kapatılırsa süre okunamaz. Kapat butonu tutmazsa ESC + backdrop
    // fallback'i uygulanır. Modal Odak Kaybı taktiğinin kalbi burasıdır.
    closeRewardModal() {
        // Görünür modal köklerini topla (offsetParent: Bootstrap kapanınca
        // elemanı DOM'da bırakıp gizler, o yüzden salt varlık yetmez).
        // Sadece .modal seç: .modal > .modal-dialog iç içedir, ikisini birden
        // toplamak aynı modalı iki kez işletir. .modal'ı olmayan dialog'lar için
        // [role='dialog'] yedeği eklenir ama .modal'a sarılı olanlar hariç.
        const roots = [];
        document.querySelectorAll(".modal, [role='dialog']").forEach(m => {
            if (m.offsetParent === null) return;
            if (m.closest(".modal") && m.closest(".modal") !== m) return; // iç eleman, kökü zaten alındı
            if (this.isBanModalRoot(m)) return; // ban modalını atla
            roots.push(m);
        });

        let closedAny = false;

        for (const modal of roots) {
            const closeBtn = modal.querySelector(
                ".modal-header .close, [data-dismiss='modal'], [data-bind*='close']"
            );
            if (closeBtn) {
                closeBtn.click();
                closedAny = true;
            }
        }

        // Kapat butonu bulunamayan (veya hiç reklam modalı seçilemeyen) durumda
        // ESC + backdrop ile kapatmayı dene. ANCAK ban modalı görünürken bunu
        // YAPMA: ESC/backdrop ban modalını da kapatır, sonra isBanModalVisible
        // false döner, handleCooldown çağrılmaz ve döngü süreyi hiç okumadan
        // sürekli istek atar. Ban görünürse fallback'i tümden atla.
        if (!closedAny && !this.isBanModalVisible()) {
            const anyModal = document.querySelector(".modal.in, .modal[style*='block'], .modal-dialog");
            if (anyModal) {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
                const backdrops = document.querySelectorAll(".modal-backdrop");
                backdrops.forEach(b => b.click());
                return true;
            }
        }

        return closedAny;
    },

    // Verilen modal kökü ban ("Video açılamıyor") modalı mı? closeRewardModal
    // bunu atlar; findBanModal başlıktan yukarı çıkarken bu köke denk gelir.
    isBanModalRoot(modalRoot) {
        const title = modalRoot.querySelector(".modal-title");
        return !!(title && title.textContent.includes("Video açılamıyor"));
    }

};