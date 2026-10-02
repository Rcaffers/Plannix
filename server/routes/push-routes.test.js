import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { registerPushRoutes } from './push-routes.js';

const userId = 'ca000000-0000-4000-8000-000000000001';
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-device-token';
const subscription = { endpoint, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } };
const version = 'ca000000-0000-4000-8000-000000000099';
const headers = { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' };
async function harness({ confirmed = true, serviceResult = { accepted: true } } = {}) {
  const calls = [];
  const app = express();
  const auth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async () => ({ data: { user: confirmed ? { id: userId, email_confirmed_at: '2026-01-01' } : null }, error: null }) } }) });
  const service = {
    configured: () => true, publicKey: () => 'public-key-only',
    status: async (...args) => { calls.push(['status', ...args]); return true; },
    register: async (...args) => { calls.push(['register', ...args]); },
    claim: async (...args) => { calls.push(['claim', ...args]); return { state: 'current', version }; },
    remove: async (...args) => { calls.push(['remove', ...args]); return true; },
    sendTest: async (...args) => { calls.push(['test', ...args]); return serviceResult; },
  };
  registerPushRoutes({ app, requireAuth: auth, service }); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(resolve => server.close(resolve)) };
}
const post = (h, path, body, customHeaders = headers) => fetch(`${h.url}/api/notifications/${path}`, {
  method: 'POST', headers: customHeaders, body: JSON.stringify(body),
});

test('all notification operations require confirmed auth and never expose a private key', async () => {
  const h = await harness({ confirmed: false });
  try {
    for (const [path, body] of [['status', { endpoint }], ['register', { subscription }], ['claim', { subscription }], ['remove', { endpoint, version }], ['test', { endpoint }]]) {
      const response = await post(h, path, body);
      assert.equal(response.status, 401);
    }
    const config = await fetch(`${h.url}/api/notifications/config`, { headers });
    assert.equal(config.status, 401);
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});
test('routes bind actions to confirmed user, keep endpoints out of URLs, and send tests through the server', async () => {
  const h = await harness();
  try {
    const config = await fetch(`${h.url}/api/notifications/config`, { headers });
    assert.deepEqual(await config.json(), { configured: true, publicKey: 'public-key-only' });
    for (const [path, body, result] of [
      ['status', { endpoint }, { registered: true }], ['register', { subscription }, { registered: true }],
      ['claim', { subscription }, { state: 'current', version }],
      ['test', { endpoint }, { accepted: true }], ['remove', { endpoint, version }, { removed: true }],
    ]) {
      const response = await post(h, path, body);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    }
    assert.deepEqual(h.calls.map(call => call[0]), ['status', 'register', 'claim', 'test', 'remove']);
    assert.deepEqual(h.calls.at(-1), ['remove', userId, endpoint, version]);
    assert.ok(h.calls.every(call => call[1] === userId));
    assert.ok(h.calls.every(call => !JSON.stringify(call).includes('private-key')));
  } finally { await h.close(); }
});
test('invalid endpoints and oversized bodies fail before push service; rate limits and expiry are safe', async () => {
  const h = await harness({ serviceResult: { rateLimited: true } });
  try {
    const invalid = await post(h, 'test', { endpoint: 'https://evil.test/private' });
    assert.equal(invalid.status, 400);
    assert.equal(h.calls.length, 0);
    assert.equal((await post(h, 'remove', { endpoint })).status, 400);
    assert.equal((await post(h, 'remove', { endpoint, version: 'bad' })).status, 400);
    assert.equal(h.calls.length, 0);
    const tooLarge = await post(h, 'register', { subscription: { ...subscription, filler: 'x'.repeat(9000) } });
    assert.equal(tooLarge.status, 413);
    assert.equal(h.calls.length, 0);
    const limited = await post(h, 'test', { endpoint });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.doesNotMatch(JSON.stringify(await limited.json()), /synthetic-device-token/);
  } finally { await h.close(); }
  const expired = await harness({ serviceResult: { expired: true } });
  try { assert.equal((await post(expired, 'test', { endpoint })).status, 410); }
  finally { await expired.close(); }
  const replaced = await harness({ serviceResult: { superseded: true } });
  try { assert.equal((await post(replaced, 'test', { endpoint })).status, 409); }
  finally { await replaced.close(); }
});
