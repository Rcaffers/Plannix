import assert from 'node:assert/strict';
import test from 'node:test';
import { beginPushSignOut, currentPushSubscription, disableCurrentDevice, pushRequest, reconcilePushAccount } from './pushNotifications.js';
import { withPushDeviceLock } from './pushDeviceLock.js';

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function locks() {
  let tail = Promise.resolve();
  return { request(name, options, callback) {
    assert.equal(name, 'plannix-push-device');
    assert.equal(options.mode, 'exclusive');
    const work = tail.then(() => callback({ name }));
    tail = work.catch(() => {});
    return work;
  } };
}
const version = 'ca000000-0000-4000-8000-000000000099';
function device({ sharedLocks = locks(), key = 'a'.repeat(22) } = {}) {
  const calls = [];
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-device-token',
    toJSON: () => ({ keys: { p256dh: 'p'.repeat(87), auth: key } }),
    unsubscribe: async () => { calls.push('unsubscribe'); return true; } };
  let current = subscription;
  const browser = { isSecureContext: true, PushManager: function PushManager() {}, Notification: { permission: 'granted' },
    navigator: { locks: sharedLocks, serviceWorker: { getRegistration: async () => ({ pushManager: {
      getSubscription: async () => current,
    } }) } } };
  return { browser, subscription, calls, replace: value => { current = value; } };
}
const claim = path => path === 'claim' ? { state: 'current', version } : { removed: true };

