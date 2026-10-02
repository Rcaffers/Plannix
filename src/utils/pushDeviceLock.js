const DEVICE_LOCK_NAME = 'plannix-push-device';

export const PUSH_LOCK_UNAVAILABLE = 'This browser cannot safely coordinate notifications across tabs. Notifications are unavailable here.';

export function pushCoordinationSupported(browser = globalThis) {
  return typeof browser.navigator?.locks?.request === 'function';
}

export async function withPushDeviceLock(task, { browser = globalThis } = {}) {
  if (!pushCoordinationSupported(browser)) throw new Error(PUSH_LOCK_UNAVAILABLE);
  let taskError;
  try {
    return await browser.navigator.locks.request(DEVICE_LOCK_NAME, { mode: 'exclusive' }, async lock => {
      if (!lock) throw new Error(PUSH_LOCK_UNAVAILABLE);
      try { return await task(); }
      catch (error) { taskError = error; throw error; }
    });
  } catch (error) {
    if (error === taskError) throw error;
    throw new Error('Could not coordinate notifications across tabs. Please retry.');
  }
}
