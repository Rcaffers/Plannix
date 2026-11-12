/* Push-only worker. Detail display remains inert until both an explicit device
   selector and the server's default-off activation gate are present. */
const DETAIL_LOCK = 'plannix-push-device';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION = /^__Host-plannix-s-[1-9]\d{0,15}$/;
// Require the absolute end; a JavaScript $ anchor also matches before a final newline.
const PERIOD_LABEL = /^P[1-9]\d*(?![\s\S])/;
// Bound each label so later periods remain present instead of truncating the
// joined body before P5. The OS may still visually clip its notification.
const MAX_DISPLAY_PERIODS = 5;
const MAX_CLASS_CHARS = 32;
const MAX_LESSON_TITLE_CHARS = 32;
const MAX_EVENT_TITLE_CHARS = 48;
const DETAIL_DEADLINE_MS = 4000;
const LOCK_PROBE_LIMIT_MS = 5000;
let selectorQueue = Promise.resolve();
let lockProbeActive = false;

function openSelectorDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('plannix-push-detail-selector', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('storage unavailable'));
  });
}

async function selectorTransaction(change) {
  const db = await openSelectorDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', change ? 'readwrite' : 'readonly');
      const store = tx.objectStore('state');
      const request = store.get('current');
      let answer;
      request.onsuccess = () => {
        const previous = request.result || { epoch: 0, selector: null };
        try {
          if (!Number.isSafeInteger(previous.epoch) || previous.epoch < 0
            || previous.epoch === Number.MAX_SAFE_INTEGER) throw new Error('storage unavailable');
          answer = change ? change(previous) : previous;
          if (change && answer?.next) store.put(answer.next, 'current');
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve(change ? answer?.result : answer);
      tx.onabort = () => reject(new Error('storage unavailable'));
      tx.onerror = () => reject(new Error('storage unavailable'));
    });
  } finally { db.close(); }
}

function validSelector(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'installationVersion,policyVersion,sessionName'
    && SESSION.test(value.sessionName) && UUID.test(value.installationVersion)
    && UUID.test(value.policyVersion);
}

async function selectorMessage(message) {
  if (!message || typeof message !== 'object' || !Number.isSafeInteger(message.expectedEpoch))
    return { ok: false };
  if (message.kind === 'observe') {
    const current = await selectorTransaction();
    return { ok: true, epoch: current.epoch, selector: current.selector };
  }
  if (message.kind === 'invalidate') {
    return selectorTransaction(previous => ({ next: { epoch: previous.epoch + 1, selector: null },
      result: { ok: true, epoch: previous.epoch + 1 } }));
  }
  if (message.kind === 'commit' && validSelector(message.selector)) {
    return selectorTransaction(previous => previous.epoch === message.expectedEpoch
      ? { next: { epoch: previous.epoch + 1, selector: message.selector },
        result: { ok: true, epoch: previous.epoch + 1 } }
      : { result: { ok: false } });
  }
  return { ok: false };
}

