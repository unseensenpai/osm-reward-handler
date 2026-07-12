function updateUI() {
    chrome.storage.local.get(['isBanned', 'targetTime', 'botPaused', 'totalAdsWatched'], (data) => {
        const statusEl = document.getElementById('status');
        const timerEl = document.getElementById('timer');
        const totalEl = document.getElementById('total-ads');

        if (totalEl) {
            totalEl.textContent = data.totalAdsWatched || 0;
        }

        if (data.botPaused) {
            statusEl.textContent = I18N.t('statusPaused');
            statusEl.className = 'status warning';
            timerEl.textContent = '--:--:--';
            return;
        }

        if (data.isBanned && data.targetTime) {
            statusEl.textContent = I18N.t('statusWaiting');
            statusEl.className = 'status warning';

            if (window._countdownInterval) clearInterval(window._countdownInterval);

            window._countdownInterval = setInterval(() => {
                chrome.storage.local.get(['targetTime'], (fresh) => {
                    const remaining = fresh.targetTime - Date.now();

                    if (remaining <= 0) {
                        clearInterval(window._countdownInterval);
                        timerEl.textContent = '00:00:00';
                        statusEl.textContent = I18N.t('statusExpired');
                        statusEl.className = 'status ready';
                    } else {
                        const hours = Math.floor(remaining / (1000 * 60 * 60));
                        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
                        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
                        timerEl.textContent =
                            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    }
                });
            }, 1000);

        } else {
            statusEl.textContent = I18N.t('statusRunning');
            statusEl.className = 'status ready';
            timerEl.textContent = I18N.t('statusNoIssue');
        }
    });
}

async function initPopup() {
    await I18N.ready;
    updateUI();
    document.addEventListener('i18n:changed', updateUI);
}

document.addEventListener('DOMContentLoaded', initPopup);
