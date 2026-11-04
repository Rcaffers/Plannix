import { DEVICE_LOCK_NAME, pushCoordinationSupported } from './pushDeviceLock.js';

const TIMEOUT_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION = /^__Host-plannix-s-[1-9]\d{0,15}$/;

async function command(kind, { expectedEpoch = 0, selector } = {}, browser = globalThis) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let channel;
    const finish = (result, error) => {
      if (finished) return;
      finished = true;
      browser.clearTimeout(timer);
      channel?.port1.close();
      if (error) reject(error); else resolve(result);
    };
    const timer = browser.setTimeout(() => {
      finish(null, new Error('Detail coordination timed out.'));
    }, TIMEOUT_MS);
    Promise.resolve().then(() => browser.navigator?.serviceWorker?.getRegistration?.('/'))
      .then(registration => {
        if (finished) return;
        const worker = registration?.active;
        if (!worker || !browser.MessageChannel) throw new Error('Detail coordination is unavailable.');
        channel = new browser.MessageChannel();
        channel.port1.onmessage = event => event.data?.ok === true
          ? finish(event.data) : finish(null,new Error('Detail coordination changed.'));
        worker.postMessage({ type: 'plannix-detail-selector', kind, expectedEpoch, selector }, [channel.port2]);
      }).catch(() => finish(null,new Error('Detail coordination is unavailable.')));
  });
}

export function observeDetailSelector(browser) { return command('observe', {}, browser); }

export function commitDetailSelector({ expectedEpoch, sessionName, installationVersion,
  policyVersion }, browser) {
  if (!Number.isSafeInteger(expectedEpoch) || !SESSION.test(sessionName)
    || !UUID.test(installationVersion) || !UUID.test(policyVersion))
    throw new Error('Detail selector is invalid.');
  return command('commit', { expectedEpoch,
    selector: { sessionName, installationVersion, policyVersion } }, browser);
}

export function invalidateDetailSelector(browser) { return command('invalidate', {}, browser); }

// The session/provider transition must proceed even if device coordination
// fails. The worker itself requires a working lock and fresh server authority.
export async function withDetailTransition(task, { browser = globalThis,
  invalidate = true } = {}) {
  if (!pushCoordinationSupported(browser) || !browser.navigator?.serviceWorker?.getRegistration) {
    if (invalidate) void invalidateDetailSelector(browser).catch(() => {});
    return task();
  }
  const controller = new AbortController();
  let entered = false;
  let closed = false;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timer = browser.setTimeout(() => {
    controller.abort();
    if (!entered) rejectDeadline(new Error('Detail coordination timed out.'));
  }, TIMEOUT_MS);
  try {
    return await Promise.race([browser.navigator.locks.request(DEVICE_LOCK_NAME,
      { mode:'exclusive', signal:controller.signal }, async lock => {
      if (closed) throw new Error('Detail coordination is unavailable.');
      entered = true;
      browser.clearTimeout(timer);
      if (!lock) throw new Error('Detail coordination is unavailable.');
      if (invalidate) await invalidateDetailSelector(browser).catch(() => {});
      return task();
    }), deadline]);
  } catch (error) {
    // Aborted acquisition has not called task. Never replay a started task.
    if (entered) throw error;
    closed = true;
    if (invalidate) await invalidateDetailSelector(browser).catch(() => {});
    return task();
  } finally { browser.clearTimeout(timer); }
}
