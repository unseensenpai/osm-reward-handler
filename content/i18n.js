const ContentI18N = (() => {
  let messages = {};
  let currentLang = 'en';
  const SUPPORTED = ['en', 'tr'];
  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;

    const data = await chrome.storage.local.get(['uiLang']);
    currentLang = data.uiLang && SUPPORTED.includes(data.uiLang) ? data.uiLang : 'tr';
    await loadLang(currentLang);
    startWatching();
  }

  async function loadLang(lang) {
    currentLang = lang;
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    try {
      const res = await fetch(url);
      messages = await res.json();
    } catch (e) {
      messages = {};
    }
  }

  function startWatching() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.uiLang) {
        const newLang = changes.uiLang.newValue;
        if (SUPPORTED.includes(newLang) && newLang !== currentLang) {
          loadLang(newLang).then(() => {
            document.dispatchEvent(new CustomEvent('contentI18n:changed'));
          });
        }
      }
    });
  }

  function t(key) {
    return (messages[key] && messages[key].message) || key;
  }

  function tVar(key, vars) {
    let msg = t(key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        msg = msg.replace(`\${${k}}`, v);
      }
    }
    return msg;
  }

  function getLang() {
    return currentLang;
  }

  return { init, t, tVar, getLang };
})();
