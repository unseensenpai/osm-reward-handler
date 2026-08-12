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
        this.installRetryListener();

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

        // Global ban yalnızca modal modlarını bağlar. API modunda bekleme
        // hedef bazındadır; burada return edilirse ödül sonrası yenilemeden
        // dönen sayfa otomasyonu bir daha başlatamıyordu (döngü kalıcı ölürdü).
        if (state.isBanned && !this.bypassMode) {
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

            // Geri sayımları besle (her hedefin süresi ayrı).
            if (typeof TargetTimers !== "undefined") TargetTimers.start();

            // Çok hedefli motor tek hedefte de doğru çalışıyor ve cap dolunca
            // sıradakine geçebiliyor. Eski apiAdLoop BusinessClub cap'e
            // takılınca return ediyordu; seçili başka hedefler varsa onlara
            // hiç sıra gelmiyordu.
            this.multiTargetLoop();
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
    // ÇOK HEDEFLİ API DÖNGÜSÜ
    // ======================

    // Seçili hedefleri sırayla işler: sınırlı haklar (Birikimler/Antrenman/
    // Scout) önce, sürekli olan BusinessClub sona. Bir hedef cap'e takılırsa
    // veya hakkı biterse sıradakine geçilir; hepsi tükenirse en kısa cap
    // süresi kadar beklenir.
    async multiTargetLoop() {
        Logger.info("Çok hedefli API döngüsü başladı.");

        const enabled = await this.getEnabledTargets();
        if (enabled.length === 0) {
            Logger.warning("Hiç hedef seçilmemiş.");
            UI.setStatus("statusIdle");
            return;
        }

        Logger.info(`Hedefler: ${enabled.map(t => t.key).join(" → ")}`);

        // Hedef başına bu turdaki durum: kaç tur yapıldı, cap ne zaman açılır.
        const state = {};
        enabled.forEach(t => state[t.key] = { done: 0, blockedUntil: 0 });

        while (true) {
            const s = await Storage.get(["botPaused"]);
            if (s.botPaused) { UI.setStatus("statusPaused"); return; }

            // DİKKAT: isBanned burada KONTROL EDİLMEZ. O bayrak modal
            // modlarına ait, global ve hedef ayrımı yok. Burada okunursa tek
            // bir hedefin (ör. BusinessClub) cap'i tüm motoru durduruyor,
            // hazır olan antrenman/scout hedeflerine hiç sıra gelmiyordu.
            // Çok hedefli motorda bekleme hedef bazında tutulur:
            // state[key].blockedUntil + TargetTimers.capUntil.
            const now = Date.now();

            // Elle tetiklenen hedef sıraya kaynar: beklemesi iptal edilir.
            for (const key of this._manualRetry) {
                if (state[key]) state[key].blockedUntil = 0;
            }

            // Antrenman hedefi slot listesi boşken seçilemez. Liste yalnızca
            // sunucudan öğreniliyor ve döngü içinde tazeleyen kimse yoktu:
            // sayfa antrenman slotu bilinmeden açıldıysa hedef sonsuza kadar
            // atlanıyordu. Sırası gelmeden önce tazelemeyi dene.
            //
            // DİKKAT: en az 30sn arayla. Tazeleme başarısız olursa (lig/takım
            // henüz bilinmiyor) döngü her turda yeniden dener ve saniyede
            // onlarca istek atardı.
            if (now - this._lastSessionRefresh > 30000) {
                for (const t of enabled) {
                    if (!t.needsSession) continue;
                    if (state[t.key].blockedUntil > now) continue;
                    if (TargetContext.ready(t)) continue;
                    this._lastSessionRefresh = now;
                    await TargetContext.refreshTrainingSessions();
                    break;
                }
            }

            const pickable = (t) => {
                const st = state[t.key];
                if (st.blockedUntil > now) return false;
                if (t.dailyLimit && st.done >= t.dailyLimit) return false;
                if (!TargetContext.ready(t)) return false;
                return true;
            };

            // Seçim önceliği:
            //  1. Business Club — ana gelir kaynağı, hakkı varken bekletilmez
            //  2. Elle tetiklenen ya da beklemesi yeni dolan hedef
            //  3. Normal sıra (sınırlı haklar önce, Targets.order)
            const bc = enabled.find(t => t.key === "businessClub");
            const target = (bc && pickable(bc) ? bc : null)
                        || enabled.find(t => this._manualRetry.has(t.key) && pickable(t))
                        || enabled.find(pickable);

            if (target) this._manualRetry.delete(target.key);

            if (!target) {
                // Hepsi kapalı. En erken açılan hedefin saatine kadar UYU ve
                // döngüye DEVAM et — burada return edilirse süre dolduğunda
                // kimse uyanmaz, kullanıcının elle Başlat'a basması gerekirdi.
                const waiting = enabled
                    .map(t => state[t.key].blockedUntil)
                    .filter(v => v > now);

                if (waiting.length === 0) {
                    // Bekleyen sayaç yok. Sebep iki türlü olabilir:
                    //
                    //  a) Günlük hak bitti (gerçekten yapacak iş yok)
                    //  b) Bağlam henüz hazır değil (lig/takım/slot bilinmiyor)
                    //
                    // (b) durumunda döngüyü kapatmak YANLIŞTI: BusinessClub
                    // sınırsızdır ve bağlam birkaç saniye içinde öğreniliyor.
                    // Sayfa açılırken bir kez bile bağlam gecikse otomasyon
                    // kendini kapatıp "automationStarted: false" yazıyordu.
                    const bcEnabled = enabled.some(t => t.key === "businessClub");

                    if (bcEnabled) {
                        // BusinessClub seçiliyse döngü ASLA kapanmaz: bağlam
                        // hazır olana kadar kısa aralıkla tekrar dener.
                        Logger.info("Bağlam hazır değil, 15 saniye sonra tekrar denenecek.");
                        UI.setStatus("statusWaiting");
                        UI.setStarted();
                        if (!(await this.sleepUntil(Date.now() + 15000))) continue;
                        UI.setStatus("statusRunning");
                        continue;
                    }

                    Logger.info("Tüm hedeflerin hakkı doldu.");
                    UI.setStatus("statusIdle");
                    UI.setStopped();
                    await Storage.set({ automationStarted: false });
                    return;
                }

                // En erken açılan hedefi bul: üstteki büyük geri sayım onu
                // gösterir ve uyanınca deneme onunla başlar.
                let soonestKey = null;
                let next = Infinity;
                for (const t of enabled) {
                    const until = state[t.key].blockedUntil;
                    if (until > now && until < next) {
                        next = until;
                        soonestKey = t.key;
                    }
                }

                // Uyanınca sıraya o hedef alınsın (BC hariç: o zaten listenin
                // sonunda ama önceliklidir — aşağıdaki seçimde öne alınır).
                if (soonestKey) this._manualRetry.add(soonestKey);

                const waitMs = Math.max(next - Date.now(), 15000);
                const minutes = Math.ceil(waitMs / 60000);

                Logger.info(`En erken açılan: ${soonestKey}, ${minutes} dakika bekleniyor.`);
                UI.setStatus("statusWaiting");
                // Beklerken DURDUR görünmeli: setCooldown ikisini de gizliyor,
                // kullanıcı otomasyonu iptal edemiyordu. Üst sayaca da
                // dokunmuyoruz — satırlardan beslenen tick en küçüğü yazıyor.
                UI.setStarted();

                const sleptFully = await this.sleepUntil(next);

                // Duraklatma yüzünden erken uyandıysak "çalışıyor" gösterme;
                // döngü başındaki botPaused kontrolü zaten çıkışı yönetir.
                if (!sleptFully) continue;

                UI.setStatus("statusRunning");
                UI.setStarted();
                continue;
            }

            const result = await this.runTargetCycle(target, state[target.key]);

            // Tur ortasında durduruldu: sayaç artırmadan çık.
            if (result.paused) {
                Logger.info("Durduruldu.");
                UI.setStatus("statusPaused");
                UI.setStopped();
                return;
            }

            if (result.capReached) {
                state[target.key].blockedUntil = result.until || (Date.now() + 3600000);
                const mins = Math.ceil((state[target.key].blockedUntil - Date.now()) / 60000);
                Logger.warning(`${target.key}: cap dolu, ${mins} dakika sonra tekrar.`);
                continue;
            }

            if (result.ok) {
                // API çalışıyor: birikmiş hata sayacını sıfırla, yoksa saatler
                // içinde dağınık 3 hata modal taktiğini boşuna tetiklerdi.
                this.consecutiveApiFails = 0;

                state[target.key].done++;
                await this.recordReward();
                Logger.success(`${target.key}: ödül alındı (${state[target.key].done}. tur).`);

                // Not: burada ARTIK sayfa yenilenmiyor. Gösterge tazeleme
                // runTargetCycle içinde F5'siz yapılıyor (refreshPageView).
                // Eski location.reload() döngüyü kalıcı olarak öldürüyordu.
                await this.delay(3000);
            } else {
                // Kimlik hatası (401 / token yenilenemedi) GEÇİCİDİR ve hedefe
                // özgü değildir: sayfa bir sonraki isteğinde token'ı tazeleyince
                // kendiliğinden düzelir. Bunu 1 dakikalık cezaya çevirmek
                // yanlıştı — panel cap'ten beslenip "Hazır" gösterirken döngü
                // kendi 60sn'sini bekliyor, kullanıcı Durdur/Başlat yapmak
                // zorunda kalıyordu. Kısa bekleyip tekrar denenir.
                const penalty = result.authFailure ? 10000 : 60000;
                state[target.key].blockedUntil = Date.now() + penalty;
                Logger.warning(result.authFailure
                    ? `${target.key}: kimlik hatası, 10 saniye sonra tekrar denenecek.`
                    : `${target.key}: başarısız, 1 dakika atlanıyor.`);

                // Kimlik ÜST ÜSTE düzelmiyorsa (token akışı tamamen bozuk) API
                // ile hiçbir ödül alınamaz; sonsuza kadar 10sn'de bir denemek
                // yerine modal taktiğine düş. Bu emniyet apiAdLoop'la birlikte
                // kaybolmuştu. Yalnızca BusinessClub'da anlamlı: modal sadece
                // orada var. Başarılı tur sayacı sıfırlar (runTargetCycle).
                if (result.authFailure && target.key === "businessClub") {
                    if (await this.bypassFallbackOrGiveUp()) return;
                }
            }
        }
    },

    // Satır başına "şimdi dene": o hedefin bekleme kaydını siler, döngü bir
    // sonraki turda onu tekrar dener. Döngü çalışmıyorsa tek tur çalıştırır.
    _manualRetry: new Set(),

    // Antrenman slot listesinin son tazelenme zamanı. Döngü, hedef hazır
    // değilken tazelemeyi dener; bu damga istek selini önler (bkz.
    // multiTargetLoop içindeki 30sn kapısı).
    _lastSessionRefresh: 0,

    installRetryListener() {
        if (this._retryListenerInstalled) return;
        this._retryListenerInstalled = true;

        document.addEventListener("osm:retryTarget", async (e) => {
            const key = e.detail && e.detail.key;

            // Sonucu HER yolda bildir: aksi halde buton "çalışıyor" durumunda
            // asılı kalıyor ve kullanıcı bir şey olup olmadığını anlamıyor.
            const done = (ok, reason) => {
                document.dispatchEvent(new CustomEvent("osm:targetResult", {
                    detail: { key, ok, reason }
                }));
            };

            const target = Targets.get(key);
            if (!target) {
                Logger.warning(`Bilinmeyen hedef: ${key}`);
                return done(false, "unknown");
            }

            // Döngüye de haber ver: sırası gelince öne alınsın.
            this._manualRetry.add(key);

            // ESKİDEN: yalnızca otomasyon DURUYORKEN deneniyordu. Döngü
            // çalışırken butona basmak hiçbir şey yapmıyordu (döngü uzun
            // uykudaysa tur başına hiç gelinmiyor). Artık her durumda
            // doğrudan bir tur çalıştırılır.
            const s = await Storage.get(["isBanned"]);
            if (s.isBanned) {
                Logger.warning("Bekleme süresi sürüyor, deneme atlandı.");
                return done(false, "banned");
            }

            if (!TargetContext.ready(target)) {
                // Antrenman slotları veya lig/takım henüz bilinmiyor olabilir.
                if (target.needsSession) await TargetContext.refreshTrainingSessions();
                if (!TargetContext.ready(target)) {
                    Logger.warning(`${key}: bağlam hazır değil (lig/takım/slot).`);
                    return done(false, "notready");
                }
            }

            Logger.info(`${key}: deneniyor...`);
            try {
                const result = await this.runTargetCycle(target, { done: 0 }, true);

                if (result.ok) {
                    await this.recordReward();
                    Logger.success(`${key}: ödül alındı.`);
                    done(true);
                } else if (result.capReached) {
                    const mins = result.until
                        ? Math.ceil((result.until - Date.now()) / 60000)
                        : null;
                    Logger.warning(`${key}: cap dolu${mins ? ` (${mins} dk)` : ""}.`);
                    done(false, "cap");
                } else {
                    Logger.warning(`${key}: başarısız.`);
                    done(false, "fail");
                }
            } catch (err) {
                Logger.error(`${key}: hata — ${err.message}`);
                done(false, "error");
            }

            if (typeof TargetTimers !== "undefined") TargetTimers.poll();
        });
    },

    // Verilen zamana kadar uyur ama 5 saniyede bir uyanıp duraklatma kontrol
    // eder: tek uzun setTimeout ile beklenirse Durdur'a basmak bir saat sonra
    // etki ederdi. Duraklatılırsa erken döner.
    async sleepUntil(timestamp) {
        const STEP = 5000;
        while (Date.now() < timestamp) {
            const s = await Storage.get(["botPaused"]);
            if (s.botPaused) return false;

            const left = timestamp - Date.now();
            await this.delay(Math.min(STEP, left));
        }
        return true;
    },

    // Birikimler kaçıncı adımda? caps/sequences her adımın durumunu DİZİ
    // olarak döndürür (kayıt 13:29):
    //   [{actionId:"Multistep1", isCapReached:true,  timestampUntilUnreached:...},
    //    {actionId:"Multistep2", isCapReached:true,  ...},
    //    {actionId:"Multistep3", isCapReached:false, ...}]
    // Yapılabilir ilk adım = isCapReached false olan ilki. Hepsi doluysa null
    // döner ve çağıran hedefi cap'li sayar.
    async fetchSequenceStep(target) {
        try {
            const resp = await this.callApi(Targets.url(target.capPath()), null, "GET");
            if (!Array.isArray(resp)) return null;

            let earliestCap = null;

            for (const item of resp) {
                const m = String(item.actionId || "").match(/(\d+)$/);
                if (!m) continue;

                if (item.isCapReached !== true) {
                    const step = Number(m[1]);
                    Logger.info(`${target.key}: sıradaki adım ${step}.`);
                    return step;
                }

                if (item.timestampUntilUnreached) {
                    earliestCap = earliestCap === null
                        ? item.timestampUntilUnreached
                        : Math.min(earliestCap, item.timestampUntilUnreached);
                }
            }

            // Tüm adımlar dolu: paneldeki geri sayım yenilenme saatini göstersin.
            if (earliestCap && typeof TargetTimers !== "undefined") {
                TargetTimers.setCap(target.key, earliestCap);
            }
            Logger.info(`${target.key}: tüm adımlar tamamlanmış.`);
            return null;
        } catch (e) {
            return null;
        }
    },

    // Tur ortasında duraklatma/ban kontrolü. Bir tur ~5 saniye sürüyor;
    // yalnızca tur başında bakılırsa Durdur'a basınca geç tepki veriyor.
    // isBanned BİLEREK okunmaz: bu bayrak modal modlarının global cooldown'ı.
    // API modunda cap hedef bazında tutuluyor ve BusinessClub cap'e girdiğinde
    // sürmekte olan antrenman/scout turunun yarıda kesilmesi için sebep değil.
    async isPaused() {
        const s = await Storage.get(["botPaused"]);
        return !!s.botPaused;
    },

    // Panelde işaretli hedefleri Targets.order sırasında döndürür.
    async getEnabledTargets() {
        const s = await Storage.get(["enabledTargets"]);
        const keys = Array.isArray(s.enabledTargets) && s.enabledTargets.length
            ? s.enabledTargets
            : ["businessClub"];   // varsayılan: eski davranış
        return Targets.order.filter(k => keys.includes(k)).map(k => Targets.get(k));
    },

    // Tek hedef için start → watched → consume. Hedef farkları sadece
    // actionId ve consume URL'inde; akış ortak.
    // manual=true: kullanıcı satır butonuna bastı, duraklatma bu turu
    // engellemez (bilinçli istek). Ban yine de üstte kontrol edilir.
    async runTargetCycle(target, targetState, manual = false) {
        UI.setStatus("statusAdWatching");
        UI.setAdCounter(this.currentAdCount + 1);

        // Birikimler adım numarasını actionId'ye gömer (Multistep1..3).
        // Bellekteki sayaç yanıltıcı: kullanıcı gün içinde elle izlemiş
        // olabilir, sayfa yenilenince sayaç sıfırlanır. Gerçek adımı
        // sunucudan sor.
        let step = targetState.done + 1;
        if (typeof target.actionId === "function" && target.capPath) {
            const serverStep = await this.fetchSequenceStep(target);
            if (serverStep === null) {
                // Tüm adımlar dolu. Bellek sayacına düşmek yanlış olurdu:
                // Multistep1 denenip cap'e takılır, kalan adımlar hiç
                // görülmezdi (3. adım dururken hedefin atlanma sebebi buydu).
                const until = TargetTimers?.capUntil?.[target.key];
                return {
                    ok: false,
                    capReached: true,
                    until: until ? until * 1000 : Date.now() + 3600000
                };
            }
            step = serverStep;
        }

        const actionId = typeof target.actionId === "function"
            ? target.actionId(step)
            : target.actionId;

        const start = await this.callApi(
            Targets.url("/api/v1.1/user/videos/start"),
            `actionId=${encodeURIComponent(actionId)}&capVariation=0`
        );
        // 401 ise bunu çağırana bildir: geçici kimlik hatası, hedefe özgü
        // kalıcı bir sorun değil (uzun cezaya çevrilmemeli).
        if (!start) return { ok: false, authFailure: this.lastAuthFailure };
        if (!manual && await this.isPaused()) return { ok: false, paused: true };

        if (start.isCapReached === true) {
            const until = start.timestampUntilUnreached
                ? start.timestampUntilUnreached * 1000
                : 0;
            // Paneldeki geri sayım cap'i göstersin (timers'taki süre farklı
            // şeyi ölçüyor: antrenmanın kendi bitişi, reklam hakkını değil).
            if (typeof TargetTimers !== "undefined" && start.timestampUntilUnreached) {
                TargetTimers.setCap(target.key, start.timestampUntilUnreached);
            }
            return { ok: false, capReached: true, until };
        }

        // Cap açık: varsa eski kaydı temizle ki panel "Hazır" gösterebilsin.
        if (typeof TargetTimers !== "undefined") {
            TargetTimers.setCap(target.key, null);
        }

        await this.delay(1500);

        const watched = await this.callApi(
            Targets.url("/api/v1.1/user/videos/watched"),
            `actionId=${encodeURIComponent(actionId)}&rewardVariation=0&capVariation=0`
        );
        const rewardId = this.extractRewardId(watched);
        if (!rewardId) {
            // watched null döndüyse sebep 401 olabilir; ayırt et.
            if (!watched && this.lastAuthFailure) {
                return { ok: false, authFailure: true };
            }
            Logger.warning(`${target.key}: rewardId çıkarılamadı.`);
            return { ok: false };
        }

        // Duraklatma kontrolü consume'dan ÖNCE son kez: rewardId alındı ama
        // tüketilmediyse kaybolmaz, sunucuda bekler (expiredTimestamp ~7 gün).
        if (!manual && await this.isPaused()) return { ok: false, paused: true };

        // Antrenman: hangi slotun kısaltılacağı round-robin ile seçilir.
        // Slot listesi bilinmiyorsa (ilk tur veya sayfa değişti) tazele.
        if (target.needsSession && TargetContext.trainingSessions.length === 0) {
            await TargetContext.refreshTrainingSessions();
        }

        const ctx = {
            leagueId: TargetContext.leagueId,
            teamId: TargetContext.teamId,
            sessionId: target.needsSession ? TargetContext.nextSession() : null,
            // Birikimler'de consume ucu ödül tipine göre değişiyor.
            rewardType: this.extractRewardType(watched)
        };
        if (target.needsSession && !ctx.sessionId) {
            Logger.warning("Antrenman slotu bilinmiyor, hedef atlanıyor.");
            return { ok: false };
        }

        const claim = await this.callApi(
            Targets.url(target.consumePath(ctx)),
            `rewardId=${encodeURIComponent(rewardId)}`
        );

        if (!claim) return { ok: false, authFailure: this.lastAuthFailure };

        // BusinessClub: cüzdan göstergesi sayfanın kendi updateWallet'ı ile
        // F5'siz tazelenir (çözülmüş akış), sayfa yenilenmez.
        if (target.key === "businessClub" && typeof claim === "object") {
            this.refreshPageWallet(claim);
            return { ok: true };
        }

        // Diğer hedefler (antrenman, scout, birikimler): ekranda güncellenmesi
        // gereken şey cüzdan DEĞİL — antrenman süresi kısalıyor, puan değişiyor.
        //
        // ESKİDEN sayfa yenileniyordu (pendingReload). Yorumda "yenileme döngüyü
        // kesmez" yazıyordu ama KESİYORDU: reload sonrası start() bayat
        // isBanned'e takılıp return ediyor, otomasyon bir daha başlamıyordu.
        // Reklam izleme bu yüzden durmuştu. Artık cüzdandaki yöntemin aynısı:
        // sayfanın kendi partial'ı F5'siz tazelenir.
        this.refreshPageView(target.key);

        // Antrenman kısaltıldı: slot süreleri değişti, listeyi sunucudan tazele
        // ki bir sonraki tur güncel slotla çalışsın ve panel doğru göstersin.
        if (target.needsSession) {
            await TargetContext.refreshTrainingSessions();
        }

        return { ok: true };
    },

    // ======================
    // API BYPASS YARDIMCILARI
    // ======================

    // NOT: Eski tek hedefli apiAdLoop KALDIRILDI. Artık bypass modunda da
    // multiTargetLoop çalışıyor (bkz. start()). Eski döngü BusinessClub cap'e
    // takılınca return ediyor, seçili diğer hedeflere hiç sıra gelmiyordu;
    // ayrıca kendi Timer.start(minutes) çağrısıyla global isBanned yazıyordu —
    // ödül döngüsünü kilitleyen asıl sebep buydu.
    //
    // apiAdLoop'a özgü sabit-URL yardımcıları (callVideoStart/callWatched/
    // callClaimReward) da silindi: hepsi actionId'yi "BusinessClub" olarak
    // sabitliyordu, çok hedefli motorda yanlış olurdu. runTargetCycle bu
    // çağrıları hedefin kendi actionId/consumePath'iyle yapıyor.

    // API üst üste başarısızsa (kimlik çalışmıyor) Modal Odak Kaybı taktiğine
    // düşer. true dönerse çağıran döngü RETURN etmeli: kontrolü modalLoop aldı.
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

    // watched yanıtından rewardId'yi çıkarır. Yanıtın kesin şekli elimizde yok
    // (HAR response body'lerini kaydetmemiş), o yüzden savunmalı: önce bilinen
    // olası alanları dene, bulunamazsa yanıttaki ilk UUID'yi (consumereward'ın
    // beklediği format: 8-4-4-4-12 hex) yakala.
    // watched yanıtındaki reward.type. Birikimler'de consume ucunu belirler
    // (type 1 = boss coin → bosscoinwallet, diğerleri → finances).
    // Yanıt dizi de olabiliyor: [{reward:{type:1,...}}]
    extractRewardType(resp) {
        const first = Array.isArray(resp) ? resp[0] : resp;
        if (!first || typeof first !== "object") return null;
        const type = first.reward && first.reward.type;
        return typeof type === "number" ? type : null;
    },

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

    // BC dışı hedeflerde (antrenman/scout/birikimler) ekrandaki süre ve puan
    // göstergesini sayfanın KENDİ partial'ıyla tazeler. Cüzdandaki yöntemin
    // genel hali; asıl arama inject.js'te yapılır (appViewModel sayfa
    // scope'unda). Sayfa yenilemenin yerini alır — F5 döngüyü öldürüyordu.
    refreshPageView(targetKey) {
        window.postMessage({ type: "__OSM_REFRESH_VIEW", target: targetKey }, "*");
    },

    async callApi(endpoint, body, method = "POST") {
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

        // Her çağrının kendi kimlik durumu olsun; önceki çağrının bayrağı
        // bu çağrıya sızmamalı.
        this.lastAuthFailure = false;

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
                        // Kimlik hatasını işaretle: çağıran bunu geçici sayıp
                        // hedefi uzun süre cezalandırmamalı. (status 0 = CORS'a
                        // dönüşmüş 401; sunucu 401'de CORS header'ı eklemiyor.)
                        this.lastAuthFailure = (status === 401 || status === 0);
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
                method: method,
                id: id
            }, "*");

            // Timeout, inject.js'in EN KÖTÜ senaryosundan uzun olmalı:
            // proaktif tazeleme beklemesi (5sn) + 401 sonrası token yenileme
            // beklemesi (8sn) + iki fetch. 15sn buna yetmiyordu; token
            // yenilenmesi tamamlanmadan timeout devreye girip çağrıyı
            // başarısız sayıyordu (konsolda "Token yenilenemedi" ile
            // "API çağrısı timeout" peş peşe geliyordu).
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    window.removeEventListener("message", handler);
                    Logger.warning("API çağrısı timeout (" + endpoint + ")");
                    resolve(null);
                }
            }, 30000);
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