async function runLockProbe(port) {
  const send = phase => {
    try { port.postMessage({ phase }); return true; } catch { return false; }
  };
  if (lockProbeActive) { send('inconclusive'); try { port.close(); } catch {} return; }
  lockProbeActive = true;
  const controller = new AbortController();
  let releaseHold;
  const released = new Promise(resolve => { releaseHold = resolve; });
  let finished = false;
  let timer;
  try {
    port.onmessage = message => {
      if (message.data?.phase === 'release') releaseHold();
    };
    port.onmessageerror = () => releaseHold();
    port.start?.();
    const expired = new Promise(resolve => {
      timer = setTimeout(() => {
        finished = true;
        controller.abort();
        releaseHold();
        resolve('expired');
      }, LOCK_PROBE_LIMIT_MS);
    });
    if (typeof self.navigator?.locks?.request !== 'function') {
      send('inconclusive');
      return;
    }
    if (!send('queued')) return;
    const request = Promise.resolve(self.navigator.locks.request(DETAIL_LOCK,
      { mode: 'exclusive', signal: controller.signal }, async lock => {
        if (!lock || finished || controller.signal.aborted) return;
        if (!send('entered')) { releaseHold(); return; }
        await released;
      }));
    // A timed-out request may settle later. Observe it without reopening the port.
    const outcome = await Promise.race([request.then(() => 'released', () => 'failed'), expired]);
    if (!finished) send(outcome === 'released' ? 'released' : 'inconclusive');
  } catch { if (!finished) send('inconclusive'); }
  finally {
    finished = true;
    clearTimeout(timer);
    controller.abort();
    releaseHold();
    port.onmessage = null;
    port.onmessageerror = null;
    try { port.close(); } catch {}
    lockProbeActive = false;
  }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'plannix-worker-lock-probe' && event.data.version === 1) {
    try {
      const port = event.ports?.length === 1 ? event.ports[0] : null;
      if (!port || typeof port.postMessage !== 'function' || typeof event.waitUntil !== 'function'
        || event.source?.type !== 'window'
        || new URL(event.source.url).origin !== self.location.origin) return;
      event.waitUntil(runLockProbe(port));
    } catch { /* An unavailable probe cannot affect notification handling. */ }
    return;
  }
  if (event.data?.type === 'plannix-worker-capabilities' && event.data.version === 1) {
    // This diagnostic has no authorization role. The browser supplies the
    // source Client; never accept an origin claimed in message data.
    try {
      const port = event.ports?.length === 1 ? event.ports[0] : null;
      if (!port || typeof port.postMessage !== 'function'
        || event.source?.type !== 'window'
        || new URL(event.source.url).origin !== self.location.origin) return;
      port.postMessage({
        webLocks: typeof self.navigator?.locks?.request === 'function',
        indexedDB: typeof self.indexedDB?.open === 'function',
        cryptoSubtle: typeof self.crypto?.subtle?.digest === 'function',
        pushSubscriptionAccess: typeof self.registration?.pushManager?.getSubscription === 'function',
      });
    } catch { /* A failed diagnostic leaves capabilities unverified. */ }
    return;
  }
  if (event.data?.type !== 'plannix-detail-selector' || !event.ports?.[0]) return;
  const port = event.ports[0];
  // Serialize messages from tabs in this worker; IndexedDB also enforces CAS
  // across worker restarts. A failed write never promotes stale selectors.
  const work = selectorQueue.then(() => selectorMessage(event.data));
  selectorQueue = work.catch(() => {});
  event.waitUntil?.(work.then(result => port.postMessage(result), () => port.postMessage({ ok:false })));
});

function deadline(work, milliseconds, controller) {
  let timer;
  return Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('detail deadline'));
    }, milliseconds);
  })]).finally(() => clearTimeout(timer));
}