test('without Web Locks confirmed versioned server removal permits sign-out without browser unsubscribe', async () => {
  const target = device();
  delete target.browser.navigator.locks;
  const calls = [];
  assert.deepEqual(await disableCurrentDevice({ browser: target.browser, request: async (path, body) => {
    calls.push({ path, body });
    return claim(path);
  } }), { state: 'removed' });
  assert.deepEqual(calls.map(item => item.path), ['claim', 'remove']);
  assert.equal(calls[1].body.version, version);
  assert.deepEqual(target.calls, []);
  target.replace(null);
  assert.deepEqual(await disableCurrentDevice({ browser: target.browser }), { state: 'absent' });
});
test('without Web Locks failed or mismatched removal cannot claim cleanup or unsubscribe', async () => {
  for (const outcome of [() => { throw Error('synthetic server error'); }, () => ({ removed: false })]) {
    const target = device();
    delete target.browser.navigator.locks;
    await assert.rejects(disableCurrentDevice({ browser: target.browser,
      request: async path => path === 'claim' ? claim(path) : outcome() }));
    assert.deepEqual(target.calls, []);
  }
});
test('without Web Locks a timed-out old removal cannot delete a newer version', async () => {
  const target = device();
  delete target.browser.navigator.locks;
  const pending = deferred();
  let requested = false;
  const work = disableCurrentDevice({ browser: target.browser, request: (path, body) => {
    if (path === 'claim') return claim(path);
    assert.equal(body.version, version);
    requested = true;
    return pending.promise;
  } });
  while (!requested) await Promise.resolve();
  const timer = new Promise(resolve => setTimeout(() => resolve('deadline'), 10));
  assert.equal(await Promise.race([work, timer]), 'deadline');
  target.replace({ endpoint: target.subscription.endpoint,
    toJSON: () => ({ keys: { auth: 'newer', p256dh: 'newer' } }),
    unsubscribe: () => assert.fail('No browser unsubscribe') });
  pending.resolve({ removed: false });
  await assert.rejects(work, /subscription changed/);
  assert.deepEqual(target.calls, []);
});
test('without Web Locks an account change after claim stops removal', async () => {
  const target = device();
  delete target.browser.navigator.locks;
  let current = true;
  const calls = [];
  await assert.rejects(disableCurrentDevice({ browser: target.browser,
    isCurrent: () => current,
    request: async path => { calls.push(path); current = false; return claim(path); } }), /account changed/);
  assert.deepEqual(calls, ['claim']);
  assert.deepEqual(target.calls, []);
});
test('lock errors are safe and task failure releases lock for retry', async () => {
  const target = device();
  target.browser.navigator.locks.request = async () => { throw Error('private lock diagnostic'); };
  await assert.rejects(withPushDeviceLock(() => assert.fail('No work'), { browser: target.browser }),
    error => !error.message.includes('private'));
  const other = device();
  await assert.rejects(withPushDeviceLock(() => { throw Error('task failure'); }, { browser: other.browser }), /task failure/);
  assert.equal(await withPushDeviceLock(() => 'retried', { browser: other.browser }), 'retried');
});
test('confirmed claim and versioned removal run under the device lock', async () => {
  const target = device();
  const calls = [];
  const result = await disableCurrentDevice({ browser: target.browser, request: async (path, body) => {
    calls.push({ path, body });
    return claim(path);
  } });
  assert.equal(result.state, 'removed');
  assert.deepEqual(calls.map(item => item.path), ['claim', 'remove']);
  assert.equal(calls[1].body.version, version);
  assert.deepEqual(target.calls, ['unsubscribe']);
});
test('server failure can fall back to unsubscribe only after confirmed claim', async () => {
  const target = device();
  const result = await disableCurrentDevice({ browser: target.browser,
    request: async path => path === 'claim' ? claim(path) : Promise.reject(Error('offline')) });
  assert.equal(result.state, 'unsubscribed');
  assert.deepEqual(target.calls, ['unsubscribe']);
});
test('unknown ownership and version mismatch never unsubscribe', async () => {
  for (const response of [{ state: 'superseded' }, { state: 'unknown' }, { state: 'current', version }]) {
    const target = device();
    const request = async path => path === 'claim' ? response : { removed: false };
    await assert.rejects(disableCurrentDevice({ browser: target.browser, request }));
    assert.deepEqual(target.calls, []);
  }
});
test('dual cleanup failure is actionable and redacts transport diagnostics', async () => {
  const target = device();
  target.subscription.unsubscribe = async () => { throw Error('browser private failure'); };
  await assert.rejects(disableCurrentDevice({ browser: target.browser,
    request: async path => path === 'claim' ? claim(path) : Promise.reject(Error('server private failure')) }),
  error => /Please retry sign out/.test(error.message) && !/private/.test(error.message));
});
test('account change during claim cannot remove or unsubscribe another account', async () => {
  const target = device();
  let current = true;
  const calls = [];
  await assert.rejects(disableCurrentDevice({ browser: target.browser, isCurrent: () => current,
    request: async path => { calls.push(path); current = false; return claim(path); } }), /account changed/);
  assert.deepEqual(calls, ['claim']);
  assert.deepEqual(target.calls, []);
});
test('a newer same-endpoint subscription survives delayed removal', async () => {
  const target = device();
  const pending = deferred();
  let removing = false;
  const work = disableCurrentDevice({ browser: target.browser, request: path => {
    if (path === 'claim') return claim(path);
    removing = true;
    return pending.promise;
  } });
  while (!removing) await Promise.resolve();
  target.replace({ endpoint: target.subscription.endpoint,
    toJSON: () => ({ keys: { auth: 'replacement', p256dh: 'replacement' } }),
    unsubscribe: () => assert.fail('Replacement must survive') });
  pending.resolve({ removed: true });
  await assert.rejects(work, /subscription changed/);
  assert.deepEqual(target.calls, []);
});
test('stale status:false across two tabs cannot unsubscribe newer registration', async () => {
  const shared = locks();
  const oldTab = device({ sharedLocks: shared });
  const newTab = device({ sharedLocks: shared, key: 'b'.repeat(22) });
  const status = deferred();
  let started = false;
  const oldCheck = reconcilePushAccount({ browser: oldTab.browser, request: async () => {
    started = true;
    return status.promise;
  } });
  while (!started) await Promise.resolve();
  let newRegistered = false;
  const newer = withPushDeviceLock(async () => { newRegistered = true; }, { browser: newTab.browser });
  await Promise.resolve();
  assert.equal(newRegistered, false);
  status.resolve({ registered: false });
  assert.deepEqual(await oldCheck, { state: 'needsReconciliation' });
  await newer;
  assert.equal(newRegistered, true);
  assert.deepEqual(oldTab.calls, []);
  assert.deepEqual(newTab.calls, []);
  assert.equal(await currentPushSubscription(newTab.browser), newTab.subscription);
});
test('new tab registration first remains intact after old tab sees false status', async () => {
  const shared = locks();
  const oldTab = device({ sharedLocks: shared });
  const newTab = device({ sharedLocks: shared });
  await withPushDeviceLock(async () => {}, { browser: newTab.browser });
  assert.deepEqual(await reconcilePushAccount({ browser: oldTab.browser,
    request: async () => ({ registered: false }) }), { state: 'needsReconciliation' });
  assert.deepEqual(oldTab.calls, []);
});
test('late old-account status cannot overwrite a newer account reconciliation', async () => {
  const target = device();
  const oldStatus = deferred();
  let started = false;
  const old = reconcilePushAccount({ browser: target.browser, request: async () => {
    started = true;
    return oldStatus.promise;
  } });
  while (!started) await Promise.resolve();
  const newer = reconcilePushAccount({ browser: target.browser,
    request: async () => ({ registered: true }) });
  oldStatus.resolve({ registered: false });
  assert.deepEqual(await old, { state: 'stale' });
  assert.deepEqual(await newer, { state: 'current' });
  assert.deepEqual(target.calls, []);
});
test('pending registration blocks sign-out until bounded deadline; retry succeeds', async () => {
  const response = deferred();
  let requested = false;
  const pending = pushRequest('register', { subscription: {} }, {
    sessionImpl: async () => ({ accessToken: 'synthetic', userId: 'ca000000-0000-4000-8000-000000000001' }),
    fetchImpl: () => { requested = true; return response.promise; },
  });
  while (!requested) await Promise.resolve();
  const first = beginPushSignOut();
  try {
    await assert.rejects(pushRequest('register', {}), /cleanup is in progress/);
    await assert.rejects(first.waitForRegistrations(10), /timed out/);
  } finally { first.release(); }
  response.resolve(new Response('{"registered":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await pending;
  const retry = beginPushSignOut();
  try { await retry.waitForRegistrations(20); }
  finally { retry.release(); }
});
