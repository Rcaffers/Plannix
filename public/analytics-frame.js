(() => {
  'use strict';
  const TITLES = Object.freeze({ '/': 'Plannix | Home', '/features': 'Plannix | Features', '/contact': 'Plannix | Contact' });
  const ADS_DENIED = Object.freeze({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  let configuredId = null;
  let loaded = false;
  let pending = null;

  function validPage(value, origin) {
    if (!value || typeof value !== 'object' || !/^G-[A-Z0-9]{8,20}$/.test(value.id || '')) return false;
    const url = new URL(value.page_location);
    const title = TITLES[url.pathname];
    if (!title || value.page_title !== title || value.page_location !== `${origin}${url.pathname}`) return false;
    return value.page_referrer === '' || Object.keys(TITLES).some(path => value.page_referrer === `${origin}${path}`);
  }

  function gtag() { window.dataLayer.push(arguments); }

  function sendPending() {
    if (!loaded || !pending) return;
    const page = pending;
    pending = null;
    gtag('set', { page_location: page.page_location, page_title: page.page_title, page_referrer: page.page_referrer });
    gtag('event', 'page_view', { send_to: configuredId, page_location: page.page_location,
      page_title: page.page_title, page_referrer: page.page_referrer });
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'plannix:analytics-page') return;
    // The sender's origin is the only accepted URL origin. The opaque frame cannot read its parent.
    if (event.origin === 'null' || !/^https?:\/\/[^/]+$/.test(event.origin)) return;
    try { if (!validPage(event.data, event.origin)) return; }
    catch { return; }
    if (configuredId && configuredId !== event.data.id) return;
    pending = { page_location: event.data.page_location, page_title: event.data.page_title,
      page_referrer: event.data.page_referrer };
    if (configuredId) { sendPending(); return; }
    configuredId = event.data.id;
    window.dataLayer = [];
    gtag('consent', 'default', { ...ADS_DENIED, analytics_storage: 'denied' });
    gtag('consent', 'update', { ...ADS_DENIED, analytics_storage: 'granted' });
    gtag('set', { page_location: pending.page_location, page_title: pending.page_title,
      page_referrer: pending.page_referrer });
    gtag('js', new Date());
    gtag('config', configuredId, { send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${configuredId}`;
    script.onload = () => { loaded = true; sendPending(); };
    script.onerror = () => { pending = null; window.dataLayer = []; };
    document.head.appendChild(script);
  });
})();
