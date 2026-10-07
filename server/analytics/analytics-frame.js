(() => {
  'use strict';
  const TITLES = Object.freeze({ '/': 'Plannix | Home', '/features': 'Plannix | Features', '/contact': 'Plannix | Contact' });
  const ADS_DENIED = Object.freeze({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  const appOrigin = document.querySelector('meta[name="plannix:app-origin"]')?.content;
  const configuredId = document.querySelector('meta[name="plannix:measurement-id"]')?.content;
  if (!/^https:\/\/[^/]+$/.test(appOrigin || '') || !/^G-[A-Z0-9]{8,20}$/.test(configuredId || '')
    || appOrigin === window.location.origin) return;
  let tagRequested = false;
  let loaded = false;
  let pending = null;
  let revoked = false;

  function validPage(value, origin) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'id,page_location,page_referrer,page_title,type'
      || value.type !== 'plannix:analytics-page'
      || value.id !== configuredId
      || typeof value.page_location !== 'string' || typeof value.page_title !== 'string'
      || typeof value.page_referrer !== 'string') return false;
    const url = new URL(value.page_location);
    const title = TITLES[url.pathname];
    if (!title || value.page_title !== title || value.page_location !== `${origin}${url.pathname}`) return false;
    return value.page_referrer === '' || Object.keys(TITLES).some(path => value.page_referrer === `${origin}${path}`);
  }

  function gtag() { window.dataLayer.push(arguments); }

  function sendPending() {
    if (revoked || !loaded || !pending) return;
    const page = pending;
    pending = null;
    gtag('set', { page_location: page.page_location, page_title: page.page_title, page_referrer: page.page_referrer });
    gtag('event', 'page_view', { send_to: configuredId, page_location: page.page_location,
      page_title: page.page_title, page_referrer: page.page_referrer });
  }

  function clearHostCookies() {
    try {
      const names = document.cookie.split(';').map(item => item.trim().split('=')[0])
        .filter(name => /^(_ga(?:_|$)|_gid$|_gat(?:_|$))/.test(name));
      for (const name of names) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      return !document.cookie.split(';').some(item => /^(_ga(?:_|$)|_gid$|_gat(?:_|$))/.test(item.trim().split('=')[0]));
    } catch { return false; }
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== appOrigin || !event.data
      || typeof event.data !== 'object' || Array.isArray(event.data)) return;
    if (event.data.type === 'plannix:analytics-cleanup') {
      if (Object.keys(event.data).sort().join(',') !== 'token,type'
        || !Number.isSafeInteger(event.data.token) || event.data.token < 1) return;
      revoked = true;
      pending = null;
      window.dataLayer = [];
      const cleared = clearHostCookies();
      window.parent.postMessage({ type: 'plannix:analytics-cleanup-done', token: event.data.token, cleared }, appOrigin);
      return;
    }
    if (revoked || event.data.type !== 'plannix:analytics-page') return;
    try { if (!validPage(event.data, appOrigin)) return; }
    catch { return; }
    pending = { page_location: event.data.page_location, page_title: event.data.page_title,
      page_referrer: event.data.page_referrer };
    if (tagRequested) { sendPending(); return; }
    tagRequested = true;
    window.dataLayer = [];
    gtag('consent', 'default', { ...ADS_DENIED, analytics_storage: 'denied' });
    gtag('consent', 'update', { ...ADS_DENIED, analytics_storage: 'granted' });
    gtag('set', { page_location: pending.page_location, page_title: pending.page_title,
      page_referrer: pending.page_referrer });
    gtag('set', 'cookie_domain', 'none');
    gtag('js', new Date());
    gtag('config', configuredId, { send_page_view: false, cookie_domain: 'none',
      allow_google_signals: false, allow_ad_personalization_signals: false });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${configuredId}`;
    script.onload = () => { loaded = true; sendPending(); };
    script.onerror = () => { pending = null; window.dataLayer = []; };
    document.head.appendChild(script);
  });
})();
