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
    // TOKEN TAZELİĞİ
    // ======================
    // Yakalanan JWT kısa ömürlü (nbf→exp = 1200sn / 20dk). Yakalama PASİF:
    // yalnızca sayfa kendi isteğini attığında güncelleniyor. Kullanıcı sekmede
    // işlem yapmayı bırakınca sayfa tokenRefresh çağırmıyor, token bayatlıyor
    // ve biz bayat token'ı sonsuza kadar gönderip her çağrıda 401 alıyoruz.
    // (55k satırlık log kanıtı: 11.000 satır boyunca tek token yakalama yok,
    // aynı aralıkta tek bir 200 de yok.)

    // JWT payload'ından exp'i (unix saniye) oku. Çözülemezse null.
    function tokenExp(jwt) {
        try {
            const part = String(jwt).split(".")[1];
            if (!part) return null;
            // base64url → base64
            const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
            const payload = JSON.parse(atob(b64));
            return typeof payload.exp === "number" ? payload.exp : null;
        } catch (e) {
            return null;
        }
    }

    // Token yok, süresi dolmuş ya da dolmasına SKEW_SECONDS'tan az kaldıysa
    // bayat sayılır. Erken davranmak 401'den iyidir.
    const SKEW_SECONDS = 60;

    function isTokenStale(jwt) {
        if (!jwt) return true;
        const exp = tokenExp(jwt);
        if (exp === null) return false;   // decode edilemiyorsa körlemesine atma
        return exp - SKEW_SECONDS <= Math.floor(Date.now() / 1000);
    }

    // Sayfanın KENDİ tokenRefresh akışını tetikle.
    //
    // Refresh token bizde değil, o yüzden tokenRefresh'i doğrudan çağıramayız.
    // Konsol kanıtı, OSM'in bunu nasıl yaptığını gösteriyor:
    //     e.refreshToken @ osm.js:31
    //     e.queueForAuthorization @ osm.js:34
    //     e.handleFailedHttpResponse @ osm.js:31
    // Yani refreshToken appViewModel'de DEĞİL, sayfanın HTTP katmanında ve
    // yalnızca sayfanın KENDİ isteklerinden biri 401 alınca otomatik çalışıyor.
    // Bizim çağrımız originalFetch ile o katmanı baypas ettiği için bu
    // mekanizma hiç tetiklenmiyordu (appViewModel.refreshToken aranıyordu,
    // orada olmadığı için 8sn boşuna beklenip pes ediliyordu).
    //
    // Çözüm: sayfanın kendi XHR katmanından zararsız bir istek attır. Bayat
    // token'la 401 alacak, OSM'in handleFailedHttpResponse'u devreye girip
    // tokenRefresh'i çalıştıracak ve yeni token bizim send hook'umuzdaki
    // captureBearer ile yakalanacak.
    function nudgeTokenRefresh() {
        // Önce viewModel'de dursa da kullan (sürüm değişirse diye).
        try {
            if (typeof appViewModel !== "undefined") {
                const direct = appViewModel.refreshToken ||
                               appViewModel.tokenRefresh ||
                               (appViewModel.session && appViewModel.session.refreshToken);
                if (typeof direct === "function") {
                    direct.call(appViewModel);
                    return true;
                }
            }
        } catch (e) {}

        // Asıl yol: sayfanın kendi XHR'ı ile hafif bir uca istek at.
        // XMLHttpRequest.prototype.send hook'u ve OSM'in kendi interceptor'ı
        // ikisi de bu istekte devrede olur.
        try {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", "https://web-api.onlinesoccermanager.com/api/v1/user/accounts", true);
            // OSM'in katmanı authorization'ı kendisi ekler; biz eklemeyiz ki
            // 401 gerçekten sayfanın akışından geçsin.
            xhr.send();
            return true;
        } catch (e) {}

        return false;
    }

    // Taze token bekle: sayfanın yeni bir istek atıp captureBearer'ı
    // tetiklemesini bekliyoruz. maxMs dolarsa elimizdekiyle devam edilir.
    async function waitForFreshToken(maxMs) {
        const deadline = Date.now() + maxMs;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 250));
            if (!isTokenStale(window.__OSM_TOKEN)) return true;
        }
        return false;
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

        // PROAKTİF: token'ın süresi dolmuşsa göndermeden önce tazelemeyi dene.
        // Bayat token'la istek atmak kesin 401; beklemek daha ucuz.
        if (isTokenStale(token)) {
            console.warn("[OSM] Token bayat, tazeleniyor...");
            nudgeTokenRefresh();
            await waitForFreshToken(5000);
            token = window.__OSM_TOKEN;
        }

        if (!token) {
            console.warn("[OSM] Bearer token yakalanmadı; API çağrısı atlanıyor.");
            return { ok: false, status: 401, text: null, error: "no_token" };
        }

        const isGet = String(method).toUpperCase() === "GET";

        const buildHeaders = (tok) => {
            const h = {
                "accept": "application/json; charset=utf-8",
                "appversion": "3.254.0",
                "platformid": "11",
                "authorization": "Bearer " + tok
            };
            // GET'te gövde ve content-type gönderilmez; bazı uçlar buna 400 döner.
            if (!isGet) {
                h["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
            }
            return h;
        };

        // Tek istek denemesi. CORS bloğu fetch'i exception'a çevirdiği için
        // 401 bazen status=0 olarak görünür (sunucu 401'de CORS header'ı
        // eklemeden reddediyor, tarayıcı "CORS engeli" diye raporluyor).
        // O yüzden status 0 da kimlik hatası adayı sayılır.
        const attempt = async (tok) => {
            try {
                // originalFetch: kendi hook'umuzu tetikleyip sahte
                // OSM_API_RESPONSE mesajı üretmesin diye ham fetch kullanılır.
                const response = await originalFetch(endpoint, {
                    method: isGet ? "GET" : method,
                    headers: buildHeaders(tok),
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
        };

        let result = await attempt(token);

        // REAKTİF: 401 (ya da CORS'a dönüşmüş hali) geldiyse elimizdeki token
        // ölmüş demektir. Onu ATIP tazelemeyi bekle ve BİR KEZ tekrar dene.
        // Eskiden bu yapılmadığı için bayat token sonsuza kadar gönderiliyor,
        // otomasyon "çalışıyor" görünürken hiç ödül alamıyordu.
        const looksAuthFailure = result.status === 401 || result.status === 0;

        if (looksAuthFailure && !result.__retried) {
            const dead = window.__OSM_TOKEN;
            console.warn("[OSM] " + result.status + " alındı; token geçersiz sayılıp yenileniyor.");

            // Bayat token'ı düşür ki captureBearer yenisini "yeni" görsün.
            window.__OSM_TOKEN = null;
            nudgeTokenRefresh();

            // Sayfanın yeni token'ı yakalanana kadar bekle. Gelmezse eskisini
            // geri koyup pes ederiz — token'sız kalmak durumu kötüleştirir.
            const deadline = Date.now() + 8000;
            let fresh = null;
            while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 250));
                if (window.__OSM_TOKEN && window.__OSM_TOKEN !== dead) {
                    fresh = window.__OSM_TOKEN;
                    break;
                }
            }

            if (fresh) {
                console.log("[OSM] Yeni token alındı, istek tekrarlanıyor.");
                result = await attempt(fresh);
                result.__retried = true;
            } else {
                window.__OSM_TOKEN = dead;   // yenisi gelmedi, eskisi kalsın
                console.warn("[OSM] Token yenilenemedi; sayfa etkin değil olabilir.");
            }
        }

        return result;
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

    // ======================
    // SAYFA GÖSTERGESİ TAZELEME (antrenman / scout / birikimler)
    // ======================
    // Cüzdanda işe yarayan yöntemin genel hali. BusinessClub'da ekranı
    // updateWallet tazeliyordu; antrenman süresi ve scout sayacı BAŞKA
    // partial'larda yaşıyor. Sayfa yenilemek yerine o partial'ın kendi
    // yükleme fonksiyonu çağrılır — F5 döngüyü öldürüyordu (v3.4.1 regresyonu).
    //
    // Partial adı sayfaya göre değiştiği için sabit isim yerine viewModel
    // üzerinde ARANIR: önce bilinen adaylar, sonra ada göre eşleşen ilk
    // fonksiyon. Bulunamazsa sessizce çıkar (çağıran yine de çalışmaya devam
    // eder; gösterge bir sonraki timers poll'unda tazelenir).
    const REFRESH_TARGETS = {
        training: [
            "trainingsPartial", "trainingPartial", "trainingSessionsPartial",
            "squadPartial"
        ],
        scout: [
            "scoutingPartial", "scoutPartial"
        ],
        multistep: [
            "rewardsPartial", "dailyRewardPartial", "bossCoinWalletPartial"
        ]
    };

    const RELOAD_FN = /^(reload|refresh|load|update|init|fetch|get)/;

    function refreshPartial(names) {
        if (typeof appViewModel === "undefined") return false;

        for (const name of names) {
            try {
                const holder = appViewModel[name];
                if (typeof holder !== "function") continue;

                // Knockout observable: çağırınca partial nesnesini döndürür.
                const partial = holder();
                if (!partial) continue;

                // Object.keys yalnızca KENDİ alanlarını verir; viewModel
                // fonksiyonları sık sık prototip üzerinde tanımlı oluyor.
                // Prototip zincirini de tara, tekrarları ele.
                const keys = new Set();
                for (let o = partial; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
                    Object.getOwnPropertyNames(o).forEach(k => keys.add(k));
                }

                for (const key of keys) {
                    if (!RELOAD_FN.test(key)) continue;

                    // Alan okumak getter tetikleyebilir ve o getter atabilir;
                    // tek bir anahtar yüzünden aday partial'ı kaybetmeyelim.
                    let fn;
                    try {
                        fn = partial[key];
                    } catch (err) { continue; }

                    if (typeof fn !== "function") continue;
                    // Argüman bekleyen fonksiyonu çağırmayız: veriyi biz
                    // bilmiyoruz, yanlış argüman ekranı bozabilir.
                    if (fn.length > 0) continue;

                    try {
                        fn.call(partial);
                    } catch (err) { continue; }

                    console.log(`[OSM] Gösterge tazelendi: ${name}.${key}()`);
                    return true;
                }
            } catch (err) {
                // Bu aday tutmadı, sıradakine geç.
            }
        }
        return false;
    }

    window.addEventListener("message", (e) => {
        if (!e.data || e.data.type !== "__OSM_REFRESH_VIEW") return;

        const names = REFRESH_TARGETS[e.data.target] || [];
        if (refreshPartial(names)) return;

        // Hedefe özel partial bulunamadı: sayfanın genel tazeleyicisini dene.
        try {
            for (const key of ["refreshPage", "reload", "refresh", "loadData"]) {
                if (typeof appViewModel[key] === "function" &&
                    appViewModel[key].length === 0) {
                    appViewModel[key]();
                    console.log(`[OSM] Gösterge tazelendi: appViewModel.${key}()`);
                    return;
                }
            }
        } catch (err) {}

        console.log(`[OSM] ${e.data.target} için tazeleme fonksiyonu bulunamadı.`);
    });

})();