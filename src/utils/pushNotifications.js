import { getSupabaseClient } from '../lib/supabase.js';
import { serverManagedAuth, serverAuthFetch, serverSessionStatus,
  captureServerOperationContext, assertServerOperationContext } from './serverAuthTransport.js';
import { API_BASE_URL, ApiError, parseJsonSafe } from './api.js';
import { pushCoordinationSupported, withPushDeviceLock } from './pushDeviceLock.js';

export function pushSupport(browser = globalThis) {
  return Boolean(browser.isSecureContext && browser.navigator?.serviceWorker
    && browser.PushManager && browser.Notification);
}

export function vapidBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{60,120}$/.test(value)) throw new ApiError('Notification configuration is invalid.');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

let reconciliationGeneration = 0;
let reconciliationInFlight = Promise.resolve();
const registrations = new Set();
let signOutBlocked = false;
const CLEANUP_DEADLINE_MS = 4000;
export function waitForPushAccountReconciliation() { return reconciliationInFlight; }

function withDeadline(operation, milliseconds = CLEANUP_DEADLINE_MS) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Notification cleanup timed out.')), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

export function beginPushSignOut() {
  if (signOutBlocked) throw new Error('Notification cleanup is already in progress.');
  signOutBlocked = true;
  reconciliationGeneration++;
  let released = false;
  return {
    async waitForRegistrations(deadlineMs = CLEANUP_DEADLINE_MS) {
      await withDeadline(() => Promise.allSettled([...registrations]), deadlineMs);
    },
    release() {
      if (!released) { released = true; signOutBlocked = false; }
    },
  };
}

async function sessionToken() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) throw new ApiError('Authentication is required.');
  const checked = await client.auth.getUser(data.session.access_token);
  if (checked.error || !checked.data?.user?.email_confirmed_at) throw new ApiError('Confirmed authentication is required.');
  return { accessToken: data.session.access_token, userId: checked.data.user.id };
}

