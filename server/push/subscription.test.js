import assert from 'node:assert/strict';
import test from 'node:test';
import { endpointHash, validPushEndpoint, validPushSubscription, TEST_PUSH_PAYLOAD } from './subscription.js';
import { createPushService } from './service.js';

const user = 'ca000000-0000-4000-8000-000000000001';
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-device-token';
const subscription = { endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } };
const version = 'ca000000-0000-4000-8000-000000000099';
const config = { supabaseUrl: 'https://synthetic.invalid', supabaseSecretKey: 'fixture',
  vapidPublicKey: 'B'.repeat(87), vapidPrivateKey: 'A'.repeat(43), vapidSubject: 'mailto:push@example.test' };

test('push endpoints and keys allow only exact supported HTTPS services', () => {
  assert.equal(validPushSubscription(subscription), true);
  assert.equal(validPushEndpoint('https://db3.notify.windows.com/?token=synthetic-token-value'), true);
  assert.equal(endpointHash(endpoint).length, 64);
  for (const rejected of [
    'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.test/fcm/send/x',
    'https://fcm.googleapis.com:444/fcm/send/x', 'https://user@fcm.googleapis.com/fcm/send/x',
    'https://127.0.0.1/push/token', 'https://fcm.googleapis.com/fcm/send/x?redirect=1',
    'https://db3.notify.windows.com.evil.test/?token=synthetic-value',
  ]) assert.equal(validPushEndpoint(rejected), false, rejected);
  assert.equal(validPushSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'not base64!' } }), false);
  assert.equal(validPushSubscription({ ...subscription, provider: 'other' }), false);
  assert.deepEqual(JSON.parse(TEST_PUSH_PAYLOAD), { type: 'plannix-test', version: 1 });
});

test('server uses one scoped RPC per operation and an injected push sender', async () => {
  const calls = [];
  const fake = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: name.endsWith('claim_device') ? { state: 'current', version }
      : name.endsWith('status') || name.endsWith('register_device') || name.endsWith('remove_device') ? true
        : { ...subscription, version }, error: null };
  } };
  const sends = [];
  const service = createPushService({ config, createClientImpl: () => fake,
    pushImpl: { sendNotification: async (...args) => { sends.push(args); return { statusCode: 201 }; } } });
  assert.equal(await service.status(user, endpoint), true);
  await service.register(user, subscription);
  assert.deepEqual(await service.sendTest(user, endpoint), { accepted: true });
  assert.deepEqual(await service.claim(user, subscription), { state: 'current', version });
  assert.equal(await service.remove(user, endpoint, version), true);
  assert.deepEqual(calls.map(call => call.name), ['plannix_push_device_status', 'plannix_push_register_device', 'plannix_push_claim_test', 'plannix_push_claim_device', 'plannix_push_remove_device']);
  assert.ok(calls.every(call => call.args.validated_user_id === user && call.args.target_hash === endpointHash(endpoint)));
  assert.equal(calls.at(-1).args.claimed_version, version);
  assert.equal(calls.at(-2).args.target_p256dh, subscription.keys.p256dh);
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0][0], subscription);
  assert.equal(sends[0][1], TEST_PUSH_PAYLOAD);
  assert.equal(sends[0][2].TTL, 60);
});

test('rate limit, expired subscriptions and upstream errors stay safe', async () => {
  let removed = 0;
  const rpc = async name => ({ data: name.endsWith('claim_test') ? { ...subscription, version } : true, error: null });
  const fake = { rpc: async (name, args) => { if (name.endsWith('remove_expired_device')) { removed++; assert.equal(args.claimed_version, version); } return rpc(name, args); } };
  const expired = createPushService({ config, createClientImpl: () => fake,
    pushImpl: { sendNotification: async () => { throw { statusCode: 410, body: 'private upstream' }; } } });
  assert.deepEqual(await expired.sendTest(user, endpoint), { expired: true });
  assert.equal(removed, 1);
  const limited = createPushService({ config, createClientImpl: () => ({ rpc: async () => ({ data: { rateLimited: true }, error: null }) }),
    pushImpl: { sendNotification: () => assert.fail('rate-limited send') } });
  assert.deepEqual(await limited.sendTest(user, endpoint), { rateLimited: true });
  const erroring = createPushService({ config, createClientImpl: () => fake,
    pushImpl: { sendNotification: async () => { throw new Error('private upstream'); } } });
  await assert.rejects(erroring.sendTest(user, endpoint), error => !String(error).includes('private upstream'));
  const redirect = createPushService({ config, createClientImpl: () => fake,
    pushImpl: { sendNotification: async () => ({ statusCode: 302, headers: { location: 'https://evil.test' } }) } });
  await assert.rejects(redirect.sendTest(user, endpoint));
  await assert.rejects(erroring.sendTest('bad-user', endpoint));
});

test('a replacement registered during an expired send survives conditional cleanup', async () => {
  let finishSend;
  let currentVersion = version;
  const calls = [];
  const fake = { rpc: async (name, args) => {
    calls.push(name);
    if (name.endsWith('claim_test')) return { data: { ...subscription, version }, error: null };
    if (name.endsWith('remove_expired_device')) {
      assert.equal(args.claimed_version, version);
      return { data: currentVersion === args.claimed_version, error: null };
    }
    return { data: true, error: null };
  } };
  const service = createPushService({ config, createClientImpl: () => fake,
    pushImpl: { sendNotification: () => new Promise((_, reject) => { finishSend = reject; }) } });
  const sending = service.sendTest(user, endpoint);
  for (let attempt = 0; !finishSend && attempt < 20; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(finishSend);
  currentVersion = 'ca000000-0000-4000-8000-000000000100';
  finishSend({ statusCode: 410 });
  assert.deepEqual(await sending, { superseded: true });
  assert.equal(currentVersion, 'ca000000-0000-4000-8000-000000000100');
  assert.deepEqual(calls, ['plannix_push_claim_test', 'plannix_push_remove_expired_device']);
});
test('missing VAPID configuration disables push before database or network activity', async () => {
  const service = createPushService({ config: { ...config, vapidPrivateKey: '' },
    createClientImpl: () => assert.fail('Unexpected database access'),
    pushImpl: { sendNotification: () => assert.fail('Unexpected push send') } });
  assert.equal(service.configured(), false);
  assert.equal(service.publicKey(), null);
  await assert.rejects(service.register(user, subscription));
  await assert.rejects(service.sendTest(user, endpoint));
});
