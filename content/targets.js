// content/targets.js
//
// Reklam ödülü hedefleri. Hepsi aynı üçlü akışı paylaşır:
//   POST videos/start   -> actionId
//   POST videos/watched -> rewardId döner
//   POST <consume>      -> rewardId tüketilir
//
// Fark eden tek şey actionId ve consume URL'i. Bu yüzden hedefler veri olarak
// tanımlanır, akış motoru (automation.js) ortak kalır.
//
// Kaynak: debug modu kayıtları (2026-08-10, v3.3.0).

const API_BASE = "https://web-api.onlinesoccermanager.com";

const Targets = {

    // ------------------------------------------------------------------
    // BUSINESS CLUB — sürekli, cap dolana dek. Tek hedef ki modal/manuel
    // yolu da var (diğerleri yalnızca API).
    // ------------------------------------------------------------------
    businessClub: {
        key: "businessClub",
        labelKey: "targetBusinessClub",
        actionId: "BusinessClub",
        // Takım/lig gerektirmez, kullanıcı cüzdanına gider.
        consumePath: () => "/api/v1/user/bosscoinwallet/consumereward",
        needsTeam: false,
        // Günlük sabit hak yok; cap saatlik dolar ve start yanıtı söyler.
        dailyLimit: null,
        supportsModal: true,
        page: "/BusinessClub"
    },

    // ------------------------------------------------------------------
    // BİRİKİMLER (Savings) — günde 3 adım, actionId adım numarasını taşır.
    // Kanıt: Multistep1 ve Multistep2 kayıtlarda ardışık görüldü.
    // ------------------------------------------------------------------
    savings: {
        key: "savings",
        labelKey: "targetSavings",
        // Adım numarası çalışma anında eklenir (Multistep1..3).
        actionId: (step = 1) => `Multistep${step}`,
        // Consume ucu ÖDÜL TİPİNE göre değişiyor: adım 1-2 kulüp fonu verir
        // (finances), adım 3 boss coin verir (bosscoinwallet). watched
        // yanıtındaki reward.type ayırt eder — kayıtta type:1 = boss coin.
        consumePath: (ctx) =>
            ctx.rewardType === 1
                ? "/api/v1/user/bosscoinwallet/consumereward"
                : `/api/v1/leagues/${ctx.leagueId}/teams/${ctx.teamId}/finances/consumereward`,
        needsTeam: true,
        // Consume ucu ödül tipine göre dallandığı için tip ZORUNLU: bilinmeden
        // istek atılırsa yanlış uca gider ve ödül sessizce kaybolur.
        needsRewardType: true,
        dailyLimit: 3,
        supportsModal: false,
        page: "/Missions",
        // Kaçıncı adımda olduğumuzu bu endpoint söyler.
        capPath: () => "/api/v1/user/caps/sequences/Multistep/0"
    },

    // ------------------------------------------------------------------
    // ANTRENMAN — reklam başına -2 saat (reward.type=2, value=120).
    // consume URL'i HANGİ antrenman slotu olduğunu içerir; slot listesi
    // çalışma anında keşfedilir (bkz. TargetContext.trainingSessions).
    //
    // CAP HEDEF GENELİNDE, slot başına DEĞİL: beş antrenöre arka arkaya
    // tıklandığında beşi de aynı timestampUntilUnreached'i döndürdü
    // (kayıt 2026-08-10 13:15). Yani bir slot cap'e takılırsa diğerlerini
    // denemek anlamsız.
    // ------------------------------------------------------------------
    training: {
        key: "training",
        labelKey: "targetTraining",
        actionId: "TrainingTimer",
        consumePath: (ctx) =>
            `/api/v1/leagues/${ctx.leagueId}/teams/${ctx.teamId}/trainingsessions/${ctx.sessionId}/consumereward`,
        needsTeam: true,
        needsSession: true,
        dailyLimit: null,   // start yanıtındaki isCapReached belirler
        supportsModal: false,
        page: "/Training"
    },

    // ------------------------------------------------------------------
    // YETENEK AVCISI (Scout) — reklam başına -2 saat (reward.type=3).
    // Antrenmandan farkı: consume URL'inde ID YOK, sabit.
    // ------------------------------------------------------------------
    scout: {
        key: "scout",
        labelKey: "targetScout",
        actionId: "ScoutTimer",
        consumePath: (ctx) =>
            `/api/v1/leagues/${ctx.leagueId}/teams/${ctx.teamId}/scoutinstructions/consumereward`,
        needsTeam: true,
        dailyLimit: null,
        supportsModal: false,
        page: "/Scout"
    },

    url(path) {
        return API_BASE + path;
    },

    // Panelde ve sıralamada kullanılacak sıra: sınırlı haklar önce, sürekli
    // olan (BusinessClub) sona. Böylece günlük fırsatlar kaçmaz.
    order: ["savings", "training", "scout", "businessClub"],

    all() {
        return this.order.map(k => this[k]);
    },

    get(key) {
        return this[key] || null;
    }

};

