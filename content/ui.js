const UI = {

    panel: null,
    status: null,
    countdown: null,
    startButton: null,
    stopButton: null,
    retryButton: null,
    adCounter: null,
    statusLabel: null,
    currentStatusKey: null,
    bypassCheck: null,
    bypassText: null,
    modalCloseCheck: null,
    modalCloseText: null,
    delayWrap: null,
    delaySlider: null,
    delayText: null,
    header: null,
    collapseButton: null,
    dock: null,
    collapsed: false,
    // Açık haldeki konum. Küçükken panel kenara yapıştığı için style.left
    // ezilir; genişletince buraya geri dönülür (CSS'teki varsayılan 15/15).
    expandedLeft: 15,
    expandedTop: 15,

    async init() {

        if (document.getElementById("osm-panel"))
            return;

        await ContentI18N.init();
        this.createPanel();

        document.addEventListener('contentI18n:changed', () => this.refreshLang());

    },

    // Sürüm manifest'ten okunur (tek kaynak). Extension context geçersizse
    // (eklenti güncellendi/kapatıldı) boş döner, panel yine de kurulur.
    getVersion() {
        try {
            return "v" + chrome.runtime.getManifest().version;
        } catch (e) {
            return "";
        }
    },

    createPanel() {

        const panel = document.createElement("div");
        panel.id = "osm-panel";

        // Sayfa body'sinde contenteditable/designMode açıksa panel bunu miras
        // alıp içinde yanıp sönen imleç gösteriyor. Açıkça kapat.
        panel.setAttribute("contenteditable", "false");
        panel.spellcheck = false;

        panel.innerHTML = `
            <div id="osm-dock" title="${ContentI18N.t('expandTooltip')}">
                <div id="osm-dock-icon">⚽</div>
                <div id="osm-dock-dot"></div>
                <div id="osm-dock-arrow">▸</div>
            </div>

            <div id="osm-header">

                <div id="osm-title">
                    ⚽ OSM Reward Handler
                </div>

                <div id="osm-version" title="${ContentI18N.t('checkUpdateTooltip')}">
                    ${this.getVersion()}
                </div>

                <button id="osm-collapse-btn" title="${ContentI18N.t('collapseTooltip')}">◂</button>

            </div>

            <div id="osm-update-banner" style="display:none;">
                <div id="osm-update-text"></div>
                <div id="osm-update-actions">
                    <button id="osm-update-download">${ContentI18N.t('btnUpdateDownload')}</button>
                    <button id="osm-update-notes">${ContentI18N.t('btnUpdateNotes')}</button>
                    <button id="osm-update-dismiss" title="${ContentI18N.t('btnUpdateDismissTooltip')}">✕</button>
                </div>
                <div id="osm-update-hint">${ContentI18N.t('updateHint')}</div>
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

            <div class="osm-section" id="osm-targets-section" style="margin-top:8px;">
                <div class="osm-label" id="osm-label-targets">
                    ${ContentI18N.t('labelTargets')}
                </div>
                <div id="osm-target-list"></div>
            </div>

            <button id="osm-retry-btn" style="display:none; background: #e67e22; color: white; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-weight:bold; margin-top: 6px; width: 100%;">
                ${ContentI18N.t('btnRetry')}
            </button>
        `;

        document.body.appendChild(panel);

        this.panel = panel;

        this.status = panel.querySelector("#osm-status");
        this.statusLabel = panel.querySelector("#osm-label-status");
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
        this.header = panel.querySelector("#osm-header");
        this.collapseButton = panel.querySelector("#osm-collapse-btn");
        this.dock = panel.querySelector("#osm-dock");

        this.updateBanner = panel.querySelector("#osm-update-banner");
        this.updateText = panel.querySelector("#osm-update-text");
        this.updateHint = panel.querySelector("#osm-update-hint");

        this.registerUpdateEvents();
        this.registerEvents();
        this.registerCollapse();
        this.registerDrag();
        this.restoreLayout();
        this.buildTargetList();
        this.startTargetCountdowns();

    },

    // ======================
    // GÜNCELLEME BİLDİRİMİ
    // ======================

    registerUpdateEvents() {
        if (!this.panel) return;

        const dl = this.panel.querySelector("#osm-update-download");
        const notes = this.panel.querySelector("#osm-update-notes");
        const dismiss = this.panel.querySelector("#osm-update-dismiss");
        const version = this.panel.querySelector("#osm-version");

        // Başlıktaki sürüm yazısı = "güncellemeleri denetle". Otomatik kontrol
        // 6 saatte bir; release yeni çıktıysa kullanıcı beklemek zorunda
        // kalmasın. Elle kontrol (manual=true) ayrıca "en güncelsiniz" der ve
        // daha önce "şimdi değil" denmiş sürümü yine gösterir.
        if (version) version.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (version.dataset.busy) return;   // çift tıklama = çift istek

            version.dataset.busy = "1";
            const original = version.textContent;
            version.textContent = ContentI18N.t('checkUpdateChecking');

            try {
                await Updater.check(true);
            } finally {
                // Sürüm metni sabit; sonucu Logger ve banner anlatır.
                version.textContent = original;
                delete version.dataset.busy;
            }
        });

        // "Otomatik kur" KALDIRILDI (v3.4.7). Uzantı kendi disk yolunu göremez
        // (yalnızca chrome-extension:// URL'i görünür), sayfadan klasör açmak
        // ya da shell çalıştırmak da engelli. Buton bu yüzden yalnızca
        // ".\update.ps1" metnini panoya kopyalayabiliyordu; kullanıcı klasörü
        // kendi bulmak zorunda kaldığı için hiçbir işe yaramıyordu.
        // Akış artık dürüstçe elle: İndir → klasöre çıkar → Chrome'dan Yenile.

        // stopPropagation: panel başlığı sürüklenebilir, buton tıklaması
        // sürükleme başlatmasın.
        if (dl) dl.addEventListener("click", (e) => {
            e.stopPropagation();
            Updater.download();
        });

        if (notes) notes.addEventListener("click", (e) => {
            e.stopPropagation();
            Updater.openReleasePage();
        });

        if (dismiss) dismiss.addEventListener("click", (e) => {
            e.stopPropagation();
            Updater.dismiss();
        });
    },

    showUpdateBanner(latest, currentVersion) {
        if (!this.updateBanner) return;

        if (this.updateText) {
            this.updateText.textContent = ContentI18N.tVar('updateAvailable', {
                latest: latest.version,
                current: currentVersion
            });
        }

        if (this.updateHint) {
            this.updateHint.textContent = ContentI18N.t('updateHint');
        }

        this.updateBanner.style.display = "block";

        // Panel küçültülmüşse kullanıcı bandı göremez; dock'taki noktayı
        // vurgula ki bir şey olduğu belli olsun.
        if (this.dock) this.dock.classList.add("osm-has-update");
    },

    hideUpdateBanner() {
        if (this.updateBanner) this.updateBanner.style.display = "none";
        if (this.dock) this.dock.classList.remove("osm-has-update");
    },

    refreshLang() {
        if (this.statusLabel) this.statusLabel.textContent = ContentI18N.t('labelStatus');
        if (this.startButton) this.startButton.textContent = ContentI18N.t('btnPanelStart');
        if (this.stopButton) this.stopButton.textContent = ContentI18N.t('btnPanelStop');
        if (this.retryButton) this.retryButton.textContent = ContentI18N.t('btnRetry');
        if (this.bypassText) this.bypassText.textContent = ContentI18N.t('bypassLabel');
        if (this.modalCloseText) this.modalCloseText.textContent = ContentI18N.t('modalCloseLabel');
        if (this.delaySlider) this.setDelayText(Number(this.delaySlider.value));
        if (this.collapseButton) this.collapseButton.title = ContentI18N.t('collapseTooltip');
        if (this.dock) this.dock.title = ContentI18N.t('expandTooltip');

        const versionEl = this.panel && this.panel.querySelector("#osm-version");
        if (versionEl) versionEl.title = ContentI18N.t('checkUpdateTooltip');

        // Güncelleme bandı açıksa metinleri de çevir: dil değişince banda
        // dokunulmuyordu ve eski dildeki yönerge ekranda kalıyordu.
        if (this.updateHint) this.updateHint.textContent = ContentI18N.t('updateHint');

        const targetsLabel = this.panel && this.panel.querySelector("#osm-label-targets");
        if (targetsLabel) targetsLabel.textContent = ContentI18N.t('labelTargets');
        // Hedef adları ve tooltip'ler dile bağlı; listeyi yeniden kur.
        this.buildTargetList();

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
                // checked'i elle değiştirmek change olayını TETİKLEMEZ; slider
                // modal moduna ait olduğu için burada açıkça gizlenmeli.
                this.toggleDelaySlider(false);
                await Storage.set({ bypassMode: true, modalCloseMode: false });
            } else {
                await Storage.set({ bypassMode: false });
            }
            this.syncTargetAvailability();
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
            // Modal/normal modlar sayfa DOM'una bağlı ve yalnızca
            // BusinessClub'ın modalı var; diğer hedefler API-only.
            this.syncTargetAvailability();
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

    // ======================
    // HEDEF LİSTESİ
    // ======================

    // Her hedef bir satır: seçim kutusu, ad, kendi geri sayımı ve kendi
    // "şimdi dene" butonu. Geri sayımlar timers endpoint'inden beslenir
    // (TargetTimers), her hedefin süresi ayrıdır.
    buildTargetList() {
        const list = this.panel && this.panel.querySelector("#osm-target-list");
        if (!list || typeof Targets === "undefined") return;

        list.innerHTML = "";

        for (const target of Targets.all()) {
            const row = document.createElement("div");
            row.className = "osm-target-row";
            row.dataset.target = target.key;

            // Antrenman'da 5 slot var; kullanıcı hangilerinin kısaltılacağını
            // seçebilsin diye satır açılır-kapanır yapılır.
            // ▸/▾ bazı sistem fontlarında yok ve tire gibi görünüyor;
            // ▶/▼ her yerde render ediliyor.
            const expander = target.needsSession
                ? `<button class="osm-target-expand" title="${ContentI18N.t('targetSlotsTooltip')}">▶</button>`
                : "";

            row.innerHTML = `
                <label class="osm-target-main">
                    <input type="checkbox" class="osm-target-check" data-target="${target.key}">
                    <span class="osm-target-name">${ContentI18N.t(target.labelKey)}</span>
                </label>
                <span class="osm-target-time">--:--:--</span>
                <button class="osm-target-retry" title="${ContentI18N.t('targetRetryTooltip')}">↻</button>
                ${expander}
            `;

            list.appendChild(row);

            if (target.needsSession) {
                const slots = document.createElement("div");
                slots.className = "osm-slot-list";
                slots.dataset.for = target.key;
                slots.style.display = "none";
                list.appendChild(slots);
            }
        }

        this.registerTargetEvents();
        this.restoreTargetSelection();

        // Dil değişiminde liste sıfırdan kuruluyor; açık olan slot listesi
        // kapalı görünmesin diye durum geri yüklenir.
        if (this._slotsOpen) {
            const slots = list.querySelector('.osm-slot-list[data-for="training"]');
            const exp = list.querySelector('.osm-target-row[data-target="training"] .osm-target-expand');
            if (slots) slots.style.display = "block";
            if (exp) exp.textContent = "▼";
            this.renderSlots();
        }
    },

    registerTargetEvents() {
        const list = this.panel.querySelector("#osm-target-list");
        if (!list) return;

        // buildTargetList dil değişiminde yeniden çağrılıyor ve dinleyiciler
        // aynı #osm-target-list elemanına bağlanıyor: her çağrıda bir kat daha
        // birikip tek tıklamayı birden çok kez işliyorlardı (açılan slot
        // listesi hemen kapanıyordu). Bir kez bağla.
        if (this._targetEventsBound) return;
        this._targetEventsBound = true;

        list.addEventListener("change", async (e) => {
            const box = e.target.closest(".osm-target-check");
            if (!box) return;
            await this.saveTargetSelection();
        });

        // Satır başına "şimdi dene": o hedefin beklemesini iptal edip sıradaki
        // turda öne almasını ister. Her hedefin tıklaması farklı çalışır.
        list.addEventListener("click", async (e) => {
            const btn = e.target.closest(".osm-target-retry");
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();

            const row = btn.closest(".osm-target-row");
            const key = row && row.dataset.target;
            if (!key) return;

            // Aynı hedefe üst üste basılmasın: sonuç gelene kadar kilitli.
            if (btn.dataset.busy === "1") return;

            this.setTargetBusy(key, true);
            Logger.info(`${key}: elle tetiklendi.`);
            document.dispatchEvent(new CustomEvent("osm:retryTarget", { detail: { key } }));
        });

        // Otomasyon sonucu bildirir; buton buna göre ✓ / ✕ gösterir.
        document.addEventListener("osm:targetResult", (e) => {
            const { key, ok, reason } = e.detail || {};
            this.setTargetBusy(key, false);
            this.flashTargetResult(key, ok, reason);
        });

        // Antrenman slotlarını aç/kapa.
        list.addEventListener("click", async (e) => {
            const exp = e.target.closest(".osm-target-expand");
            if (!exp) return;
            e.preventDefault();
            e.stopPropagation();

            const row = exp.closest(".osm-target-row");
            const key = row && row.dataset.target;
            const slots = list.querySelector(`.osm-slot-list[data-for="${key}"]`);
            if (!slots) return;

            const open = slots.style.display !== "none";
            slots.style.display = open ? "none" : "block";
            exp.textContent = open ? "▶" : "▼";
            this._slotsOpen = !open;

            // İlk açılışta slotlar henüz bilinmiyor olabilir.
            if (!open && TargetContext.sessionDetails.length === 0) {
                slots.innerHTML = `<div class="osm-slot-empty">${ContentI18N.t('slotsLoading')}</div>`;
                await TargetContext.refreshTrainingSessions();
            }
            this.renderSlots();
        });

        // Slot seçimi değişti.
        list.addEventListener("change", async (e) => {
            const box = e.target.closest(".osm-slot-check");
            if (!box) return;

            // dataset.session artık kalıcı slotKey (antrenman bitince değişen
            // session id DEĞİL); seçim döngüler arasında korunsun diye.
            const checked = [...this.panel.querySelectorAll(".osm-slot-check")]
                .filter(b => b.checked)
                .map(b => b.dataset.session);

            await TargetContext.setSelectedSessions(checked);
            Logger.info(`Antrenman slotları seçildi: ${checked.length || "hepsi"}`);
        });

        document.addEventListener("osm:sessionsUpdated", () => this.renderSlots());
    },

    // Antrenman slot listesini doldurur. Seçim boşsa hepsi işaretli görünür
    // (varsayılan davranış "hepsi arasında sırayla").
    renderSlots() {
        if (!this.panel || typeof TargetContext === "undefined") return;

        const box = this.panel.querySelector('.osm-slot-list[data-for="training"]');
        if (!box || box.style.display === "none") return;

        const details = TargetContext.sessionDetails || [];
        if (details.length === 0) {
            box.innerHTML = `<div class="osm-slot-empty">${ContentI18N.t('slotsEmpty')}</div>`;
            return;
        }

        const selected = TargetContext.selectedSessions;
        // Seçim boş VE kullanıcı bilerek hepsini kaldırmadıysa "hepsi" modu.
        // Kullanıcı tikleri kendi eliyle kaldırdıysa boş liste boş kalmalı,
        // yoksa tikler kendiliğinden geri gelirdi.
        const allMode = selected.length === 0 && !TargetContext.allDeselected;

        box.innerHTML = details.map(d => {
            const checked = allMode || selected.includes(d.slotKey) ? "checked" : "";
            const ms = d.finishedTimestamp
                ? Math.max(0, d.finishedTimestamp * 1000 - Date.now())
                : null;
            // Süresi dolan antrenman kısaltılamaz; oyuncuyu toplamak gerekir.
            const left = ms === null
                ? "--:--:--"
                : (ms <= 0 ? ContentI18N.t('targetReady') : this.formatCountdown(ms));
            // Oyuncu adı slotu ayırt etmeye yarıyor (aynı tip iki kez olabilir).
            const who = d.player ? ` · ${d.player}` : "";
            return `
                <label class="osm-slot-row">
                    <input type="checkbox" class="osm-slot-check" data-session="${d.slotKey}" ${checked}>
                    <span class="osm-slot-name" title="${d.title}${who}">${d.title}</span>
                    <span class="osm-slot-time">${left}</span>
                </label>
            `;
        }).join("");
    },

    // API bypass kapalıyken yalnızca Business Club seçilebilir: Normal ve
    // Modal odak kaybı modları sayfadaki reklam modalını kullanıyor, o modal
    // da sadece BusinessClub'da var. Diğer satırlar devre dışı bırakılır.
    syncTargetAvailability() {
        if (!this.panel) return;

        const apiOnly = !(this.bypassCheck && this.bypassCheck.checked);
        let changed = false;

        this.panel.querySelectorAll(".osm-target-row").forEach(row => {
            const key = row.dataset.target;
            const box = row.querySelector(".osm-target-check");
            const btn = row.querySelector(".osm-target-retry");
            if (!box) return;

            const target = typeof Targets !== "undefined" ? Targets.get(key) : null;
            const blocked = apiOnly && !(target && target.supportsModal);

            const exp = row.querySelector(".osm-target-expand");

            box.disabled = blocked;
            if (btn) btn.disabled = blocked;
            if (exp) exp.disabled = blocked;
            row.classList.toggle("osm-target-disabled", blocked);

            // Hedef kapanıyorsa açık slot listesi de kapansın.
            if (blocked && this._slotsOpen && key === "training") {
                const slots = this.panel.querySelector('.osm-slot-list[data-for="training"]');
                if (slots) slots.style.display = "none";
                if (exp) exp.textContent = "▶";
                this._slotsOpen = false;
            }

            if (blocked && box.checked) {
                box.checked = false;
                changed = true;
            }
            if (apiOnly && target && target.supportsModal && !box.checked) {
                box.checked = true;   // BC tek seçenek: boşta kalmasın
                changed = true;
            }
        });

        if (changed) this.saveTargetSelection();
    },

    // Butonu "çalışıyor" durumuna alır: dönen ikon + kilit. Kullanıcı
    // tıkladığını ve isteğin sürdüğünü görsün.
    setTargetBusy(key, busy) {
        const row = this.panel && this.panel.querySelector(`.osm-target-row[data-target="${key}"]`);
        if (!row) return;

        const btn = row.querySelector(".osm-target-retry");
        if (!btn) return;

        if (busy) {
            btn.dataset.busy = "1";
            btn.classList.add("osm-spin");
            btn.textContent = "↻";
            row.classList.add("osm-target-active");
        } else {
            delete btn.dataset.busy;
            btn.classList.remove("osm-spin");
            row.classList.remove("osm-target-active");
        }
    },

    // Sonucu kısa süre gösterir: ✓ başarı, ✕ hata, ⏳ cap dolu.
    flashTargetResult(key, ok, reason) {
        const row = this.panel && this.panel.querySelector(`.osm-target-row[data-target="${key}"]`);
        if (!row) return;

        const btn = row.querySelector(".osm-target-retry");
        if (!btn) return;

        const marks = { ok: "✓", cap: "⏳", fail: "✕" };
        const state = ok ? "ok" : (reason === "cap" ? "cap" : "fail");

        btn.textContent = marks[state];
        btn.classList.add(`osm-result-${state}`);

        if (this._resultTimers && this._resultTimers[key]) {
            clearTimeout(this._resultTimers[key]);
        }
        this._resultTimers = this._resultTimers || {};

        this._resultTimers[key] = setTimeout(() => {
            btn.textContent = "↻";
            btn.classList.remove("osm-result-ok", "osm-result-cap", "osm-result-fail");
        }, 2500);
    },

    async saveTargetSelection() {
        const boxes = this.panel.querySelectorAll(".osm-target-check");
        const keys = [];
        boxes.forEach(b => { if (b.checked) keys.push(b.dataset.target); });
        await Storage.set({ enabledTargets: keys });
        Logger.info(`Hedefler: ${keys.join(", ") || "(yok)"}`);
    },

    async restoreTargetSelection() {
        const s = await Storage.get(["enabledTargets"]);
        // Varsayılan: yalnızca BusinessClub.
        const keys = Array.isArray(s.enabledTargets) ? s.enabledTargets : ["businessClub"];
        this.panel.querySelectorAll(".osm-target-check").forEach(b => {
            b.checked = keys.includes(b.dataset.target);
        });
        this.syncTargetAvailability();
    },

    // Geri sayımları saniyede bir tazele. Süreler TargetTimers'ta sunucu
    // zaman damgasına göre tutulur; burada sadece gösterim yapılır.
    startTargetCountdowns() {
        if (this.targetTicker) clearInterval(this.targetTicker);

        const tick = () => {
            if (typeof TargetTimers === "undefined" || !this.panel) return;

            // Üst sayaç v3.4.1'de kaldırıldı: her hedef kendi süresini kendi
            // satırında gösterir. "En küçüğü bul, üste yaz" mantığı kaynak
            // null dönünce sessizce yazmayı bırakıp sayacı donduruyordu.

            this.panel.querySelectorAll(".osm-target-row").forEach(row => {
                const key = row.dataset.target;
                const cell = row.querySelector(".osm-target-time");
                if (!cell) return;

                const ms = TargetTimers.msLeft(key);
                if (ms === null) {
                    cell.textContent = "--:--:--";
                    cell.title = "";
                    cell.classList.remove("osm-target-ready");
                } else if (ms <= 0) {
                    cell.textContent = ContentI18N.t('targetReady');
                    cell.title = "";
                    cell.classList.add("osm-target-ready");
                } else {
                    cell.textContent = this.formatCountdown(ms);
                    // Satırdaki süre reklam hakkının açılmasını (cap) gösterir;
                    // alt slotlardaki süreler antrenmanın kendi bitişidir. Yan
                    // yana durunca karışıyor, tooltip ayırt etsin.
                    cell.title = TargetTimers.capUntil[key]
                        ? ContentI18N.t('tooltipAdCap')
                        : ContentI18N.t('tooltipFinish');
                    cell.classList.remove("osm-target-ready");
                }

            });

            // Açık slot listesindeki süreler de aksın.
            this.panel.querySelectorAll(".osm-slot-row").forEach(r => {
                // dataset.session artık slotKey; eşleştirme de onunla yapılır
                // (id ile arasaydı hiç bulamaz, süreler donardı).
                const slotKey = r.querySelector(".osm-slot-check")?.dataset.session;
                const cell = r.querySelector(".osm-slot-time");
                if (!slotKey || !cell) return;
                const d = (TargetContext.sessionDetails || []).find(x => x.slotKey === slotKey);
                if (!d || !d.finishedTimestamp) return;

                // Süre dolunca "00:00:00" değil "Hazır" yazmalı. renderSlots
                // bunu yapıyordu ama satırı saniyede bir ezen yer BURASI;
                // sıfır kontrolü olmadığı için ekranda 00:00:00 kalıyordu.
                const ms = d.finishedTimestamp * 1000 - Date.now();
                if (ms <= 0) {
                    cell.textContent = ContentI18N.t('targetReady');
                    cell.classList.add("osm-target-ready");
                } else {
                    cell.textContent = this.formatCountdown(ms);
                    cell.classList.remove("osm-target-ready");
                }
            });
        };

        tick();
        this.targetTicker = setInterval(tick, 1000);
    },

    // ======================
    // KÜÇÜLTME (DOCK)
    // ======================

    // Küçültme butonu paneli daraltır; şeride tıklamak geri açar. Şerit
    // sol kenara yapışır (CSS left:0 !important) — sürüklenmiş konum
    // korunur, genişletilince aynı yere döner.
    registerCollapse() {
        if (this.collapseButton) {
            this.collapseButton.addEventListener("click", (e) => {
                e.stopPropagation();
                this.setCollapsed(true);
            });
        }

        if (this.dock) {
            this.dock.addEventListener("click", () => this.setCollapsed(false));
        }
    },

    async setCollapsed(collapsed, persist = true) {
        if (!this.panel) return;

        // Küçülürken kenarı seç; büyürken sürüklenmiş konuma geri dön.
        // data-dock CSS'te left:0/right:0 ve köşe yuvarlaklığını belirler.
        if (collapsed) {
            this.panel.dataset.dock = this.nearestEdge();
        } else {
            this.panel.style.left = this.expandedLeft + "px";
            this.panel.style.top = this.expandedTop + "px";
        }

        this.collapsed = collapsed;
        this.panel.classList.toggle("osm-collapsed", collapsed);

        if (persist) {
            await Storage.set({ panelCollapsed: collapsed });
        }
    },

    // Panelin merkezi ekranın hangi yarısındaysa o kenar. Küçültme anında
    // ölçülür; sürükleyip sağa götürdüysen sağa dock olur.
    nearestEdge() {
        const rect = this.panel.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        return center > window.innerWidth / 2 ? "right" : "left";
    },

    // ======================
    // SÜRÜKLEME
    // ======================

    // Başlıktan tut-sürükle. Konum storage'a yazılır, sayfa yenilenince aynı
    // yerde açılır. Küçültme butonuna basarken sürükleme başlamasın diye
    // buton hedefi dışlanır.
    registerDrag() {
        if (!this.panel || !this.header) return;

        let startX = 0, startY = 0, originLeft = 0, originTop = 0, moved = false;

        const onMouseMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
            moved = true;

            const { left, top } = this.clampToViewport(originLeft + dx, originTop + dy);
            this.panel.style.left = left + "px";
            this.panel.style.top = top + "px";
        };

        const onMouseUp = async () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            this.panel.classList.remove("osm-dragging");

            if (!moved) return;

            this.expandedLeft = parseInt(this.panel.style.left, 10);
            this.expandedTop = parseInt(this.panel.style.top, 10);

            await Storage.set({
                panelLeft: this.expandedLeft,
                panelTop: this.expandedTop
            });
        };

        this.header.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest("#osm-collapse-btn")) return;
            // Sürüm yazısı tıklanabilir (güncelleme denetler); üzerine basmak
            // paneli sürüklemeye başlamasın, yoksa tıklama sürüklemeye kayıyor.
            if (e.target.closest("#osm-version")) return;

            const rect = this.panel.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            originLeft = rect.left;
            originTop = rect.top;
            moved = false;

            this.panel.classList.add("osm-dragging");
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);

            e.preventDefault();
        });
    },

    // Paneli görünür alanda tutar; ekran dışına sürüklenip kaybolmasın.
    clampToViewport(left, top) {
        const rect = this.panel.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);

        return {
            left: Math.min(Math.max(0, left), maxLeft),
            top: Math.min(Math.max(0, top), maxTop)
        };
    },

    // Kayıtlı konum ve küçültme durumunu geri yükler. Pencere küçüldüyse
    // kayıtlı konum ekran dışında kalabilir; clamp ile içeri çekilir.
    async restoreLayout() {
        const data = await Storage.get(["panelCollapsed", "panelLeft", "panelTop"]);

        if (Number.isFinite(data.panelLeft) && Number.isFinite(data.panelTop)) {
            const { left, top } = this.clampToViewport(data.panelLeft, data.panelTop);
            this.panel.style.left = left + "px";
            this.panel.style.top = top + "px";
            this.expandedLeft = left;
            this.expandedTop = top;
        }

        // Kenar, açık haldeki konuma göre seçilir; panel şu an küçük olsa bile
        // nearestEdge doğru ölçsün diye sınıf sonradan eklenir.
        if (data.panelCollapsed) {
            this.setCollapsed(true, false);
        }
    },

    // Slider'ı yalnızca Modal Odak Kaybı modu seçiliyken göster (delay sadece
    // o modda anlamlı).
    toggleDelaySlider(show) {
        if (this.delayWrap) this.delayWrap.style.display = show ? "block" : "none";
    },

    setDelayText(ms) {
        if (this.delayText) this.delayText.textContent = ContentI18N.tVar('modalCloseDelayLabel', { ms });
    },

    // Sayfa yönlendirmesi TEK bir durumda gerekir: Modal Odak Kaybı modu.
    // O mod reklam modalını DOM'dan kapattığı için BusinessClub sayfasında
    // olmak zorunda. Diğer her şey (BC dahil tüm hedefler) saf API ile
    // çalışır, sayfa fark etmez. true dönerse çağıran RETURN etmeli.
    redirectToBusinessClubIfNeeded() {
        const isBusinessClub = window.location.href.toLowerCase().includes("businessclub");
        if (isBusinessClub) return false;

        // API bypass doğrudan API'ye gidiyor; sayfa fark etmez, yönlendirme
        // kullanıcıyı boş yere Training/Scout'tan koparır.
        if (this.bypassCheck && this.bypassCheck.checked) return false;

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

    // Üst sayaç kaldırıldığı için ban geri sayımının yazacağı yer kalmadı.
    // Ban süresi artık popup'ta (kendi timer'ı, storage.targetTime'dan besleniyor)
    // ve panelde durum yazısında görünür. Çağrı noktaları duruyor; boş bırakılır.
    startCountdown() {},

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
        this.syncDockState(key);

    },

    // Durum anahtarını dock noktasının rengine çevirir (CSS data-state ile
    // boyar). Panel küçükken tek görünen bilgi bu olduğu için her setStatus'ta
    // güncellenir.
    syncDockState(key) {
        if (!this.panel) return;

        const states = {
            statusRunning: "running",
            statusAdWatching: "running",
            statusRedirecting: "running",
            statusPaused: "paused",
            statusIdle: "paused",
            statusWaiting: "waiting"
        };

        this.panel.dataset.state = states[key] || "idle";
    },

    setAdCounter(current) {
        if (!this.adCounter) return;
        if (current === null || current === undefined) {
            this.adCounter.textContent = "";
            return;
        }
        this.adCounter.textContent = ContentI18N.tVar('panelAdCounter', { current });
    },

    // Üst sayaç v3.4.1'de kaldırıldı (her hedef kendi satırında sayıyor).
    // Çağıranlar (timer.js ban geri sayımı, content.js) duruyor; burada
    // sessizce yutulur ki ban akışı bozulmasın.
    setCountdown() {},

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
