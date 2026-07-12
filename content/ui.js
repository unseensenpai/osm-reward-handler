const UI = {

    panel: null,
    status: null,
    countdown: null,
    startButton: null,
    stopButton: null,
    retryButton: null,
    adCounter: null,
    statusLabel: null,
    countdownLabel: null,
    currentStatusKey: null,
    bypassCheck: null,
    bypassText: null,
    modalCloseCheck: null,
    modalCloseText: null,
    delayWrap: null,
    delaySlider: null,
    delayText: null,

    async init() {

        if (document.getElementById("osm-panel"))
            return;

        await ContentI18N.init();
        this.createPanel();

        document.addEventListener('contentI18n:changed', () => this.refreshLang());

    },

    createPanel() {

        const panel = document.createElement("div");
        panel.id = "osm-panel";

        panel.innerHTML = `
            <div id="osm-header">

                <div id="osm-title">
                    ⚽ OSM Reward Handler
                </div>

                <div id="osm-version">
                    v3.2.0
                </div>

            </div>

            <div class="osm-section">

                <div class="osm-label" id="osm-label-status">
                    ${ContentI18N.t('labelStatus')}
                </div>

                <div id="osm-status">
                    ${ContentI18N.t('statusPreparing')}
                </div>

                <div id="osm-ad-counter" style="font-size: 12px; color: #95a5a6; margin-top: 2px;">
                </div>

            </div>

            <div class="osm-section">

                <div class="osm-label" id="osm-label-countdown">
                    ${ContentI18N.t('labelCountdown')}
                </div>

                <div id="osm-countdown">
                    --:--:--
                </div>

            </div>

            <div style="display:flex; gap:6px;">
                <button id="osm-start-btn" style="flex:1; border:none; border-radius:6px; padding:10px; cursor:pointer; font-weight:bold; color:white; background:#27ae60;">
                    ${ContentI18N.t('btnPanelStart')}
                </button>
                <button id="osm-stop-btn" style="flex:1; display:none; border:none; border-radius:6px; padding:10px; cursor:pointer; font-weight:bold; color:white; background:#e67e22;">
                    ${ContentI18N.t('btnPanelStop')}
                </button>
            </div>

            <div class="osm-section" id="osm-modes" style="margin-top:8px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:#bdc3c7;">
                    <input type="checkbox" id="osm-bypass-check">
                    <span id="osm-bypass-text">${ContentI18N.t('bypassLabel')}</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:#bdc3c7;margin-top:4px;">
                    <input type="checkbox" id="osm-modalclose-check">
                    <span id="osm-modalclose-text">${ContentI18N.t('modalCloseLabel')}</span>
                </label>
                <div id="osm-delay-wrap" style="margin-top:6px; display:none;">
                    <div id="osm-delay-text" style="font-size:11px;color:#bdc3c7;margin-bottom:2px;">
                        ${ContentI18N.tVar('modalCloseDelayLabel', { ms: 1000 })}
                    </div>
                    <input type="range" id="osm-delay-slider" min="0" max="3000" step="100" value="1000" style="width:100%;">
                </div>
            </div>

            <button id="osm-retry-btn" style="display:none; background: #e67e22; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold; margin-top: 6px; width: 100%;">
                ${ContentI18N.t('btnRetry')}
            </button>
        `;

        document.body.appendChild(panel);

        this.panel = panel;

        this.status = panel.querySelector("#osm-status");
        this.statusLabel = panel.querySelector("#osm-label-status");
        this.countdown = panel.querySelector("#osm-countdown");
        this.countdownLabel = panel.querySelector("#osm-label-countdown");
        this.startButton = panel.querySelector("#osm-start-btn");
        this.stopButton = panel.querySelector("#osm-stop-btn");
        this.retryButton = panel.querySelector("#osm-retry-btn");
        this.adCounter = panel.querySelector("#osm-ad-counter");
        this.bypassCheck = panel.querySelector("#osm-bypass-check");
        this.bypassText = panel.querySelector("#osm-bypass-text");
        this.modalCloseCheck = panel.querySelector("#osm-modalclose-check");
        this.modalCloseText = panel.querySelector("#osm-modalclose-text");
        this.delayWrap = panel.querySelector("#osm-delay-wrap");
        this.delaySlider = panel.querySelector("#osm-delay-slider");
        this.delayText = panel.querySelector("#osm-delay-text");

        this.registerEvents();

    },

    refreshLang() {
        if (this.statusLabel) this.statusLabel.textContent = ContentI18N.t('labelStatus');
        if (this.countdownLabel) this.countdownLabel.textContent = ContentI18N.t('labelCountdown');
        if (this.startButton) this.startButton.textContent = ContentI18N.t('btnPanelStart');
        if (this.stopButton) this.stopButton.textContent = ContentI18N.t('btnPanelStop');
        if (this.retryButton) this.retryButton.textContent = ContentI18N.t('btnRetry');
        if (this.bypassText) this.bypassText.textContent = ContentI18N.t('bypassLabel');
        if (this.modalCloseText) this.modalCloseText.textContent = ContentI18N.t('modalCloseLabel');
        if (this.delaySlider) this.setDelayText(Number(this.delaySlider.value));

        if (this.currentStatusKey) {
            this.status.textContent = ContentI18N.t(this.currentStatusKey);
        }
    },

    registerEvents() {

        this.startButton.addEventListener("click", async () => {

            const storage = await Storage.get(["botPaused", "automationStarted", "isBanned", "targetTime"]);

            if (storage.isBanned) {
                return;
            }

            if (!storage.automationStarted) {

                await Storage.set({
                    automationStarted: true,
                    botPaused: false
                });

                // Buton her zaman "durdur"a dönsün: otomasyon başlatıldı işareti
                // storage'da kalıcı, yönlendirme sonrası da geçerli olacak.
                this.setStarted();

                // BusinessClub sayfasında değilsek önce oraya git; otomasyon
                // sayfa yüklenince content.js bootstrap'ından kendi devam eder.
                if (this.redirectToBusinessClubIfNeeded()) return;

                this.setStatus("statusRunning");
                Automation.start();

                return;
            }

            // Zaten başlatılmış, devam ettir (resume)
            await Storage.set({ botPaused: false });
            this.setStarted();

            if (this.redirectToBusinessClubIfNeeded()) return;

            this.setStatus("statusRunning");
            location.reload();

        });

        this.stopButton.addEventListener("click", async () => {

            await Storage.set({ botPaused: true });
            this.setStopped();
            this.setStatus("statusPaused");

        });

        this.retryButton.addEventListener("click", async () => {

            await Timer.forceStop();

            this.retryButton.style.display = "none";
            this.setCountdown("00:00:00");
            this.setStarted();
            this.setStatus("statusRunning");
            this.setAdCounter(null);

            location.reload();

        });

        this.bypassCheck.addEventListener("change", async () => {
            const enabled = this.bypassCheck.checked;
            if (enabled) {
                this.modalCloseCheck.checked = false;
                await Storage.set({ bypassMode: true, modalCloseMode: false });
            } else {
                await Storage.set({ bypassMode: false });
            }
        });

        this.modalCloseCheck.addEventListener("change", async () => {
            const enabled = this.modalCloseCheck.checked;
            if (enabled) {
                this.bypassCheck.checked = false;
                await Storage.set({ modalCloseMode: true, bypassMode: false });
            } else {
                await Storage.set({ modalCloseMode: false });
            }
            this.toggleDelaySlider(enabled);
        });

        // Slider: canlı ms değerini göster ve storage'a yaz. "input" her
        // sürüklemede tetiklenir; storage yazımı ucuz (chrome.storage.local).
        this.delaySlider.addEventListener("input", async () => {
            const ms = Number(this.delaySlider.value);
            this.setDelayText(ms);
            await Storage.set({ modalCloseDelayMs: ms });
        });

        Storage.get(["bypassMode", "modalCloseMode", "modalCloseDelayMs"]).then(data => {
            if (this.bypassCheck) this.bypassCheck.checked = data.bypassMode || false;
            if (this.modalCloseCheck) this.modalCloseCheck.checked = data.modalCloseMode || false;

            const ms = Number.isFinite(data.modalCloseDelayMs) ? data.modalCloseDelayMs : 1000;
            if (this.delaySlider) this.delaySlider.value = ms;
            this.setDelayText(ms);
            this.toggleDelaySlider(data.modalCloseMode || false);
        });

    },

    // Slider'ı yalnızca Modal Odak Kaybı modu seçiliyken göster (delay sadece
    // o modda anlamlı).
    toggleDelaySlider(show) {
        if (this.delayWrap) this.delayWrap.style.display = show ? "block" : "none";
    },

    setDelayText(ms) {
        if (this.delayText) this.delayText.textContent = ContentI18N.tVar('modalCloseDelayLabel', { ms });
    },

    // BusinessClub sayfasında değilsek oraya yönlendirir. true dönerse çağıran
    // RETURN etmeli (sayfa değişecek, devam etme). Reklam butonu yalnızca
    // BusinessClub'da olduğu için başka sayfada başlatmak boşa döner.
    redirectToBusinessClubIfNeeded() {
        const isBusinessClub = window.location.href.toLowerCase().includes("businessclub");
        if (isBusinessClub) return false;

        Logger.info("BusinessClub sayfasında değil, yönlendiriliyor...");
        this.setStatus("statusRedirecting");
        setTimeout(() => {
            window.location.href = "https://tr.onlinesoccermanager.com/BusinessClub";
        }, 1500);
        return true;
    },

    setStarted() {
        if (!this.startButton || !this.stopButton) return;
        this.startButton.style.display = "none";
        this.stopButton.style.display = "block";
        this.stopButton.disabled = false;
    },

    setStopped() {
        if (!this.startButton || !this.stopButton) return;
        this.startButton.style.display = "block";
        this.startButton.disabled = false;
        this.stopButton.style.display = "none";
    },

    setCooldown() {
        if (!this.startButton || !this.stopButton) return;
        this.startButton.style.display = "none";
        this.stopButton.style.display = "none";
    },

    setAsWaiting() {

        this.setStopped();
        this.setStatus("statusIdle");
        this.setAdCounter(null);
        this.setCountdown("--:--:--");

    },

    startCountdown(minutes) {

        if (this.countdownInterval)
            clearInterval(this.countdownInterval);

        const targetTime = Date.now() + (minutes * 60 * 1000);

        this.countdownInterval = setInterval(() => {

            const remaining = targetTime - Date.now();

            if (remaining <= 0) {

                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
                this.setCountdown("00:00:00");
                return;

            }

            this.setCountdown(this.formatCountdown(remaining));

        }, 1000);

    },

    formatCountdown(ms) {

        const totalSeconds = Math.floor(ms / 1000);

        const hours = Math.floor(totalSeconds / 3600);

        const minutes = Math.floor((totalSeconds % 3600) / 60);

        const seconds = totalSeconds % 60;

        return [
            hours.toString().padStart(2, "0"),
            minutes.toString().padStart(2, "0"),
            seconds.toString().padStart(2, "0")
        ].join(":");

    },

    setStatus(key) {

        if (!this.status)
            return;

        this.currentStatusKey = key;
        this.status.textContent = ContentI18N.t(key);

    },

    setAdCounter(current) {
        if (!this.adCounter) return;
        if (current === null || current === undefined) {
            this.adCounter.textContent = "";
            return;
        }
        this.adCounter.textContent = ContentI18N.tVar('panelAdCounter', { current });
    },

    setCountdown(text) {

        if (!this.countdown)
            return;

        this.countdown.textContent = text;

    },

    setPaused(paused) {

        if (paused) {
            this.setStopped();
            this.setStatus("statusPaused");
        } else {
            this.setStarted();
            this.setStatus("statusRunning");
        }

    },

    destroy() {

        if (this.panel)
            this.panel.remove();

    }

};
