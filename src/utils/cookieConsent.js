export const OPEN_COOKIE_SETTINGS_EVENT = 'plannix:open-cookie-settings';

const COOKIE_CONSENT_UPDATED_EVENT = 'plannix:cookie-consent';

const CONSENT_STORAGE_KEY = 'plannix_cookie_consent_v1';

export function readStoredConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'number') {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeConsent(choice) {
  const record = {
    version: 1,
    choice,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_UPDATED_EVENT, { detail: record }));
}

export function dispatchOpenCookieSettings() {
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_SETTINGS_EVENT));
}
