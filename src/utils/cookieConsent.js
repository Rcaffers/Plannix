export const OPEN_COOKIE_SETTINGS_EVENT = 'plannix:open-cookie-settings';
export const COOKIE_CONSENT_UPDATED_EVENT = 'plannix:cookie-consent';
export const CONSENT_STORAGE_KEY = 'plannix_cookie_consent_v2';
let sessionChoice = null;

export function readStoredConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return sessionChoice;
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2 && ['analytics', 'necessary_only'].includes(parsed.choice)) {
      return parsed;
    }
  } catch { return sessionChoice; }
  return sessionChoice;
}

export function writeConsent(choice) {
  if (!['analytics', 'necessary_only'].includes(choice)) return;
  const record = {
    version: 2,
    choice,
    updatedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record)); sessionChoice = null; }
  catch { sessionChoice = record; }
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_UPDATED_EVENT, { detail: record }));
}

export function subscribeConsent(listener) {
  const onLocal = event => listener(event.detail);
  const onStorage = event => {
    if (event.key === CONSENT_STORAGE_KEY || event.key === null) {
      sessionChoice = null;
      listener(readStoredConsent());
    }
  };
  window.addEventListener(COOKIE_CONSENT_UPDATED_EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(COOKIE_CONSENT_UPDATED_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

export function dispatchOpenCookieSettings() {
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_SETTINGS_EVENT));
}
