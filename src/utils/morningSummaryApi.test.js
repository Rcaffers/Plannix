import assert from 'node:assert/strict';
import test from 'node:test';
import { createMorningSummaryApi } from './morningSummaryApi.js';

const userId = 'cb000000-0000-4000-8000-000000000001';
const yearId = 'cb000000-0000-4000-8000-000000000010';
const notificationRef = 'cb000000-0000-4000-8000-000000000011';
const session = async () => ({ userId, token: 'synthetic-token' });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: () => null }, json: async () => body });

test('preferences use confirmed account token and accept only strict server results', async () => {
  const calls = [];
  const api = createMorningSummaryApi({ getSession: session, fetchImpl: async (url, options) => {
    calls.push([url, options]); return response({ enabled: false, deliveryTime: '07:00', revision: 0, academicYearId: null });
  } });
  assert.deepEqual((await api.load(userId)).deliveryTime, '07:00');
  await api.save(userId, { enabled: true, deliveryTime: '08:15', revision: 0, academicYearId: yearId });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(JSON.parse(calls[1][1].body), { enabled: true, deliveryTime: '08:15', revision: 0, academicYearId: yearId });
  assert.ok(calls.every(([url]) => !url.includes(userId)));
});

test('changed account, malformed results and failed requests fail closed', async () => {
  let fetched = false;
  const wrong = createMorningSummaryApi({ getSession: async () => ({ userId: 'cb000000-0000-4000-8000-000000000002', token: 'synthetic' }),
    fetchImpl: async () => { fetched = true; throw Error('unreachable'); } });
  await assert.rejects(wrong.load(userId), /account changed/);
  assert.equal(fetched, false);
  const malformed = createMorningSummaryApi({ getSession: session,
    fetchImpl: async () => response({ enabled: 'true', deliveryTime: '07:00' }) });
  await assert.rejects(malformed.load(userId), /invalid morning summary preferences/);
  await assert.rejects(malformed.save(userId, { enabled: true, deliveryTime: '24:00', revision: 0 }), /invalid morning summary preferences/);
  const stale = createMorningSummaryApi({ getSession: session, fetchImpl: async () => response({ message: 'private state' }, 409) });
  await assert.rejects(stale.save(userId, { enabled: true, deliveryTime: '07:00', revision: 0, academicYearId: yearId }),
    error => error.status === 409 && !error.message.includes('private state'));
  const failed = createMorningSummaryApi({ getSession: session,
    fetchImpl: async () => { throw Error('synthetic upstream private detail'); } });
  await assert.rejects(failed.load(userId), error => !error.message.includes('synthetic upstream private detail'));
});

test('notification day uses only an opaque reference and the confirmed account', async () => {
  const calls = [];
  const api = createMorningSummaryApi({ getSession: session, fetchImpl: async (url, options) => {
    calls.push([url, options]); return response({ date: '2026-10-05', week: 'A', lessons: [], events: [] });
  } });
  assert.equal((await api.day(userId, notificationRef)).date, '2026-10-05');
  assert.match(calls[0][0], /summaryRef=cb000000-0000-4000-8000-000000000011/);
  assert.doesNotMatch(calls[0][0], /academicYearId|date=/);
  assert.doesNotMatch(calls[0][0], new RegExp(userId));
  assert.equal(calls[0][1].method, 'GET');
  await assert.rejects(api.day(userId, 'invalid'), /invalid/);
  assert.equal(calls.length, 1);
  const malformed = createMorningSummaryApi({ getSession: session,
    fetchImpl: async () => response({ date: 'invalid', lessons: [], events: [] }) });
  await assert.rejects(malformed.day(userId, notificationRef), /invalid daily summary/);
});
