// content/debug.js
//
// Geliştirici teşhis modu. Kapalıyken hiçbir şey yapmaz; "osmdbg" yazılarak
// açılır. Açıkken sayfanın ve eklentinin TÜM OSM API isteklerini (istek/yanıt
// gövdeleriyle) kaydeder, panodan veya dosyadan dışa aktarır.
//
// Amaç: yeni reklam tiplerinin actionId'sini ve endpoint'ini HAR export'una
// gerek kalmadan yakalamak. inject.js zaten her fetch/XHR yanıtını
// OSM_API_RESPONSE olarak yayınlıyor; burada onu dinleyip saklıyoruz.

const DebugMode = {

    enabled: false,
    entries: [],
    badge: null,
    typed: "",

    // Kayıt sınırı: storage kotasını doldurmasın. En eskiler düşer — ama ödül
    // akışına ait kayıtlar korunur (bkz. evict). Gece boyunca açık kalan bir
    // sekmede 200 kayıt dakikalar içinde doluyordu; sınır yükseltildi.
    MAX_ENTRIES: 600,

    // Sadece OSM API'si — reklam ağı gürültüsü (Google/doubleclick) alınmaz.
    URL_PATTERN: /onlinesoccermanager\.com\/api\//i,

    SECRET: "osmdbg",

    async init() {
        const state = await Storage.get(["debugMode"]);
        this.enabled = state.debugMode || false;

        this.listenForSecret();
        this.listenForResponses();
        this.listenForUnload();

        if (this.enabled) {
            // Önceki oturumların kayıtlarını geri yükle. Kayıtlar YALNIZCA
            // bellekte tutulduğu sürece her sayfa yenilemesinde siliniyordu;
            // gece çalışan bir ödül turu (ör. savings günlük yenilenmesi)
            // sabah bakıldığında kaybolmuş oluyordu.
            await this.restore();

            Logger.info(`🐛 Debug mod açık (${this.entries.length} kayıt geri yüklendi).`);
            this.showBadge();
            // Sayfa yeni yüklendi; izlemeyi yeniden kur. inject.js hazır
            // olmayabilir, kısa gecikme ile dene.
            setTimeout(() => this.traceViewModel(), 1500);
        }
    },

    // ======================
    // KALICILIK
    // ======================
    // Ödül turları çoğu zaman kullanıcı başında değilken çalışıyor. Kayıt
    // bellekte kalırsa tam da teşhis edilmek istenen olay kaybolur.

    STORAGE_KEY: "debugEntries",
    VM_STORAGE_KEY: "debugVmCalls",

    async restore() {
        try {
            const s = await Storage.get([this.STORAGE_KEY, this.VM_STORAGE_KEY]);
            if (Array.isArray(s[this.STORAGE_KEY])) this.entries = s[this.STORAGE_KEY];
            if (Array.isArray(s[this.VM_STORAGE_KEY])) this.vmCalls = s[this.VM_STORAGE_KEY];
        } catch (e) {
            Logger.warning("🐛 Debug kayıtları geri yüklenemedi.");
        }
    },

    // Yazma sık tetikleniyor (her istek); storage'ı boğmamak için geciktir.
    _saveHandle: null,

    scheduleSave() {
        if (this._saveHandle) return;
        this._saveHandle = setTimeout(() => {
            this._saveHandle = null;
            this.persist();
        }, 2000);
    },

    // chrome.storage.local kotası ~5MB (unlimitedStorage izni yok). Kayıtlar
    // 4000 karaktere kadar gövde taşıyabildiği için sınıra yaklaşmak mümkün.
    //
    // DİKKAT: Storage.set kota hatasını YUTUYOR (resolve ediyor, throw etmiyor),
    // o yüzden try/catch ile kotayı yakalayamayız. Bunun yerine yazmadan ÖNCE
    // boyutu ölçüp gerekiyorsa küçültürüz.
    MAX_BYTES: 3_000_000,

    async persist() {
        if (!this.enabled) return;
        await this.persistForce();
    },

    // Yazılacak veriyi kotaya sığacak hale getirir: önce sıradan kayıtlar,
    // gerekirse en eski ödül kayıtları düşer. Ödüller son atılan olur.
    shrinkToFit() {
        const size = () => {
            try {
                return JSON.stringify(this.entries).length + JSON.stringify(this.vmCalls).length;
            } catch (e) {
                return 0;
            }
        };

        let guard = 0;
        while (size() > this.MAX_BYTES && guard++ < 50) {
            const others = this.entries.filter(e => !this.isReward(e));
            if (others.length > 0) {
                // En eski sıradan kayıtların dörtte birini at.
                const drop = new Set(others.slice(0, Math.max(1, Math.ceil(others.length / 4))));
                this.entries = this.entries.filter(e => !drop.has(e));
                continue;
            }
            if (this.vmCalls.length > 0) {
                this.vmCalls.splice(0, Math.ceil(this.vmCalls.length / 2));
                continue;
            }
            // Yalnızca ödül kayıtları kaldı: en eskileri at.
            this.entries.splice(0, Math.max(1, Math.ceil(this.entries.length / 4)));
        }
    },

    // Sayfa kapanırken/gizlenirken bekleyen yazmayı hemen tamamla. 2 saniyelik
    // geciktirme penceresinde sayfa yenilenirse EN SON kayıtlar kaybolurdu —
    // ödül turu tam da yenilemeden hemen önce olduğu için kritik.
    listenForUnload() {
        const flush = () => {
            if (!this.enabled) return;
            if (this._saveHandle) {
                clearTimeout(this._saveHandle);
                this._saveHandle = null;
            }
            this.persistForce();
        };

        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") flush();
        });
    },

    // Gizli dizi: sayfada "osmdbg" yazılınca modu açar/kapatır. Bir input veya
    // textarea'ya yazarken tetiklenmemesi için hedef kontrol edilir.
    listenForSecret() {
        document.addEventListener("keydown", (e) => {
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
                this.typed = "";
                return;
            }

            if (!e.key || e.key.length !== 1) return;

            this.typed = (this.typed + e.key.toLowerCase()).slice(-this.SECRET.length);

            if (this.typed === this.SECRET) {
                this.typed = "";
                this.toggle();
            }
        });
    },

    async toggle() {
        this.enabled = !this.enabled;
        await Storage.set({ debugMode: this.enabled });

        if (this.enabled) {
            // Daha önce biriktirilmiş kayıtlar varsa geri getir; mod kapatılıp
            // açıldığında geçmiş kaybolmasın.
            await this.restore();
            Logger.success(`🐛 Debug mod AÇILDI — istekler kaydediliyor (${this.entries.length} kayıt mevcut).`);
            this.showBadge();
            this.traceViewModel();
        } else {
            // Kapatırken bekleyen yazma varsa tamamla: son kayıtlar kaybolmasın.
            if (this._saveHandle) {
                clearTimeout(this._saveHandle);
                this._saveHandle = null;
            }
            await this.persistForce();
            Logger.info("🐛 Debug mod kapatıldı (kayıtlar saklandı).");
            this.hideBadge();
        }
    },

    // persist() enabled kontrolü yapıyor; kapatma anında da yazabilmek için
    // bayraktan bağımsız hali.
    async persistForce() {
        this.shrinkToFit();
        try {
            await Storage.set({
                [this.STORAGE_KEY]: this.entries,
                [this.VM_STORAGE_KEY]: this.vmCalls
            });
        } catch (e) {}
    },

    // inject.js'in yayınladığı her API yanıtını yakala. Kapalıyken de dinleyici
    // kuruludur ama erken çıkar — açma anında kod enjekte etmeye gerek kalmaz.
    listenForResponses() {
        window.addEventListener("message", (e) => {
            if (!this.enabled) return;
            if (e.source !== window || !e.data) return;

            if (e.data.type === "OSM_API_REQUEST") {
                this.recordRequest(e.data);
                return;
            }

            // Ödül alındıktan sonra EKRANI güncelleyen sayfa fonksiyonu.
            // API bypass'ta bu çağrıyı biz yapmak zorundayız, o yüzden adını
            // ve argümanını bilmemiz gerek.
            if (e.data.type === "OSM_VM_CALL") {
                this.recordVmCall(e.data);
                return;
            }

            if (e.data.type !== "OSM_API_RESPONSE") return;

            const url = e.data.url;
            if (typeof url !== "string" || !this.URL_PATTERN.test(url)) return;

            this.record({
                url: url,
                status: e.data.status,
                respBody: e.data.body,
                // callId varsa istek bizden (callApi), yoksa sayfanın kendisi.
                source: e.data.callId ? "extension" : "page"
            });
        });
    },

    // Sayfanın viewModel fonksiyon çağrıları. Ağ trafiğinden görünmeyen
    // "ekranı kim tazeliyor" sorusunun cevabı burada birikir.
    vmCalls: [],

    // Geri sayım widget'ları saniyede birkaç kez tetikleniyor (.claimed,
    // getItems, show*Notification). Bunlar ödül akışıyla ilgisiz; kaydedilirse
    // log şişip gerçek olaylar kayboluyor (1.3MB dökümde 3000+ satır gürültü).
    VM_NOISE: /\.claimed$|CountdownTimer.*\.claimed|^appViewModel\.(show[A-Z]\w*|toastsPartial\(\)\.getItems|languagesPartial\(\)\.getItems)$/,

    recordVmCall(data) {
        if (this.VM_NOISE.test(data.name || "")) return;

        // Aynı fonksiyon arka arkaya çağrılıyorsa tekrar kaydetme, sayacı artır.
        const last = this.vmCalls[this.vmCalls.length - 1];
        if (last && last.name === data.name) {
            last.repeat = (last.repeat || 1) + 1;
            return;
        }

        this.vmCalls.push({
            t: new Date().toISOString(),
            name: data.name,
            args: (data.args || []).map(a => this.trim(this.mask(a), 600))
        });

        if (this.vmCalls.length > this.MAX_ENTRIES) {
            this.vmCalls.splice(0, this.vmCalls.length - this.MAX_ENTRIES);
        }

        this.updateBadge();
        this.scheduleSave();
        Logger.info(`🐛 [VM] ${data.name}(${(data.args || []).length} arg)`);
    },

    // viewModel izlemeyi sayfa context'inde kur (appViewModel orada yaşıyor).
    traceViewModel() {
        window.addEventListener("message", (e) => {
            if (!e.data || e.data.type !== "OSM_VM_TRACE_READY") return;
            const r = e.data.result || {};
            if (r.ok) {
                Logger.success(`🐛 viewModel izleme kuruldu (${r.wrapped.length} fonksiyon).`);
            } else {
                Logger.warning(`🐛 viewModel izleme kurulamadı: ${r.reason}`);
            }
        }, { once: true });

        window.postMessage({ type: "__OSM_TRACE_VM" }, "*");
    },

    // İstek gövdesini inject.js ayrıca yayınlıyor (OSM_API_REQUEST).
    recordRequest(detail) {
        if (!this.enabled) return;
        if (!detail || !this.URL_PATTERN.test(detail.url || "")) return;

        this.record({
            url: detail.url,
            method: detail.method,
            reqBody: this.mask(detail.body),
            source: "request"
        });
    },

    record(item) {
        let path = item.url;
        try {
            path = new URL(item.url).pathname;
        } catch (e) {}

        // İstek ve yanıt ayrı mesajlar olarak geliyor (OSM_API_REQUEST /
        // OSM_API_RESPONSE). Aynı yola ait bekleyen bir istek varsa yanıtı
        // ONUN üstüne yaz — aksi halde her çağrı iki satır olarak görünüyor.
        if (item.source !== "request") {
            for (let i = this.entries.length - 1; i >= 0; i--) {
                const e = this.entries[i];
                if (e.path === path && e.respBody === undefined) {
                    e.respBody = this.trim(this.mask(item.respBody));
                    e.status = item.status;
                    this.updateBadge();
                    Logger.info(`🐛 ${e.method} ${path} ${item.status ?? ""}`);
                    return;
                }
            }
        }

        this.entries.push({
            t: new Date().toISOString(),
            method: item.method || (item.reqBody !== undefined ? "POST" : "GET"),
            path: path,
            status: item.status,
            reqBody: item.reqBody,
            respBody: item.source === "request" ? undefined : this.trim(this.mask(item.respBody)),
            src: item.source
        });

        this.evict();
        this.updateBadge();
        this.scheduleSave();

        // İstek satırı sessiz: yanıt gelince tek satır loglanır.
        if (item.source !== "request") {
            Logger.info(`🐛 ${path} ${item.status ?? ""}`);
        }
    },

    // Ödül akışına ait kayıtlar (videos/start, watched, consumereward,
    // caps/sequences) ASLA atılmaz. Sayfa açık kaldığında OSM sürekli istek
    // atıyor; düz FIFO bunları dakikalar içinde tampondan atıyor ve teşhis
    // edilmek istenen tur kayboluyordu.
    REWARD_PATTERN: /videos\/(start|watched)|consumereward|caps\/sequences/i,

    isReward(entry) {
        return this.REWARD_PATTERN.test(entry.path || "");
    },

    evict() {
        if (this.entries.length <= this.MAX_ENTRIES) return;

        const rewards = this.entries.filter(e => this.isReward(e));
        const others = this.entries.filter(e => !this.isReward(e));

        // Önce sıradan kayıtları at; yine de sığmıyorsa en eski ödülleri at.
        const room = Math.max(this.MAX_ENTRIES - rewards.length, 0);
        const keptOthers = others.slice(-room);
        const keptRewards = rewards.slice(-this.MAX_ENTRIES);

        this.entries = [...keptRewards, ...keptOthers]
            .sort((a, b) => String(a.t).localeCompare(String(b.t)));
    },

    // Token/cookie maskele: çıktı bana yapıştırılacak, oturum sızmamalı.
    mask(text) {
        if (typeof text !== "string") return text;
        return text
            .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***")
            .replace(/("?(?:token|access_token|authorization|cookie|sessionId)"?\s*[:=]\s*"?)[^",&;\s}]+/gi, "$1***");
    },

    // Çok uzun yanıtları kırp (actionrewards 59KB geliyor).
    trim(text, max = 4000) {
        if (typeof text !== "string") return text;
        return text.length > max
            ? text.slice(0, max) + `\n...[${text.length - max} karakter kırpıldı]`
            : text;
    },

    buildReport() {
        return JSON.stringify({
            meta: {
                version: (() => { try { return chrome.runtime.getManifest().version; } catch (e) { return "?"; } })(),
                page: location.pathname,
                exportedAt: new Date().toISOString(),
                count: this.entries.length,
                vmCallCount: this.vmCalls.length
            },
            entries: this.entries,
            // Ödül sonrası ekranı tazeleyen sayfa fonksiyonları.
            viewModelCalls: this.vmCalls
        }, null, 2);
    },

    async copyReport() {
        const text = this.buildReport();
        try {
            await navigator.clipboard.writeText(text);
            Logger.success(`🐛 ${this.entries.length} kayıt panoya kopyalandı.`);
            return true;
        } catch (e) {
            // Pano izni yoksa konsola bas; oradan da alınabilir.
            Logger.warning("Pano erişimi yok, kayıtlar konsola basıldı.");
            console.log(text);
            return false;
        }
    },

    downloadReport() {
        const blob = new Blob([this.buildReport()], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.href = url;
        a.download = `osm-debug-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        Logger.success(`🐛 ${this.entries.length} kayıt indirildi.`);
    },

    async clear() {
        this.entries = [];
        this.vmCalls = [];
        this.updateBadge();

        // Storage'dan da sil: yoksa sayfa yenilenince restore() eskileri
        // geri getirir ve "temizle" hiçbir işe yaramamış görünür.
        if (this._saveHandle) {
            clearTimeout(this._saveHandle);
            this._saveHandle = null;
        }
        try {
            await Storage.set({ [this.STORAGE_KEY]: [], [this.VM_STORAGE_KEY]: [] });
        } catch (e) {}

        Logger.info("🐛 Debug kayıtları temizlendi.");
    },

    // ======================
    // ROZET (panel içinde)
    // ======================

    showBadge() {
        if (this.badge) {
            this.badge.style.display = "block";
            this.updateBadge();
            return;
        }

        const panel = document.getElementById("osm-panel");
        if (!panel) return;

        const badge = document.createElement("div");
        badge.id = "osm-debug-badge";
        badge.innerHTML = `
            <div id="osm-debug-title">🐛 DEBUG <span id="osm-debug-count">0</span></div>
            <div id="osm-debug-actions">
                <button id="osm-debug-copy" title="Panoya kopyala">📋</button>
                <button id="osm-debug-save" title="Dosyaya indir">💾</button>
                <button id="osm-debug-clear" title="Temizle">🗑</button>
                <button id="osm-debug-off" title="Debug modu kapat (veya 'osmdbg' yaz)">✕</button>
            </div>
        `;
        panel.appendChild(badge);

        badge.querySelector("#osm-debug-copy").addEventListener("click", (e) => {
            e.stopPropagation();
            this.copyReport();
        });
        badge.querySelector("#osm-debug-save").addEventListener("click", (e) => {
            e.stopPropagation();
            this.downloadReport();
        });
        badge.querySelector("#osm-debug-clear").addEventListener("click", (e) => {
            e.stopPropagation();
            this.clear();
        });
        badge.querySelector("#osm-debug-off").addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggle();
        });

        this.badge = badge;
        this.updateBadge();
    },

    hideBadge() {
        if (this.badge) this.badge.style.display = "none";
    },

    updateBadge() {
        if (!this.badge) return;
        const counter = this.badge.querySelector("#osm-debug-count");
        // "istek/vm-çağrısı" — ikisini ayrı görmek keşifte işe yarıyor.
        if (counter) counter.textContent = `${this.entries.length}/${this.vmCalls.length}`;
    }

};
