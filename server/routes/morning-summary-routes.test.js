import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { registerMorningSummaryRoutes } from './morning-summary-routes.js';
import { MorningSummaryPreferenceConflict } from '../morningSummary/preferences.js';

const userId = 'cb000000-0000-4000-8000-000000000001';
async function harness({ confirmed = true, fail = false, conflict = false } = {}) {
  const calls = [];
  const app = express();
  const auth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async () => ({
    data: { user: { id: userId, email_confirmed_at: confirmed ? '2026-01-01' : null } }, error: null,
  }) } }) });
  const service = {
    load: async id => { calls.push(['load', id]); if (fail) throw new Error('private database details');
      return { enabled: false, deliveryTime: '07:00', revision: 0 }; },
    save: async (id, value) => { calls.push(['save', id, value]); if (fail) throw new Error('private database details');
      if (conflict) throw new MorningSummaryPreferenceConflict(); return { ...value, revision: value.revision + 1 }; },
  };
  registerMorningSummaryRoutes({ app, requireAuth: auth, service }); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { url: `http://127.0.0.1:${server.address().port}`, calls,
    close: () => new Promise(resolve => server.close(resolve)) };
}

test('confirmed auth and server-derived user ownership are required for both preference routes', async () => {
  const h = await harness({ confirmed: false });
  try {
    const get = await fetch(`${h.url}/api/notifications/morning-summary/preferences`, { headers: { Authorization: 'Bearer synthetic' } });
    const put = await fetch(`${h.url}/api/notifications/morning-summary/preferences`, { method: 'PUT',
      headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, deliveryTime: '07:15', revision: 0 }) });
    assert.equal(get.status, 403); assert.equal(put.status, 403); assert.deepEqual(h.calls, []);
  } finally { await h.close(); }
});

test('strict preference fields, safe errors and no summary send action', async () => {
  const h = await harness();
  const headers = { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' };
  try {
    const get = await fetch(`${h.url}/api/notifications/morning-summary/preferences`, { headers });
    assert.deepEqual(await get.json(), { enabled: false, deliveryTime: '07:00', revision: 0 });
    const put = await fetch(`${h.url}/api/notifications/morning-summary/preferences`, { method: 'PUT', headers,
      body: JSON.stringify({ enabled: true, deliveryTime: '06:30', revision: 0 }) });
    assert.deepEqual(await put.json(), { enabled: true, deliveryTime: '06:30', revision: 1 });
    assert.deepEqual(h.calls, [['load', userId], ['save', userId, { enabled: true, deliveryTime: '06:30', revision: 0 }]]);
    for (const body of [{ enabled: true, deliveryTime: '24:00', revision: 0 }, { enabled: true, deliveryTime: '07:00', revision: 0, userId },
      { enabled: 'true', deliveryTime: '07:00', revision: 0 }, { enabled: true, deliveryTime: null, revision: 0 },
      { enabled: true, deliveryTime: '07:00' }, { enabled: true, deliveryTime: '07:00', revision: -1 }]) {
      const result = await fetch(`${h.url}/api/notifications/morning-summary/preferences`, { method: 'PUT', headers, body: JSON.stringify(body) });
      assert.equal(result.status, 400);
    }
    assert.equal(h.calls.length, 2);
    const send = await fetch(`${h.url}/api/notifications/morning-summary/send`, { method: 'POST', headers });
    assert.equal(send.status, 404);
  } finally { await h.close(); }
  const broken = await harness({ fail: true });
  try {
    const response = await fetch(`${broken.url}/api/notifications/morning-summary/preferences`, { headers });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private database details/);
  } finally { await broken.close(); }
  const stale = await harness({ conflict: true });
  try {
    const response = await fetch(`${stale.url}/api/notifications/morning-summary/preferences`, { method: 'PUT', headers,
      body: JSON.stringify({ enabled: true, deliveryTime: '07:00', revision: 0 }) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /changed elsewhere/);
  } finally { await stale.close(); }
});