async function smallJson(response, maxBytes = 8192) {
  if (!response.ok) throw new Error('detail unavailable');
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('detail unavailable');
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { void reader.cancel().catch(() => {}); throw new Error('detail unavailable'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function notificationText(detail) {
  if (!detail || !Array.isArray(detail.lessons) || !Array.isArray(detail.events)
    || typeof detail.lessonDetailsIncluded !== 'boolean'
    || typeof detail.eventTitlesIncluded !== 'boolean'
    || (!detail.lessonDetailsIncluded && detail.lessons.length)) throw new Error('detail unavailable');
  const short = (value, limit) => Array.from(value.trim().replace(/\s+/g, ' ')).slice(0, limit).join('');
  const parts = detail.lessons.slice(0, MAX_DISPLAY_PERIODS).map(item => {
    if (!item || typeof item.period !== 'string' || !PERIOD_LABEL.test(item.period)
      || item.period.length > 4 || typeof item.title !== 'string' || typeof item.isPpa !== 'boolean')
      throw new Error('detail unavailable');
    if (item.isPpa) {
      if (item.className !== null || item.title !== '') throw new Error('detail unavailable');
      return `${item.period}: PPA`;
    }
    if (typeof item.className !== 'string' || !item.className.trim())
      throw new Error('detail unavailable');
    const title = short(item.title, MAX_LESSON_TITLE_CHARS);
    return `${item.period}: ${short(item.className, MAX_CLASS_CHARS)}${title ? ` — ${title}` : ''}`;
  });
  if (detail.eventTitlesIncluded) {
    for (const event of detail.events.slice(0, 2)) {
      if (typeof event?.title !== 'string' || !event.title.trim()) throw new Error('detail unavailable');
      parts.push(short(event.title, MAX_EVENT_TITLE_CHARS));
    }
  } else if (detail.events.length) throw new Error('detail unavailable');
  if (!parts.length) throw new Error('detail unavailable');
  return parts.join('\n');
}

async function showMorning(payload) {
  const generic = () => self.registration.showNotification(payload.title, {
    body: payload.body, tag: 'plannix-morning-summary',
    data: { type: 'morning', notificationRef: payload.notificationRef },
  });
  let displayStarted = false;
  const controller = new AbortController();
  try {
    const stored = await deadline(() => selectorTransaction(), 1000, controller);
    const selector = stored.selector;
    if (!validSelector(selector) || typeof self.navigator?.locks?.request !== 'function'
      || !self.crypto?.subtle || !self.registration.pushManager?.getSubscription) throw new Error('detail unavailable');
    await deadline(() => self.navigator.locks.request(DETAIL_LOCK,
      { mode: 'exclusive', signal: controller.signal }, async lock => {
        if (!lock || controller.signal.aborted) throw new Error('detail unavailable');
        const current = await selectorTransaction();
        if (current.epoch !== stored.epoch || !validSelector(current.selector))
          throw new Error('detail unavailable');
        const subscription = await self.registration.pushManager.getSubscription();
        if (!subscription?.endpoint) throw new Error('detail unavailable');
        const bytes = new TextEncoder().encode(subscription.endpoint);
        const hash = [...new Uint8Array(await self.crypto.subtle.digest('SHA-256', bytes))]
          .map(byte => byte.toString(16).padStart(2, '0')).join('');
        const request = (path, headers = {}) => self.fetch(new URL(path, self.location.origin), {
          method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          signal: controller.signal, headers,
        });
        const config = await smallJson(await request('/api/notifications/morning-summary/detail-display-config',
          { 'X-Plannix-Expected-Session': selector.sessionName }));
        if (config?.enabled !== true) throw new Error('detail unavailable');
        const status = await smallJson(await request('/__stage3/auth/status'));
        if (status?.authenticated !== true || status?.recovery === true
          || status.sessionName !== selector.sessionName) throw new Error('detail unavailable');
        const detail = await smallJson(await request('/api/notifications/morning-summary/detail', {
          'X-Plannix-Expected-Session': selector.sessionName,
          'X-Plannix-Notification-Reference': payload.notificationRef,
          'X-Plannix-Installation-Hash': hash,
          'X-Plannix-Installation-Version': selector.installationVersion,
          'X-Plannix-Detail-Policy-Version': selector.policyVersion,
        }), 16384);
        const body = notificationText(detail);
        const latest = await selectorTransaction();
        if (controller.signal.aborted || latest.epoch !== stored.epoch)
          throw new Error('detail unavailable');
        displayStarted = true;
        // After this call starts, failure or timeout is uncertain. A second
        // generic display could duplicate an OS notification.
        await deadline(() => self.registration.showNotification(payload.title, {
          body, tag: 'plannix-morning-summary',
          data: { type: 'morning', notificationRef: payload.notificationRef },
        }), 1000);
      }), DETAIL_DEADLINE_MS, controller);
  } catch {
    if (!displayStarted) await generic();
  }
}

self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  if (Object.keys(payload).sort().join(',') === 'type,version'
    && payload.type === 'plannix-test' && payload.version === 1) {
    event.waitUntil(self.registration.showNotification('Plannix test notification', {
      body: 'Notifications are enabled on this device.', tag: 'plannix-test', data: { type: 'test' },
    }));
    return;
  }
  if (Object.keys(payload).sort().join(',') !== 'body,notificationRef,title,type,version'
    || payload.type !== 'plannix-morning-summary' || payload.version !== 1
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.notificationRef)
    || payload.title !== 'Your Plannix day'
    || payload.body !== 'Open Plannix to view your morning summary.') return;
  event.waitUntil(showMorning(payload));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const destination = new URL('/settings/notifications', self.location.origin);
  if (data?.type === 'morning'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.notificationRef)) {
    destination.searchParams.set('summaryRef', data.notificationRef);
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => {
      try { return new URL(client.url).origin === destination.origin; } catch { return false; }
    });
    if (existing) {
      try {
        const windowClient = await existing.navigate(destination.href);
        if (windowClient) { await windowClient.focus(); return; }
      } catch { /* Open a new same-origin page if this tab cannot navigate. */ }
    }
    await self.clients.openWindow(destination.href);
  })());
});
