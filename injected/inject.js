(() => {

    const API_RESPONSE = "OSM_API_RESPONSE";
    const API_CALL = "__OSM_API_CALL";

    // ======================
    // TOKEN YAKALAMA
    // ======================

    let osmToken = null;

    try {
        const storedToken = localStorage.getItem("token") ||
                            localStorage.getItem("access_token") ||
                            localStorage.getItem("auth_token") ||
                            localStorage.getItem("OSM_Token");
        if (storedToken) osmToken = storedToken;
    } catch (e) {}

    if (!osmToken) {
        try {
            const match = document.cookie.match(/(?:^|;\s*)token=([^;]+)/);
            if (match) osmToken = match[1];
        } catch (e) {}
    }

    if (osmToken) {
        window.__OSM_TOKEN = osmToken;
    }

    // Bearer token'ı sayfanın KENDİ isteklerinin authorization header'ından yakala.
    // HAR kanıtı: gerçek videos/start|watched|consumereward istekleri cookie ile
    // DEĞİL, "authorization: Bearer <JWT>" ile gidiyor. localStorage/cookie boş
    // kalabildiği için en güvenilir kaynak canlı isteklerin header'ıdır.
    function captureBearer(value) {
        if (!value || typeof value !== "string") return;
        const m = value.match(/^Bearer\s+(.+)$/i);
        if (m) {
            const isNew = window.__OSM_TOKEN !== m[1];
            window.__OSM_TOKEN = m[1];
            // Token her yenilendiğinde bir kez logla (imzayı dökmeden, sadece
            // yakalandığını doğrulamak için baş kısım + uzunluk).
            if (isNew) {
                console.log("[OSM] Bearer token yakalandı (len=" + m[1].length +
                    ", bas=" + m[1].slice(0, 24) + "...)");
            }
        }
    }

    // ======================
    // VİDEO WATCHED / ÖDÜL API TAKİBİ
    // ======================

    const watchedPattern = /\/api\/v1\.\d\/user\/videos\/watched/;

    function checkWatchedResponse(url, text) {
        if (!watchedPattern.test(url)) return;
        try {
            const data = JSON.parse(text);
            if (data && data.rewardId) {
                window.postMessage({
                    type: "OSM_WATCHED_RESPONSE",
                    detail: data
                }, "*");
            }
        } catch (e) {}
    }

    // ======================
    // FETCH HOOK
    // ======================

    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
        try {
            // Giden isteğin authorization header'ını yakala (Bearer token kaynağı).
            // Hem fetch(url, {headers}) hem fetch(new Request(url,{headers}))
            // biçimlerini kapsa.
            const readAuth = (h) => {
                if (!h) return null;
                return typeof h.get === "function"
                    ? h.get("authorization")
                    : (h.authorization || h.Authorization);
            };
            const init = args[1];
            if (init && init.headers) captureBearer(readAuth(init.headers));
            const req = args[0];
            if (req && typeof req === "object" && req.headers) captureBearer(readAuth(req.headers));

            postApiRequest(
                String(args[0]?.url ?? args[0] ?? ""),
                init?.method || args[0]?.method || "GET",
                init?.body
            );
        } catch (e) {}
        const response = await originalFetch(...args);
        try {
            const url = args[0]?.toString() || "";
            const clone = response.clone();
            clone.text().then(text => {
                postApiResponse(url, text);
                checkWatchedResponse(url, text);
            });
        } catch (e) {}
        return response;
    };

    // ======================
    // XHR HOOK
    // ======================

    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;

    const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url) {
        this.__osmUrl = url;
        this.__osmMethod = method;
        return open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try {
            if (name && name.toLowerCase() === "authorization") captureBearer(value);
        } catch (e) {}
        return setRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        try {
            postApiRequest(this.__osmUrl, this.__osmMethod, body);
        } catch (e) {}
        this.addEventListener("load", function() {
            try {
                postApiResponse(this.__osmUrl, this.responseText);
                checkWatchedResponse(this.__osmUrl, this.responseText);
                if (!window.__OSM_TOKEN && this.__osmUrl && this.__osmUrl.includes("api/v1/")) {
                    try {
                        const resp = JSON.parse(this.responseText);
                        if (resp && resp.token) {
                            window.__OSM_TOKEN = resp.token;
                        }
                    } catch (e) {}
                }
            } catch (e) {}
        });
        return send.apply(this, arguments);
    };

    function postApiResponse(url, body) {
        window.postMessage({
            type: API_RESPONSE,
            url: url,
            body: body
        }, "*");
    }

    // Giden isteğin gövdesini yayınla. Debug modu bunu yanıtla eşleştirip
    // actionId gibi parametreleri kaydeder; yanıt tek başına isteği anlatmıyor.
    function postApiRequest(url, method, body) {
        if (typeof url !== "string" || !/onlinesoccermanager\.com\/api\//i.test(url)) return;
        window.postMessage({
            type: "OSM_API_REQUEST",
            url: url,
            method: method || "GET",
            body: typeof body === "string" ? body : null
        }, "*");
    }

    // ======================
    // API HELPER
    // ======================

    async function osmApiCall(endpoint, body, method = "POST") {
        // HAR kanıtı: gerçek istekler kimliği "authorization: Bearer <JWT>" ile
        // taşıyor, cookie ile DEĞİL. Eski kod credentials:"include" (cookie) ile
        // çağırdığı için API 401 dönüyordu. Doğrusu: yakalanan token'ı Bearer
        // olarak gönder. origin/referer/sec-fetch-* forbidden header'dır; elle
        // set edilmez, tarayıcı otomatik ekler.
        // Token sayfanın canlı isteklerinden yakalanır; otomasyon çok erken
        // başlarsa henüz gelmemiş olabilir. Hemen 401 dönüp bypass'ı terk etmek
        // yerine kısa süre bekle (en fazla ~3sn).
        let token = window.__OSM_TOKEN;
        if (!token) {
            const deadline = Date.now() + 3000;
            while (!token && Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 200));
                token = window.__OSM_TOKEN;
            }
        }
        if (!token) {
            console.warn("[OSM] Bearer token yakalanmadı; API çağrısı atlanıyor.");
            return { ok: false, status: 401, text: null, error: "no_token" };
        }

        const isGet = String(method).toUpperCase() === "GET";

        const headers = {
            "accept": "application/json; charset=utf-8",
            "appversion": "3.254.0",
            "platformid": "11",
            "authorization": "Bearer " + token
        };

        // GET'te gövde ve content-type gönderilmez; bazı uçlar buna 400 döner.
        if (!isGet) {
            headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        }

        try {
            // originalFetch: kendi hook'umuzu tetikleyip sahte OSM_API_RESPONSE
            // mesajı üretmesin diye ham fetch kullanılır.
            const response = await originalFetch(endpoint, {
                method: isGet ? "GET" : method,
                headers: headers,
                body: isGet ? undefined : body,
                mode: "cors"
            });
            const text = await response.text();
            console.log("[OSM] API yanıtı (" + response.status + "):", endpoint, text);
            return { ok: response.ok, status: response.status, text: text };
        } catch (e) {
            console.error("[OSM] API çağrısı başarısız:", e.message);
            return { ok: false, status: 0, text: null, error: e.message };
        }
    }

    // ======================
    // VİDEO API FONKSİYONLARI (content script çağırır)
    // ======================

    window.__osmVideoStart = async function(actionId, capVariation = 0) {
        return osmApiCall(
            "https://web-api.onlinesoccermanager.com/api/v1.1/user/videos/start",
            `actionId=${encodeURIComponent(actionId)}&capVariation=${capVariation}`
        );
    };

    window.__osmWatched = async function() {
        return osmApiCall(
            "https://web-api.onlinesoccermanager.com/api/v1.1/user/videos/watched",
            "actionId=BusinessClub&rewardVariation=0&capVariation=0"
        );
    };

    window.__osmClaimReward = async function(rewardId) {
        return osmApiCall(
            "https://web-api.onlinesoccermanager.com/api/v1/user/bosscoinwallet/consumereward",
            `rewardId=${encodeURIComponent(rewardId)}`
        );
    };

    // ======================
    // CONTENT SCRIPT İLETİŞİMİ (postMessage ile)
    // ======================

    window.addEventListener("message", async (e) => {
        if (e.data && e.data.type === API_CALL) {
            const { endpoint, body, id, method } = e.data;
            if (!endpoint) return;

            const result = await osmApiCall(endpoint, body, method);
            window.postMessage({
                type: API_RESPONSE,
                body: result.text,
                ok: result.ok,
                status: result.status,
                callId: id
            }, "*");
        }
    });

    // ======================
    // DEBUG: VIEWMODEL KEŞFİ
    // ======================
    // İstek logu, ödül alındıktan sonra EKRANI kimin güncellediğini göstermez.
    // API bypass'ta o çağrıyı biz yapmak zorundayız (BusinessClub'da
    // updateWallet böyle bulundu). Burada sayfanın kendi viewModel
    // fonksiyonları sarmalanır: kullanıcı reklamı elle izlerken sayfa hangi
    // fonksiyonu çağırıyorsa adı ve argümanı kaydedilir.

    let vmTraceInstalled = false;

    function traceViewModel() {
        if (vmTraceInstalled) return { ok: false, reason: "already_installed" };
        if (typeof appViewModel === "undefined") return { ok: false, reason: "no_viewmodel" };

        const wrapped = [];
        // Desen geniş tutulur: ilk denemede /^(update|refresh|...)/ ile sadece
        // 4 countdown observable'ı yakalandı, Training sayfasının kendi
        // partial'ı kaçtı. Ekranı tazeleyen fonksiyon "onRewardConsumed",
        // "handleX", "bindY", "initZ" gibi de adlandırılabiliyor.
        const NAME = /^(update|refresh|reload|load|set|apply|consume|claim|complete|on[A-Z]|handle|bind|init|fetch|get|show|render|populate|sync)/;
        const SKIP = /^(getElement|getComputed|getAttribute|getContext)/;

        const seen = new WeakSet();
        const MAX_DEPTH = 4;

        const wrap = (obj, objPath, depth) => {
            if (!obj || depth > MAX_DEPTH) return;
            if (seen.has(obj)) return;   // döngüsel referans koruması
            seen.add(obj);

            let keys = [];
            try { keys = Object.keys(obj); } catch (e) { return; }
            if (keys.length > 300) return;   // devasa nesnelerde boğulma

            for (const key of keys) {
                let value;
                try { value = obj[key]; } catch (e) { continue; }

                // Knockout observable: çağırıp içindeki nesneye in.
                if (typeof value === "function" && value.length === 0 && depth < MAX_DEPTH) {
                    let inner;
                    try { inner = value(); } catch (e) { inner = null; }
                    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
                        wrap(inner, objPath + key + "().", depth + 1);
                    }
                }

                // Düz nesne alanlarına da in (partial'lar observable olmayabilir).
                if (value && typeof value === "object" && !Array.isArray(value) && depth < MAX_DEPTH) {
                    wrap(value, objPath + key + ".", depth + 1);
                }

                if (typeof value !== "function" || !NAME.test(key) || SKIP.test(key)) continue;
                if (value.__osmTraced) continue;

                const original = value;
                const fullName = objPath + key;

                const proxy = function (...args) {
                    try {
                        window.postMessage({
                            type: "OSM_VM_CALL",
                            name: fullName,
                            args: args.map(a => {
                                try {
                                    if (a === null || a === undefined) return String(a);
                                    if (typeof a === "object") return JSON.stringify(a).slice(0, 600);
                                    return String(a).slice(0, 200);
                                } catch (e) { return "[serialize hatası]"; }
                            })
                        }, "*");
                    } catch (e) {}
                    return original.apply(this, args);
                };
                proxy.__osmTraced = true;

                try {
                    obj[key] = proxy;
                    wrapped.push(fullName);
                } catch (e) {}
            }
        };

        try {
            wrap(appViewModel, "appViewModel.", 0);
        } catch (e) {
            return { ok: false, reason: e.message };
        }

        vmTraceInstalled = true;
        console.log("[OSM] viewModel izleme kuruldu, " + wrapped.length + " fonksiyon:", wrapped);
        return { ok: true, wrapped: wrapped };
    }

    // Content script "izlemeyi kur" derse kur ve sonucu geri bildir.
    window.addEventListener("message", (e) => {
        if (!e.data || e.data.type !== "__OSM_TRACE_VM") return;
        const result = traceViewModel();
        window.postMessage({ type: "OSM_VM_TRACE_READY", result: result }, "*");
    });

    // ======================
    // CÜZDAN GÖSTERGESİ GÜNCELLEME (API bypass'ta ekranı F5'siz tazele)
    // ======================
    // Content script consume sonrası cüzdan verisini gönderir; burada sayfanın
    // KENDİ knockout viewModel'i güncellenir (appViewModel sayfa scope'unda).
    // OSM'in video izleme akışının yaptığının aynısı:
    //   appViewModel.bossCoinWalletPartial().updateWallet(wallet)
    // Tutmazsa refreshBossCoinsWallet() ile sunucudan tazele (yedek).
    window.addEventListener("message", (e) => {
        if (!e.data || e.data.type !== "__OSM_UPDATE_WALLET") return;
        const wallet = e.data.wallet;

        try {
            if (typeof appViewModel !== "undefined" &&
                typeof appViewModel.bossCoinWalletPartial === "function") {
                const partial = appViewModel.bossCoinWalletPartial();
                if (partial && typeof partial.updateWallet === "function" && wallet) {
                    partial.updateWallet(wallet);
                    console.log("[OSM] Cüzdan göstergesi güncellendi (updateWallet).");
                    return;
                }
            }
        } catch (err) {
            console.warn("[OSM] updateWallet başarısız:", err.message);
        }

        // Yedek: sunucudan taze çek.
        try {
            if (typeof appViewModel !== "undefined" &&
                typeof appViewModel.refreshBossCoinsWallet === "function") {
                appViewModel.refreshBossCoinsWallet();
                console.log("[OSM] Cüzdan göstergesi güncellendi (refreshBossCoinsWallet).");
            }
        } catch (err) {
            console.warn("[OSM] refreshBossCoinsWallet başarısız:", err.message);
        }
    });

})();