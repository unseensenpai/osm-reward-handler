// content/storage.js

const Storage = {

    async init() {

        const defaults = {
            botPaused: false,
            isBanned: false,
            targetTime: null,
            adsWatched: 0,
            totalAdsWatched: 0,
            automationStarted: false
        };

        let current = {};
        try {
            current = await this.get(Object.keys(defaults));
        } catch (e) {
            console.warn("[OSM] Storage.init get hatası:", e.message);
        }

        const missing = {};

        for (const key in defaults) {
            if (current[key] === undefined) {
                missing[key] = defaults[key];
            }
        }

        if (Object.keys(missing).length > 0) {
            try {
                await this.set(missing);
            } catch (e) {
                console.warn("[OSM] Storage.init set hatası:", e.message);
            }
        }

        Logger.success("Storage hazır.");
    },

    get(keys) {

        return new Promise(resolve => {

            try {
                chrome.storage.local.get(keys, result => {
                    try { resolve(result); } catch (e) {
                        console.warn("[OSM] Storage.get callback hatası:", e.message);
                        resolve({});
                    }
                });
            } catch (e) {
                console.warn("[OSM] Storage.get hatası:", e.message);
                const fallback = {};
                if (Array.isArray(keys)) {
                    keys.forEach(k => fallback[k] = undefined);
                }
                resolve(fallback);
            }

        });

    },

    set(values) {

        return new Promise(resolve => {

            try {
                chrome.storage.local.set(values, () => {
                    try { resolve(); } catch (e) {
                        console.warn("[OSM] Storage.set callback hatası:", e.message);
                        resolve();
                    }
                });
            } catch (e) {
                console.warn("[OSM] Storage.set hatası:", e.message);
                resolve();
            }

        });

    },

    remove(keys) {

        return new Promise(resolve => {

            try {
                chrome.storage.local.remove(keys, () => {
                    try { resolve(); } catch (e) {
                        console.warn("[OSM] Storage.remove callback hatası:", e.message);
                        resolve();
                    }
                });
            } catch (e) {
                console.warn("[OSM] Storage.remove hatası:", e.message);
                resolve();
            }

        });

    },

    clear() {

        return new Promise(resolve => {

            try {
                chrome.storage.local.clear(() => {
                    try { resolve(); } catch (e) {
                        console.warn("[OSM] Storage.clear callback hatası:", e.message);
                        resolve();
                    }
                });
            } catch (e) {
                console.warn("[OSM] Storage.clear hatası:", e.message);
                resolve();
            }

        });

    }

};