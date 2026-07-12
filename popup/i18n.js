// Simple i18n manager for the popup.
// Loads messages from _locales/<lang>/messages.json and applies them
// to any element with a data-i18n attribute. Also exposes helpers
// so popup.js can fetch translated strings for dynamic content.

const I18N = (() => {
  const SUPPORTED = ['en', 'tr'];
  const DEFAULT_LANG = 'tr';
  let currentLang = DEFAULT_LANG;
  let messages = {};
  let _readyResolve;
  const ready = new Promise(resolve => { _readyResolve = resolve; });

  function detectBrowserLang() {
    const lang = (navigator.language || 'tr').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
  }

  function loadMessages(lang) {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    return fetch(url)
      .then((res) => res.json())
      .catch(() => ({}));
  }

  function t(key) {
    return (messages[key] && messages[key].message) || key;
  }

  function applyToDom() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.documentElement.lang = currentLang;

    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`lang-${currentLang}`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return Promise.resolve();
    currentLang = lang;
    return loadMessages(lang).then((data) => {
      messages = data;
      applyToDom();
      chrome.storage.local.set({ uiLang: lang });
      document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
    });
  }

  function init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['uiLang'], (data) => {
        const lang = data.uiLang && SUPPORTED.includes(data.uiLang)
          ? data.uiLang
          : detectBrowserLang();
        setLang(lang).then(() => {
          _readyResolve();
          resolve();
        });
      });
    });
  }

  function getLang() {
    return currentLang;
  }

  return { init, setLang, getLang, t, applyToDom, ready };
})();

document.addEventListener('DOMContentLoaded', () => {
  I18N.init().then(() => {
    const trBtn = document.getElementById('lang-tr');
    const enBtn = document.getElementById('lang-en');
    if (trBtn) trBtn.addEventListener('click', () => I18N.setLang('tr'));
    if (enBtn) enBtn.addEventListener('click', () => I18N.setLang('en'));
  });
});
