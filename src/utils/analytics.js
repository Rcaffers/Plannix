import { validMeasurementId } from '../../shared/gaMeasurementId.js';
import { parseAnalyticsFrameOrigin } from '../../shared/analyticsOrigin.js';

const PUBLIC_PAGES = Object.freeze({
  '/': 'Plannix | Home',
  '/features': 'Plannix | Features',
  '/contact': 'Plannix | Contact',
});

export { validMeasurementId };

export function publicPage(pathname, origin) {
  if (!Object.hasOwn(PUBLIC_PAGES, pathname)) return null;
  return { pathname, title: PUBLIC_PAGES[pathname], url: `${origin}${pathname}` };
}

export function publicReferrer(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin ? publicPage(url.pathname, origin)?.url || '' : '';
  } catch { return ''; }
}

export function clearAnalyticsCookies(doc, hostname, pathname = '/') {
  let names;
  try {
    names = doc.cookie.split(';').map(item => item.trim().split('=')[0])
      .filter(name => /^(_ga(?:_|$)|_gid$|_gat(?:_|$))/.test(name));
  } catch { return; }
  const labels = hostname.split('.');
  const domains = ['', ...labels.map((_, index) => labels.slice(index).join('.') )];
  const parts = pathname.split('/').filter(Boolean);
  const paths = ['/', ...parts.map((_, index) => `/${parts.slice(0, index + 1).join('/')}`)];
  for (const name of names) for (const domain of domains) for (const path of paths) {
    try { doc.cookie = `${name}=; Max-Age=0; Path=${path}; SameSite=Lax${domain ? `; Domain=${domain}` : ''}`; }
    catch { /* Cookie settings can be unavailable; analytics must remain optional. */ }
  }
}

export function createAnalyticsController({ measurementId, frameOrigin, win, doc, cleanupTimeoutMs = 500 }) {
  const id = validMeasurementId(measurementId);
  const origin = win && parseAnalyticsFrameOrigin(frameOrigin, win.location.origin);
  let frame = null;
  let frameReady = false;
  let generation = 0;
  let lastPath = null;
  let lastUrl = null;
  let pending = null;
  let lastChoice;
  let desired;
  let cleanup = null;

  function destroy() {
    generation += 1;
    pending = null;
    frameReady = false;
    lastPath = null;
    lastUrl = null;
    if (frame) {
      frame.onload = null;
      frame.onerror = null;
      frame.remove();
      frame = null;
    }
  }

  function deliver() {
    if (!frame || !frameReady || !pending) return;
    const message = pending;
    pending = null;
    try { frame.contentWindow?.postMessage(message, origin); }
    catch { destroy(); }
  }

  function finishCleanup(ticket) {
    if (!cleanup || cleanup.ticket !== ticket) return;
    clearTimeout(cleanup.timer);
    win.removeEventListener?.('message', cleanup.listener);
    cleanup = null;
    destroy();
    if (desired?.choice === 'analytics') update(desired);
  }

  function startCleanup() {
    if (!origin || cleanup) return;
    const current = frame || doc.createElement('iframe');
    const ticket = ++generation;
    const sendCleanup = () => {
      if (cleanup?.ticket !== ticket) return;
      try { current.contentWindow?.postMessage({ type: 'plannix:analytics-cleanup', token: ticket }, origin); }
      catch { finishCleanup(ticket); }
    };
    const listener = event => {
      if (cleanup?.ticket !== ticket || event.source !== current.contentWindow || event.origin !== origin
        || event.data?.type !== 'plannix:analytics-cleanup-done' || event.data.token !== ticket
        || typeof event.data.cleared !== 'boolean') return;
      finishCleanup(ticket);
    };
    if (!frame) {
      current.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      current.setAttribute('aria-hidden', 'true');
      current.setAttribute('tabindex', '-1');
      current.referrerPolicy = 'no-referrer';
      current.style.display = 'none';
      current.src = `${origin}/analytics-frame.html#cleanup`;
      frame = current;
      frameReady = false;
      try { doc.body.appendChild(current); }
      catch { destroy(); return; }
    }
    current.onload = () => { if (frame === current && cleanup?.ticket === ticket) sendCleanup(); };
    current.onerror = () => finishCleanup(ticket);
    cleanup = { ticket, listener, timer: setTimeout(() => finishCleanup(ticket), cleanupTimeoutMs) };
    win.addEventListener?.('message', listener);
    if (frameReady) sendCleanup();
  }

  function update({ choice, pathname, hasParameters = false, authenticated, authLoading }) {
    desired = { choice, pathname, hasParameters, authenticated, authLoading };
    const page = !authenticated && !authLoading && !hasParameters && choice === 'analytics' && id && origin
      ? publicPage(pathname, win.location.origin) : null;
    if (!page) {
      if (choice !== 'analytics' && lastChoice === 'analytics') startCleanup();
      else if (!cleanup) destroy();
      if (choice !== 'analytics') clearAnalyticsCookies(doc, win.location.hostname, win.location.pathname);
      lastChoice = choice;
      return;
    }
    lastChoice = choice;
    if (cleanup) return;
    if (lastPath === pathname) return;
    const referrer = lastUrl || publicReferrer(doc.referrer, win.location.origin);
    pending = { type: 'plannix:analytics-page', id, page_location: page.url,
      page_title: page.title, page_referrer: referrer };
    lastPath = pathname;
    lastUrl = page.url;
    if (!frame) {
      const current = doc.createElement('iframe');
      current.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      current.setAttribute('aria-hidden', 'true');
      current.setAttribute('tabindex', '-1');
      current.referrerPolicy = 'no-referrer';
      current.style.display = 'none';
      current.src = `${origin}/analytics-frame.html`;
      const ticket = ++generation;
      current.onload = () => {
        if (frame !== current || ticket !== generation) return;
        frameReady = true;
        deliver();
      };
      current.onerror = () => {
        if (frame === current && ticket === generation) destroy();
      };
      frame = current;
      try { doc.body.appendChild(current); }
      catch { destroy(); }
    } else deliver();
  }

  return { update };
}

export const analyticsController = createAnalyticsController({
  measurementId: import.meta.env?.VITE_GA_MEASUREMENT_ID,
  frameOrigin: import.meta.env?.VITE_ANALYTICS_FRAME_ORIGIN,
  win: typeof window === 'undefined' ? null : window,
  doc: typeof document === 'undefined' ? null : document,
});
