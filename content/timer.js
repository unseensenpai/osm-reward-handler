// content/timer.js

const Timer = {

    interval: null,

    async start(minutes) {

        const targetTime = Date.now() + (minutes * 60 * 1000);

        await Storage.set({
            isBanned: true,
            targetTime
        });

        Logger.info(`${minutes} dakika bekleme başlatıldı.`);

        this.resume();
    },

    async forceStop() {

        await Storage.set({
            isBanned: false,
            targetTime: null
        });

        this.stop();

        Logger.info("Bekleme zorla sonlandırıldı.");
    },

    async resume() {

        const data = await Storage.get([
            "isBanned",
            "targetTime"
        ]);

        if (!data.isBanned || !data.targetTime)
            return;

        this.stop();

        // Bekleme sırasında "Tekrar Dene" butonunu göster
        if (UI.retryButton) {
            UI.retryButton.style.display = "block";
        }

        this.interval = setInterval(async () => {

            // Her saniye storage'dan taze targetTime oku
            const fresh = await Storage.get(["targetTime"]);

            if (!fresh.targetTime) {
                this.stop();
                return;
            }

            const remaining = fresh.targetTime - Date.now();

            if (remaining <= 0) {

                this.stop();

                Logger.success("Bekleme süresi sona erdi.");

                await Storage.set({
                    isBanned: false,
                    targetTime: null
                });

                UI.setStarted();
                UI.setStatus("statusRunning");
                UI.setCountdown("00:00:00");

                location.reload();

                return;

            }

            const formatted = this.format(remaining);

            UI.setCountdown(formatted);

        }, 1000);

    },

    stop() {

        if (this.interval) {

            clearInterval(this.interval);
            this.interval = null;

        }

    },

    format(ms) {

        const totalSeconds = Math.floor(ms / 1000);

        const hours = Math.floor(totalSeconds / 3600);

        const minutes = Math.floor((totalSeconds % 3600) / 60);

        const seconds = totalSeconds % 60;

        return [
            hours.toString().padStart(2, "0"),
            minutes.toString().padStart(2, "0"),
            seconds.toString().padStart(2, "0")
        ].join(":");

    }

};