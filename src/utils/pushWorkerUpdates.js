import { DEVICE_LOCK_NAME } from './pushDeviceLock.js';

const UPDATE_WAIT_MS = 6000;
const CHECK_INTERVAL_MS = 60_000;

function pushScript(worker, browser) {
  try { const url = new URL(worker?.scriptURL);
    return url.pathname === '/push-sw.js' && url.origin === browser.location.origin; }
  catch { return false; }
}

function pushRegistration(registration, browser) {
  return pushScript(registration?.active, browser);
}

export function observePushWorkerUpdates({ onWaiting, onActivated }, browser = globalThis) {
  const container = browser.navigator?.serviceWorker;
  if (!container?.getRegistration) return () => {};
  let closed = false;
  let registration;
  let installing;
  let observedWaiting;
  let active;
  let lastCheck = 0;
  const report = () => {
    if (closed || !registration) return;
    if (observedWaiting !== registration.waiting) {
      observedWaiting?.removeEventListener?.('statechange', changed);
      observedWaiting = registration.waiting;
      observedWaiting?.addEventListener?.('statechange', changed);
    }
    if (registration.active && active && registration.active !== active) onActivated?.(registration.active);
    active = registration.active;
    onWaiting?.(registration.waiting && registration.active
      && pushScript(registration.waiting, browser) ? registration.waiting : null);
  };
  const changed = () => report();
  const found = () => {
    installing?.removeEventListener?.('statechange', changed);
    installing = registration?.installing;
    installing?.addEventListener?.('statechange', changed);
    report();
  };
  const check = () => {
    if (closed || !registration) return;
    report();
    if (browser.document?.visibilityState === 'hidden' || registration.waiting) return;
    const now = Date.now();
    if (now - lastCheck < CHECK_INTERVAL_MS) return;
    lastCheck = now;
    void Promise.resolve().then(() => registration.update?.()).catch(() => {});
  };
  void container.getRegistration('/').then(foundRegistration => {
    if (closed || !pushRegistration(foundRegistration, browser)) return;
    registration = foundRegistration;
    registration.addEventListener?.('updatefound', found);
    container.addEventListener?.('controllerchange', changed);
    browser.document?.addEventListener?.('visibilitychange', check);
    found();
    check();
  }).catch(() => {});
  return () => {
    closed = true;
    registration?.removeEventListener?.('updatefound', found);
    installing?.removeEventListener?.('statechange', changed);
    observedWaiting?.removeEventListener?.('statechange', changed);
    container.removeEventListener?.('controllerchange', changed);
    browser.document?.removeEventListener?.('visibilitychange', check);
  };
}

export async function activateWaitingPushWorker(worker, browser = globalThis) {
  const container = browser.navigator?.serviceWorker;
  const locks = browser.navigator?.locks;
  if (!container?.getRegistration || typeof locks?.request !== 'function'
    || typeof browser.MessageChannel !== 'function') throw new Error('Update coordination is unavailable. Try again later.');
  const registration = await container.getRegistration('/');
  if (!pushRegistration(registration, browser) || !pushScript(worker, browser)
    || registration.waiting !== worker)
    throw new Error('This update has changed. Check again.');
  const controller = new AbortController();
  let timeout;
  let closed = false;
  let messageSent = false;
  let cancelMessage;
  let stopWatching;
  const activated = new Promise(resolve => {
    const changed = () => { if (worker.state === 'activated') resolve(true); };
    worker.addEventListener?.('statechange', changed);
    stopWatching = () => worker.removeEventListener?.('statechange', changed);
    changed();
  });
  try {
    const result = await Promise.race([
      locks.request(DEVICE_LOCK_NAME, { mode:'exclusive', signal:controller.signal }, async lock => {
        if (!lock || closed) throw new Error('Update coordination is unavailable.');
        if (registration.waiting !== worker) throw new Error('This update has changed. Check again.');
        return new Promise((resolve, reject) => {
          const channel = new browser.MessageChannel();
          let finished = false;
          const finish = (error) => {
            if (finished) return;
            finished = true;
            channel.port1.onmessage = null;
            try { channel.port1.close(); } catch { /* Port cleanup cannot retain the lock. */ }
            cancelMessage = null;
            if (error) reject(error); else resolve();
          };
          cancelMessage = () => finish(new Error('The update result is unconfirmed. Check device readiness before trying again.'));
          channel.port1.onmessage = event => {
            finish(event.data?.accepted === true ? null : new Error('The worker did not accept this update.'));
          };
          try {
            worker.postMessage({ type:'plannix-activate-push-update', version:1 }, [channel.port2]);
            messageSent = true;
          } catch { finish(new Error('Could not request the worker update.')); }
        });
      }).then(() => activated),
      new Promise((_, reject) => { timeout = browser.setTimeout(() => {
        closed = true;
        controller.abort();
        cancelMessage?.();
        reject(new Error(messageSent
          ? 'The update result is unconfirmed. Check device readiness before trying again.'
          : 'The device is busy. Try the update again later.'));
      }, UPDATE_WAIT_MS); }),
    ]);
    if (registration.active !== worker) throw new Error('This update has changed. Check again.');
    return result;
  } finally {
    browser.clearTimeout(timeout);
    closed = true;
    controller.abort();
    try { stopWatching?.(); } catch { /* Listener cleanup cannot replace the outcome. */ }
  }
}
