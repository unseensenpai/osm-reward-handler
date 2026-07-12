// iframe/iframe-handler.js

const IframeHandler = {

    interval: null,

    selectors: [

        "#aiptag-close",
        ".aiptag-close",

        ".skip-btn",
        ".skip-button",
        ".skip",

        ".video-close",
        ".close-ad",
        ".close-button",

        "[aria-label='Close']",
        "[aria-label='Skip']",

        "[id*='close']",
        "[class*='close']"

    ],

    start() {

        if (window.top === window.self)
            return;

        Logger.info("Reklam iframe'i tespit edildi.");

        this.interval = setInterval(() => {

            this.check();

        }, 1000);

    },

    stop() {

        if (!this.interval)
            return;

        clearInterval(this.interval);

        this.interval = null;

    },

    check() {

        for (const selector of this.selectors) {

            const button = document.querySelector(selector);

            if (!button)
                continue;

            if (button.offsetParent === null)
                continue;

            Logger.success("Reklam kapatma butonu bulundu.");

            button.click();

            this.stop();

            return;

        }

    }

};