async function sendPushRequest(path, body, { fetchImpl = fetch, expectedUserId, signal,
  sessionImpl = sessionToken, operationContext } = {}) {
  const context = serverManagedAuth
    ? operationContext || captureServerOperationContext(expectedUserId) : null;
  if (context) assertServerOperationContext(context);
  const session = serverManagedAuth
    ? { userId: (await serverSessionStatus(fetchImpl,{ signal, operationContext:context })).userId }
    : await sessionImpl();
  if (context) assertServerOperationContext(context);
  if (context && session.userId !== context.userId)
    throw new DOMException('Account changed.', 'AbortError');
  if (expectedUserId && session.userId !== expectedUserId) throw new ApiError('Your account changed. Please reload notification settings.');
  if (path === 'register' && signOutBlocked) throw new ApiError('Sign-out notification cleanup is in progress.');
  let response;
  try {
    const input = `${API_BASE_URL}/api/notifications/${path}`;
    const init = {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit',
      headers: { ...(serverManagedAuth ? {} : { Authorization: `Bearer ${session.accessToken}` }),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
    };
    response = serverManagedAuth
      ? await serverAuthFetch(input, init, { fetchImpl, operationContext:context })
      : await fetchImpl(input, init);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the notification service.');
  }
  const result = await parseJsonSafe(response);
  if (!response.ok) {
    const safe = typeof result?.message === 'string' && result.message.length <= 180
      ? result.message : 'Notification request failed.';
    throw new ApiError(safe, { status: response.status, requestId: response.headers.get('x-request-id') });
  }
  return result;
}

export function pushRequest(path, body, options = {}) {
  if (path === 'register' && signOutBlocked) return Promise.reject(new ApiError('Sign-out notification cleanup is in progress.'));
  const work = sendPushRequest(path, body, options);
  if (path === 'register') {
    registrations.add(work);
    void work.then(() => registrations.delete(work), () => registrations.delete(work));
  }
  return work;
}

export async function currentPushSubscription(browser = globalThis) {
  if (!pushSupport(browser)) return null;
  const registration = await browser.navigator.serviceWorker.getRegistration('/');
  return registration?.pushManager?.getSubscription() || null;
}

function samePushSubscription(first, second) {
  if (first === second) return true;
  if (!first || !second || first.endpoint !== second.endpoint) return false;
  const firstKeys = first.toJSON?.().keys;
  const secondKeys = second.toJSON?.().keys;
  return Boolean(firstKeys?.auth && firstKeys?.p256dh
    && firstKeys.auth === secondKeys?.auth && firstKeys.p256dh === secondKeys?.p256dh);
}
class SubscriptionChangedError extends Error {
  constructor() { super('This device subscription changed. Reload notification settings before trying again.'); }
}

export async function disableCurrentDevice({ browser = globalThis, request = pushRequest,
  expectedUserId, isCurrent = () => true,
  subscriptionSnapshot, operationContext } = {}) {
  const context = serverManagedAuth
    ? operationContext || captureServerOperationContext(expectedUserId) : null;
  const scopedRequest = (path, body) => {
    if (context) assertServerOperationContext(context);
    return request(path, body, { expectedUserId, operationContext:context });
  };
  reconciliationGeneration++;
  if (!pushCoordinationSupported(browser)) {
    // Without cross-tab coordination, only an atomic server removal is safe.
    // Capture the current identity once; never unsubscribe the browser here.
    const subscription = await currentPushSubscription(browser);
    if (!subscription) return { state: 'absent' };
    if (!isCurrent()) throw new Error('Notification account changed.');
    const keys = subscription.toJSON?.().keys;
    const endpoint = subscription.endpoint;
    const claim = await scopedRequest('claim', { subscription: { endpoint, keys } });
    if (!isCurrent()) throw new Error('Notification account changed.');
    if (claim?.state === 'absent') return { state: 'absent' };
    if (claim?.state !== 'current' || typeof claim.version !== 'string') throw new SubscriptionChangedError();
    const response = await scopedRequest('remove', { endpoint, version: claim.version });
    if (!isCurrent()) throw new Error('Notification account changed.');
    if (response?.removed !== true) throw new SubscriptionChangedError();
    return { state: 'removed' };
  }
  return withPushDeviceLock(async () => {
    if (context) assertServerOperationContext(context);
    const subscription = await currentPushSubscription(browser);
    if (!subscription) return { state: 'absent' };
    if (subscriptionSnapshot !== undefined) {
      const snapshot = await subscriptionSnapshot;
      if (!samePushSubscription(snapshot, subscription)) throw new SubscriptionChangedError();
    }
    if (!isCurrent()) throw new Error('Notification account changed.');
    const details = subscription.toJSON?.();
    // Unknown ownership is never permission to unsubscribe a shared device.
    const claim = await scopedRequest('claim', { subscription: {
      endpoint: subscription.endpoint, keys: details?.keys,
    } });
    if (!isCurrent()) throw new Error('Notification account changed.');
    if (claim?.state === 'absent') return { state: 'absent' };
    if (claim?.state === 'superseded') throw new SubscriptionChangedError();
    if (claim?.state !== 'current' || typeof claim.version !== 'string') {
      throw new Error('Notification removal was not confirmed.');
    }
    let removed = false;
    try {
      const response = await scopedRequest('remove', { endpoint: subscription.endpoint,
        version: claim.version });
      if (response?.removed === false) throw new SubscriptionChangedError();
      removed = response?.removed === true;
    } catch (error) {
      if (error instanceof SubscriptionChangedError) throw error;
      // A confirmed claim permits browser unsubscription as a fallback.
    }
    if (!isCurrent()) throw new Error('Notification account changed.');
    const current = await currentPushSubscription(browser);
    if (current && !samePushSubscription(subscription, current)) throw new SubscriptionChangedError();
    let unsubscribed = !current;
    if (current) {
      try { unsubscribed = await subscription.unsubscribe() === true; }
      catch { /* A confirmed server removal may already be sufficient. */ }
    }
    if (!removed && !unsubscribed) throw new Error('Could not disable notifications on this device. Please retry sign out.');
    return { state: removed ? 'removed' : 'unsubscribed' };
  }, { browser });
}

export function reconcilePushAccount({ browser = globalThis, request = pushRequest } = {}) {
  let context;
  try { context = serverManagedAuth ? captureServerOperationContext() : null; }
  catch (error) { return Promise.reject(error); }
  const generation = ++reconciliationGeneration;
  const work = Promise.allSettled([...registrations]).then(() => withPushDeviceLock(async () => {
    if (context) assertServerOperationContext(context);
    if (generation !== reconciliationGeneration) return { state: 'stale' };
    const subscription = await currentPushSubscription(browser);
    if (!subscription) return { state: 'absent' };
    try {
      const status = await request('status', { endpoint: subscription.endpoint },
        { operationContext:context });
      if (generation !== reconciliationGeneration) return { state: 'stale' };
      if (status?.registered === true) return { state: 'current' };
    } catch { /* Unknown ownership remains non-destructive. */ }
    return { state: 'needsReconciliation' };
  }, { browser }));
  reconciliationInFlight = work;
  return work;
}