// ----------------------------------------------------------------------
// ÇALIŞMA ANI BAĞLAMI
// ----------------------------------------------------------------------
// leagueId/teamId hiçbir API yanıtından hazır gelmiyor; sayfanın kendi
// isteklerinden yakalanır. inject.js her isteği OSM_API_REQUEST olarak
// yayınlıyor, URL'de .../leagues/<L>/teams/<T>/... deseni geçiyor.

const TargetContext = {

    leagueId: null,
    teamId: null,
    // Antrenman slotları: round-robin için sırayla kullanılır.
    trainingSessions: [],
    sessionCursor: 0,

    init() {
        this.restore();
        this.listen();
    },

    async restore() {
        const s = await Storage.get([
            "ctxLeagueId", "ctxTeamId", "ctxTrainingSessions", "ctxSelectedSessions"
        ]);
        if (s.ctxLeagueId) this.leagueId = s.ctxLeagueId;
        if (s.ctxTeamId) this.teamId = s.ctxTeamId;
        if (Array.isArray(s.ctxTrainingSessions)) this.trainingSessions = s.ctxTrainingSessions;
        if (Array.isArray(s.ctxSelectedSessions)) this.selectedSessions = s.ctxSelectedSessions;
    },

    // Sayfanın kendi trafiğinden lig/takım kimliğini öğren.
    listen() {
        window.addEventListener("message", (e) => {
            if (e.source !== window || !e.data) return;
            const type = e.data.type;
            if (type !== "OSM_API_REQUEST" && type !== "OSM_API_RESPONSE") return;

            const url = e.data.url;
            if (typeof url !== "string") return;

            const m = url.match(/\/leagues\/(\d+)\/teams\/(\d+)\//);
            if (m) this.setTeam(m[1], m[2]);

            // trainingsessions/<id>/consumereward URL'i slot kimliğini taşır.
            const s = url.match(/\/trainingsessions\/(\d+)\//);
            if (s) this.addSession(s[1]);
        });
    },

    async setTeam(leagueId, teamId) {
        if (this.leagueId === leagueId && this.teamId === teamId) return;
        this.leagueId = leagueId;
        this.teamId = teamId;
        Logger.info(`Bağlam: lig=${leagueId} takım=${teamId}`);
        await Storage.set({ ctxLeagueId: leagueId, ctxTeamId: teamId });
    },

    async addSession(sessionId) {
        if (this.trainingSessions.includes(sessionId)) return;
        this.trainingSessions.push(sessionId);
        await Storage.set({ ctxTrainingSessions: this.trainingSessions });
        Logger.info(`Antrenman slotu öğrenildi: ${sessionId}`);
    },

    // Antrenman slotlarını asıl kaynağından çeker. consume URL'inden pasif
    // öğrenme yetmiyordu (slotu kısaltmadan önce bilmemiz gerek); bu endpoint
    // hepsini birden veriyor: id = consume'a giren sessionId, countdownTimer
    // ise o slotun kalan süresi.
    async refreshTrainingSessions() {
        if (!this.leagueId || !this.teamId) return [];

        const path = `/api/v1/leagues/${this.leagueId}/teams/${this.teamId}/trainingsessions/ongoing`;
        const data = await Automation.callApi(Targets.url(path), null, "GET");
        if (!Array.isArray(data)) return this.trainingSessions;

        // Süresi en çok kalanı en sona koy: round-robin ilerlerken en yakın
        // bitecek slot önce kısalsın.
        const sorted = data
            .filter(s => s && s.id)
            .sort((a, b) => {
                const at = a.countdownTimer?.finishedTimestamp ?? 0;
                const bt = b.countdownTimer?.finishedTimestamp ?? 0;
                return at - bt;
            });

        this.trainingSessions = sorted.map(s => String(s.id));
        this.sessionDetails = sorted.map(s => ({
            id: String(s.id),
            trainer: s.trainer,
            title: s.countdownTimer?.title || "",
            player: s.player?.fullName || "",
            finishedTimestamp: s.countdownTimer?.finishedTimestamp || 0,
            // timers yanıtıyla eşleştirmek için: süreler oradan tazeleniyor.
            countdownTimerId: s.countdownTimerId ?? s.countdownTimer?.id ?? null
        }));

        await Storage.set({ ctxTrainingSessions: this.trainingSessions });

        // Slot listesi panelde bilgi olarak gösterilir; tik atılmamış hedef için
        // bunu log'a basmak kullanıcıya "çalışıyorum" izlenimi veriyordu. Log
        // yalnızca liste gerçekten DEĞİŞTİĞİNDE basılır.
        const sig = this.sessionDetails.map(d => d.id).join(",");
        if (sig !== this._lastSessionSig) {
            this._lastSessionSig = sig;
            Logger.info(`Antrenman slotları: ${this.sessionDetails.map(d => d.title).join(", ")}`);
        }

        // Panel alt listeyi bu olayla doldurur.
        document.dispatchEvent(new CustomEvent("osm:sessionsUpdated", {
            detail: this.sessionDetails
        }));

        return this.trainingSessions;
    },

    sessionDetails: [],

    // Slot listesinin son hali (id imzası). Log yalnızca liste değişince basılır.
    _lastSessionSig: null,

    // Kullanıcının panelde işaretlediği slotlar. Boş dizi = "hepsi" (kullanıcı
    // henüz seçim yapmadı); böylece varsayılan davranış eskisiyle aynı kalır.
    selectedSessions: [],

    async setSelectedSessions(ids) {
        this.selectedSessions = Array.isArray(ids) ? ids : [];
        this.sessionCursor = 0;
        await Storage.set({ ctxSelectedSessions: this.selectedSessions });
    },

    // Round-robin havuzu: kullanıcı seçim yaptıysa yalnızca onlar, yoksa
    // bilinen tüm slotlar. Seçilenler arada silinmiş olabilir (antrenman
    // bitti), o yüzden mevcut listeyle kesiştirilir.
    sessionPool() {
        if (this.selectedSessions.length === 0) return this.trainingSessions;
        const pool = this.selectedSessions.filter(id => this.trainingSessions.includes(id));
        return pool.length > 0 ? pool : this.trainingSessions;
    },

    // Round-robin: her çağrıda sıradaki slot. Liste boşsa null döner ve
    // çağıran hedefi atlar (slot keşfedilmeden antrenman kısaltılamaz).
    nextSession() {
        const pool = this.sessionPool();
        if (pool.length === 0) return null;
        const id = pool[this.sessionCursor % pool.length];
        this.sessionCursor++;
        return id;
    },

    ready(target) {
        if (target.needsTeam && (!this.leagueId || !this.teamId)) return false;
        if (target.needsSession && this.trainingSessions.length === 0) return false;
        return true;
    }

};

// ----------------------------------------------------------------------
// GERİ SAYIMLAR
// ----------------------------------------------------------------------
// Her hedefin kendi bekleme süresi var ve hepsi tek endpoint'ten geliyor:
//   GET /api/v1/leagues/<L>/teams/<T>/timers
// Yanıttaki "type" alanı hangi sayacın hangi hedefe ait olduğunu söyler.
// Kaynak: debug kayıtları (2026-08-10).

const TargetTimers = {

    // timers.type -> hedef eşlemesi. Antrenör tipleri (18,1,2,3,4) tek
    // "training" hedefine bağlanır; panelde tek satır gösterilip reklamlar
    // round-robin ile aralarında dağıtılır.
    // DİKKAT: buraya YALNIZCA reklamla kısaltılabilen sayaçlar girer. Oyun
    // aynı ekran için başka sayaçlar da döndürüyor (kanıt: debug export
    // 2026-08-12 13:33):
    //   type 7  "Antrenman sahası"  -20.4 saat (tesis, reklamla ilgisi yok)
    //   type 14 "Sıradaki maç"       +2.7 saat
    //   type 17 "Evrensel antrenör kullanılabilirliği" +0.2 saat
    // Bunlar BİLEREK dışarıda: haritaya eklenirlerse panel yanlış hedefe
    // yanlış süre yazar. type 17 özellikle tuzak — 18 ile karıştırılabilir
    // ama o antrenörün "ne zaman tekrar kullanılabilir"i, reklam hakkı değil.
    TYPE_MAP: {
        9: "scout",       // Yetenek Avcısı
        18: "training",   // Evrensel antrenör
        1: "training",    // Hücum
        2: "training",    // Orta saha
        3: "training",    // Defans
        4: "training"     // Kaleci
    },

    // hedef -> { finishedTimestamp, title } (en yakın biten)
    remaining: {},

    // Reklam hakkının (cap) açılma zamanı: hedef -> unix saniye.
    // DİKKAT: bu, timers'taki süreden FARKLI bir şeydir. timers antrenmanın
    // kendi bitişini söyler (ör. 4 saat), cap ise "ne zaman tekrar reklam
    // izleyebilirim"i (ör. 2.4 saat). Kullanıcı için anlamlı olan ikincisi,
    // panelde o gösterilir. Kaynak: videos/start yanıtı.
    capUntil: {},

    // Cap'i dolmuş ama timers'ta kendi sayacı olmayan hedefler (BusinessClub)
    // için "hazır" işareti. Yeni cap gelince silinir.
    readySince: {},

    // Yalnızca CANLI sunucu yanıtından çağrılır (videos/start, caps/sequences).
    // Dolayısıyla buraya giren her cap doğrulanmıştır.
    setCap(key, timestampSeconds) {
        delete this.unverifiedCaps[key];

        if (!timestampSeconds) {
            delete this.capUntil[key];
        } else {
            this.capUntil[key] = timestampSeconds;
            delete this.readySince[key];   // yeni cap geldi, artık hazır değil
        }
        // Sayfa yenilenince kaybolmasın: cap yalnızca hedef denendiğinde
        // öğrenilebiliyor (videos/start yanıtı), her yüklemede yeniden
        // denemek boşuna istek olurdu.
        Storage.set({ targetCaps: this.capUntil });
        document.dispatchEvent(new CustomEvent("osm:timers", { detail: this.remaining }));
    },

    // Geri yüklenen cap'ler DOĞRULANMAMIŞ sayılır. Cap yalnızca hedef
    // denendiğinde öğrenilebiliyor; yanlış/bayat bir kayıt geri yüklenirse
    // hedef o saate kadar hiç denenmez, denenmediği için de kayıt düzelmez —
    // kendi kendini besleyen kilit. Bu yüzden motor doğrulanmamış cap'i bir
    // kez yok sayıp hedefi yine dener; sunucu gerçekten cap'liyse zaten
    // isCapReached döner ve kayıt tazelenir (maliyet: tek istek).
    unverifiedCaps: {},

    async restoreCaps() {
        const s = await Storage.get(["targetCaps"]);
        if (!s.targetCaps || typeof s.targetCaps !== "object") return;

        const now = Math.floor(Date.now() / 1000);
        for (const [key, ts] of Object.entries(s.targetCaps)) {
            if (typeof ts === "number" && ts > now) {
                this.capUntil[key] = ts;
                this.unverifiedCaps[key] = true;
            }
        }
    },

    // Hedef bu oturumda gerçekten sunucudan doğrulandı mı?
    isCapVerified(key) {
        return !this.unverifiedCaps[key];
    },

    markCapVerified(key) {
        delete this.unverifiedCaps[key];
    },
    pollHandle: null,
    POLL_MS: 60000,

    start() {
        this.restoreCaps();

        if (this.pollHandle) clearInterval(this.pollHandle);
        this.pollHandle = setInterval(() => this.poll(), this.POLL_MS);

        // İlk çekim bağlam hazır olunca yapılmalı: sayfa açılırken leagueId /
        // teamId henüz bilinmiyor (sayfanın kendi isteklerinden öğreniliyor)
        // ve inject.js yüklenmemiş olabilir. Erken denenirse poll sessizce
        // çıkıyor ve panel bir sonraki tura (60sn) kadar boş kalıyordu.
        this.pollWhenReady();
    },

    // Bağlam + inject hazır olana kadar kısa aralıklarla dener (en fazla ~30sn).
    async pollWhenReady() {
        for (let i = 0; i < 30; i++) {
            if (TargetContext.leagueId && TargetContext.teamId && Automation.injectReady) {
                await this.poll();
                return;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        Logger.warning("Geri sayımlar: lig/takım bilgisi alınamadı.");
    },

    stop() {
        if (this.pollHandle) clearInterval(this.pollHandle);
        this.pollHandle = null;
    },

    async poll() {
        if (!TargetContext.leagueId || !TargetContext.teamId) return;
        if (!Automation.injectReady) return;

        const path = `/api/v1/leagues/${TargetContext.leagueId}/teams/${TargetContext.teamId}/timers`;
        const data = await Automation.callApi(Targets.url(path), null, "GET");
        if (!Array.isArray(data)) {
            Logger.warning("timers yanıtı beklenmedik biçimde geldi.");
            return;
        }

        this.apply(data);
    },

    // Aynı hedefe birden çok sayaç düşebilir (5 antrenör). En YAKIN bitecek
    // olanı gösteririz: panelde "sıradaki fırsat ne zaman" bilgisi bu.
    apply(timers) {
        const next = {};

        for (const t of timers) {
            const key = this.TYPE_MAP[t.type];
            if (!key) continue;
            if (t.isClaimed) continue;

            // Süresi ZATEN DOLMUŞ sayaç (finished < now) "hazır" demektir.
            // Kanıt (debug export 2026-08-12 13:33): üç antrenör -226/-220/-212
            // saniyedeydi, yani ödülleri bekliyordu. Eski kod en KÜÇÜK
            // finishedTimestamp'i seçtiği için hep en negatif olanı alıyor,
            // hazır olan slotlar birbirini gölgeliyordu. Hazır bir sayaç
            // varsa hedef hazırdır ve aramayı orada bitiririz.
            const serverNow = t.currentTimestamp || Math.floor(Date.now() / 1000);
            const isReady = t.finishedTimestamp <= serverNow;

            const cur = next[key];

            if (isReady) {
                // Hazır olan her zaman kazanır; birden çoksa ilki yeter.
                if (!cur || !cur.ready) {
                    next[key] = {
                        finishedTimestamp: t.finishedTimestamp,
                        title: t.title,
                        serverNow: t.currentTimestamp,
                        ready: true
                    };
                }
                continue;
            }

            // Hazır sayaç bulunduysa ileri tarihli olanlar onu geçemez.
            if (cur && cur.ready) continue;

            if (!cur || t.finishedTimestamp < cur.finishedTimestamp) {
                next[key] = {
                    finishedTimestamp: t.finishedTimestamp,
                    title: t.title,
                    serverNow: t.currentTimestamp,
                    ready: false
                };
            }
        }

        this.remaining = next;

        // Slot süreleri yalnızca refreshTrainingSessions çağrıldığında
        // güncelleniyordu (nadir); timers zaten her antrenörün sayacını
        // taşıyor, açık slot listesi donuk kalmasın diye buradan tazelenir.
        // Eşleştirme countdownTimer.id üzerinden yapılır.
        if (TargetContext.sessionDetails.length > 0) {
            const byTimerId = {};
            timers.forEach(t => { byTimerId[t.id] = t; });

            for (const d of TargetContext.sessionDetails) {
                const t = byTimerId[d.countdownTimerId];
                if (t && t.finishedTimestamp) d.finishedTimestamp = t.finishedTimestamp;
            }
        }

        document.dispatchEvent(new CustomEvent("osm:timers", { detail: next }));
    },

    // Hedefin kalan süresi (ms). Bilinmiyorsa null.
    // Öncelik cap'te: kullanıcının merak ettiği "ne zaman tekrar reklam
    // izleyebilirim". Cap yoksa timers'taki kendi süresine düşülür.
    msLeft(key) {
        const cap = this.capUntil[key];
        if (cap) {
            const left = cap * 1000 - Date.now();
            if (left > 0) return left;
            delete this.capUntil[key];   // süresi doldu, temizle
            // Cap'in dolması "artık hazır" demektir. Kendi süresi (remaining)
            // olmayan hedefler için bunu HATIRLAMAK gerekir: BusinessClub
            // timers listesinde yok, cap silindikten sonraki tick'te satır
            // "--:--:--"a düşüyordu. Yeni cap gelene kadar hazır sayılır.
            this.readySince[key] = Date.now();
        }

        const r = this.remaining[key];
        // Cap'i dolmuş ama kendi sayacı olmayan hedef (BusinessClub) hazırdır.
        if (!r) return this.readySince[key] ? 0 : null;
        // Sunucu saatiyle yerel saat kayabilir; farkı sabitleyip yerelde sayarız.
        const skew = r.serverNow ? (Date.now() / 1000 - r.serverNow) : 0;
        const left = (r.finishedTimestamp - (Date.now() / 1000 - skew)) * 1000;
        return left > 0 ? left : 0;
    }

};
