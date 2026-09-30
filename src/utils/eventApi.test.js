import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from './api.js';
import { createEventApi } from './eventApi.js';
const year = 'e4000000-0000-4000-8000-000000000001';
const id = 'e5000000-0000-4000-8000-000000000001';
const requestId = 'e6000000-0000-4000-8000-000000000001';
const event = { id, academicYearId: year, date: '2026-10-01', title: 'Event', startTime: null, endTime: null, location: null, notes: null, revision: 1 };
const fields = { date: event.date, title: event.title, startTime: null, endTime: null, location: null, notes: null };
function response(body, status = 200, idValue = requestId) { return { ok: status < 400, status,
  headers: { get: name => name.toLowerCase() === 'x-request-id' ? idValue : null }, json: async () => body }; }
test('client list/create/update/delete use bearer token, no cookies, normalized exact payloads', async () => {
  const calls = [];
  const api = createEventApi({ getSession: async () => ({ access_token: 'synthetic-token' }),
    fetchImpl: async (url, options) => { calls.push({ url, options });
      if (options.method === 'GET') return response({ events: [event] });
      if (options.method === 'DELETE') return response({ ok: true });
      if (options.method === 'PUT') return response({ event: { ...event, revision: 2 } });
      return response({ event }, 201);
    } });
  assert.equal((await api.list(year, { from: '2026-09-28', to: '2026-10-04' })).events[0].id, id);
  assert.equal((await api.create(year, { ...fields, title: ' Event ' })).event.title, 'Event');
  assert.equal((await api.update(id, 1, fields)).event.revision, 2);
  assert.deepEqual(await api.remove(id, 1), { ok: true, requestId });
  assert.deepEqual(calls.map(c => c.options.method), ['GET', 'POST', 'PUT', 'DELETE']);
  assert.ok(calls.every(c => c.options.credentials === 'omit' && c.options.headers.Authorization === 'Bearer synthetic-token'));
  assert.deepEqual(JSON.parse(calls[1].options.body), { academicYearId: year, event: fields });
  assert.deepEqual(JSON.parse(calls[2].options.body), { expectedRevision: 1, event: fields });
  assert.deepEqual(JSON.parse(calls[3].options.body), { expectedRevision: 1 });
});
test('invalid inputs and missing auth fail before data requests', async () => {
  let calls = 0;
  const api = createEventApi({ getSession: async () => ({ access_token: 'synthetic-token' }), fetchImpl: async () => { calls++; } });
  await assert.rejects(api.list('bad'), ApiError);
  await assert.rejects(api.list(year, { from: '2026-02-30', to: '2026-03-01' }), ApiError);
  await assert.rejects(api.create(year, { ...fields, title: '<script>' }), ApiError);
  await assert.rejects(api.update(id, 0, fields), ApiError);
  await assert.rejects(api.remove(id, -1), ApiError);
  assert.equal(calls, 0);
  const noAuth = createEventApi({ getSession: async () => null, fetchImpl: async () => { calls++; } });
  await assert.rejects(noAuth.list(year), /Authentication is required/);
  assert.equal(calls, 0);
});
test('malformed response and conflicts fail safely with canonical support reference', async () => {
  const api = createEventApi({ getSession: async () => ({ access_token: 'synthetic-token' }),
    fetchImpl: async () => response({ message: 'This event changed elsewhere. Reload and try again.', raw: 'private data' }, 409) });
  await assert.rejects(api.update(id, 1, fields), error => error.status === 409 && error.requestId === requestId
    && !String(error).includes('private data'));
  const malformed = createEventApi({ getSession: async () => ({ access_token: 'synthetic-token' }),
    fetchImpl: async () => response({ events: [{ ...event, secret: 'private data' }] }) });
  await assert.rejects(malformed.list(year), /invalid event data/);
  const wrongYear = createEventApi({ getSession: async () => ({ access_token: 'synthetic-token' }),
    fetchImpl: async () => response({ events: [{ ...event, academicYearId: id }] }) });
  await assert.rejects(wrongYear.list(year), /invalid event data/);
});
test('AbortSignal is forwarded and a cancelled request is not hidden', async () => {
  const controller = new AbortController();
  const api = createEventApi({ getSession: async () => ({ access_token: 'synthetic-token' }),
    fetchImpl: async (_url, options) => { assert.equal(options.signal, controller.signal); throw new DOMException('Aborted', 'AbortError'); } });
  await assert.rejects(api.list(year, { signal: controller.signal }), error => error.name === 'AbortError');
});
