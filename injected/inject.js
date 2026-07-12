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
        return open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try {
            if (name && name.toLowerCase() === "authorization") captureBearer(value);
        } catch (e) {}
        return setRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
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

    // ======================
    // API HELPER
    // ======================

    async function osmApiCall(endpoint, body) {
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

        const headers = {
            "accept": "application/json; charset=utf-8",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "appversion": "3.253.0",
            "platformid": "11",
            "authorization": "Bearer " + token
        };

        try {
            // originalFetch: kendi hook'umuzu tetikleyip sahte OSM_API_RESPONSE
            // mesajı üretmesin diye ham fetch kullanılır.
            const response = await originalFetch(endpoint, {
                method: "POST",
                headers: headers,
                body: body,
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
            const { endpoint, body, id } = e.data;
            if (!endpoint) return;

            const result = await osmApiCall(endpoint, body);
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