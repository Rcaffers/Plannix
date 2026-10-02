import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { zipSync } from 'fflate';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('External network disabled in import preview route tests'); };
test.after(() => { globalThis.fetch = nativeFetch; });
const { registerAiImportPreviewRoutes } = await import('./ai-import-preview-routes.js');
const id = '91000000-0000-4000-8000-000000000001';
const year = { academicYearStartDate: '2026-09-01', academicYearEndDate: '2027-08-31' };
const event = { title: 'Assembly', date: '', sourceDate: '03/04/2027', allDay: false,
  startTime: '', endTime: '', location: '', notes: '' };
const holiday = { label: 'INSET Day', startDate: '2026-09-01', endDate: '2026-09-01', sourceDate: '1 September 2026' };
const query = destination => new URLSearchParams({ destination, boundaryStart: year.academicYearStartDate, boundaryEnd: year.academicYearEndDate });
async function setup(t, options = {}) {
  const app = express(), calls = [], logs = [];
  const requireAuth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async token => token === 'bad'
    ? { error: { status: 401 } } : { data: { user: { id, email_confirmed_at: token === 'unconfirmed' ? null : '2026-01-01' } } } } }) });
  app.use(requestId);
  registerAiImportPreviewRoutes({ app, requireAuth, rateLimit: (_req, _res, next) => next(),
    generate: async args => { calls.push(args); return { entries: args.schemaName.startsWith('event') ? [event] : [holiday] }; },
    extractPdf: async () => ({ text: 'Synthetic calendar text', pageCount: 2 }), ...options });
  app.use((error, req, res, next) => {
    const original = console.error; console.error = line => logs.push(line);
    try { errorHandler(error, req, res, next); } finally { console.error = original; }
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/ai/import-preview`;
  const request = (path, body, contentType = 'application/json', token = 'confirmed', extra = {}) => nativeFetch(base + path,
    { method: 'POST', headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: contentType === 'application/json' && typeof body !== 'string' ? JSON.stringify(body) : body, ...extra });
  return { calls, logs, request };
}
test('confirmed authentication and server-owned destination schema are required', async t => {
  const h = await setup(t), body = { destination: 'events', text: 'Assembly on 03/04/2027', ...year };
  assert.equal((await h.request('/extract', body, 'application/json', null)).status, 401);
  assert.equal((await h.request('/extract', body, 'application/json', 'bad')).status, 401);
  assert.equal((await h.request('/extract', body, 'application/json', 'unconfirmed')).status, 403);
  assert.equal(h.calls.length, 0);
  const response = await h.request('/extract', body);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { destination: 'events', entries: [event] });
  assert.equal(h.calls[0].userId, id); assert.equal(h.calls[0].jsonSchema.additionalProperties, false);
  assert.doesNotMatch(h.calls[0].systemPrompt, /Assembly on 03\/04/);
});
test('PDF and image use bounded raw bodies, with no filename or save operation', async t => {
  const h = await setup(t);
  const pdf = await h.request(`/extract-pdf?${query('holidays')}`, Buffer.from('%PDF-synthetic'), 'application/pdf');
  assert.equal(pdf.status, 200); assert.deepEqual(await pdf.json(), { destination: 'holidays', entries: [holiday], pageCount: 2 });
  const png = Buffer.alloc(45); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.writeUInt32BE(13, 8);
  png.write('IHDR', 12); png.writeUInt32BE(16, 16); png.writeUInt32BE(16, 20); png[24] = 8; png[25] = 2; png.write('IEND', 37);
  const image = await h.request(`/extract-image?${query('events')}`, png, 'image/png');
  assert.equal(image.status, 200); assert.deepEqual(await image.json(), { destination: 'events', entries: [event] });
  assert.equal(h.calls.at(-1).image.mimeType, 'image/png');
  assert.equal((await h.request(`/extract-image?${query('events')}`, Buffer.from('fake image'), 'image/png')).status, 400);
  assert.equal((await h.request(`/extract-image?${query('events')}`, Buffer.from('fake image'), 'image/svg+xml')).status, 415);
});
test('CSV text is extracted without a write and malformed Excel fails before provider generation', async t => {
  const h = await setup(t);
  const csv = await h.request(`/extract-csv?${query('events')}`, Buffer.from('Title,Date\nAssembly,28/03/2027'), 'text/csv');
  assert.equal(csv.status, 200);
  assert.deepEqual(await csv.json(), { destination: 'events', entries: [event] });
  assert.match(h.calls.at(-1).userContent, /Assembly \| 28\/03\/2027/);
  const before = h.calls.length;
  const malformed = await h.request(`/extract-xlsx?${query('events')}`, Buffer.from('not an archive'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(malformed.status, 422);
  assert.equal(h.calls.length, before);
  assert.doesNotMatch(JSON.stringify(await malformed.json()), /not an archive/);
  const compressed = Buffer.from(zipSync({ 'xl/worksheets/sheet1.xml': Buffer.alloc(300_000, 65) }));
  const unsafe = await h.request(`/extract-xlsx?${query('events')}`, compressed,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(unsafe.status, 422);
  assert.equal(h.calls.length, before, 'oversized expansion never reaches the AI provider');
});
test('invalid fields, duplicate query keys and malformed provider collection fail closed', async t => {
  const h = await setup(t, { generate: async () => ({ entries: [event, { ...event, title: '<script>' }] }) });
  for (const body of [
    { destination: 'events', text: 'x', ...year, provider: 'openai' },
    { destination: 'other', text: 'x', ...year },
    { destination: 'events', text: 'x', ...year, academicYearEndDate: '2027-02-30' },
  ]) assert.equal((await h.request('/extract', body)).status, 400);
  assert.equal((await h.request(`/extract-pdf?${query('events')}&destination=holidays`, Buffer.from('x'), 'application/pdf')).status, 400);
  const response = await h.request('/extract', { destination: 'events', text: 'PRIVATE_FIXTURE', ...year });
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify([await response.json(), h.logs]), /PRIVATE_FIXTURE|<script>/);
});
test('provider failures are redacted and retry can succeed after settlement', async t => {
  let count = 0;
  const h = await setup(t, { generate: async () => { if (++count === 1) throw Object.assign(Error('PRIVATE_UPSTREAM_FIXTURE'), { code: 'AI_PROVIDER_UNAVAILABLE' }); return { entries: [event] }; } });
  const body = { destination: 'events', text: 'Assembly', ...year };
  const failed = await h.request('/extract', body); assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify([await failed.json(), h.logs]), /PRIVATE_UPSTREAM_FIXTURE/);
  assert.equal((await h.request('/extract', body)).status, 200);
});
test('missing AI connection is a visible safe requirement, never a fabricated success', async t => {
  const h = await setup(t, { generate: async () => { throw Object.assign(Error('PRIVATE_VAULT_FIXTURE'), { code: 'AI_CREDENTIAL_UNAVAILABLE' }); } });
  const response = await h.request('/extract', { destination: 'events', text: 'Assembly', ...year });
  assert.equal(response.status, 409);
  const payload = await response.json(); assert.match(payload.message, /Connect an AI provider in Profile/);
  assert.doesNotMatch(JSON.stringify([payload, h.logs]), /PRIVATE_VAULT_FIXTURE/);
});
test('cancellation keeps the per-user lock until non-cooperative work actually settles', async t => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const h = await setup(t, { generate: (_input, { signal }) => ++calls === 1 ? new Promise(resolve => {
    release = resolve; started(signal);
  }) : Promise.resolve({ entries: [event] }) });
  const body = { destination: 'events', text: 'Assembly', ...year };
  const controller = new AbortController();
  const first = h.request('/extract', body, 'application/json', 'confirmed', { signal: controller.signal }).catch(() => null);
  const signal = await ready;
  controller.abort();
  if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  assert.equal((await h.request('/extract', body)).status, 409);
  release({ entries: [event] }); await first;
  assert.equal((await h.request('/extract', body)).status, 200);
});
