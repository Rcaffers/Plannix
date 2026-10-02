import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportPreviewApi, importSourceError } from './importPreviewApi.js';
const year = { academicYearStartDate: '2026-09-01', academicYearEndDate: '2027-08-31' };
const event = { title: 'Assembly', date: '', sourceDate: '03/04/2027', allDay: false,
  startTime: '', endTime: '', location: '', notes: '' };
const file = new Blob(['%PDF-synthetic'], { type: 'application/pdf' });
test('text, PDF, image, CSV and Excel previews use only authenticated extraction endpoints', async () => {
  const calls = [];
  const extract = createImportPreviewApi({ getSession: async () => ({ access_token: 'synthetic-session' }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const destination = url.includes('destination=holidays') ? 'holidays' : 'events';
      return new Response(JSON.stringify({ destination, entries: destination === 'events' ? [event] : [],
        ...(url.includes('extract-pdf') ? { pageCount: 2 } : {}) }), { headers: { 'Content-Type': 'application/json' } });
    } });
  assert.equal((await extract({ destination: 'events', mode: 'text', text: 'Assembly', ...year })).entries.length, 1);
  assert.equal((await extract({ destination: 'holidays', mode: 'pdf', file, ...year })).pageCount, 2);
  await extract({ destination: 'events', mode: 'image', file: new Blob(['image'], { type: 'image/png' }), ...year });
  await extract({ destination: 'events', mode: 'csv', file: new File(['Event,Date'], 'calendar.csv', { type: 'text/csv' }), ...year });
  await extract({ destination: 'events', mode: 'xlsx', file: new File(['fixture'], 'calendar.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), ...year });
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.options.method === 'POST' && call.options.headers.Authorization === 'Bearer synthetic-session'
    && call.options.credentials === 'omit' && !/\/api\/(?:events|academic-year)/.test(call.url)));
  assert.equal(calls[1].options.body, file);
  assert.match(calls[3].url, /extract-csv/);
  assert.match(calls[4].url, /extract-xlsx/);
});
test('whole response is rejected on malformed output and raw provider messages are never displayed', async () => {
  const base = { destination: 'events', mode: 'text', text: 'Assembly', ...year };
  const malformed = createImportPreviewApi({ getSession: async () => ({ access_token: 'synthetic-session' }),
    fetchImpl: async () => new Response(JSON.stringify({ destination: 'events', entries: [event, { ...event, title: '<script>' }] })) });
  await assert.rejects(malformed(base), /safely read/);
  const failed = createImportPreviewApi({ getSession: async () => ({ access_token: 'synthetic-session' }),
    fetchImpl: async () => new Response(JSON.stringify({ message: 'PRIVATE_UPSTREAM_FIXTURE', code: 'AI_RATE_LIMITED' }),
      { status: 429, headers: { 'retry-after': '30' } }) });
  await assert.rejects(failed(base), error => error.message.includes('provider is currently rate limiting')
    && !error.message.includes('PRIVATE_') && error.retryAfter === 30);
});
test('file and text limits reject before session lookup', async () => {
  let lookups = 0;
  const extract = createImportPreviewApi({ getSession: async () => { lookups++; return null; }, fetchImpl: () => { throw Error('Network disabled'); } });
  await assert.rejects(extract({ destination: 'events', mode: 'text', text: 'x'.repeat(50001), ...year }), /50,000/);
  await assert.rejects(extract({ destination: 'events', mode: 'pdf', file: new Blob(['x'], { type: 'image/png' }), ...year }), /PDF/);
  assert.equal(lookups, 0);
  assert.match(importSourceError({ mode: 'image', file: new Blob(['x'], { type: 'image/svg+xml' }) }), /PNG or JPEG/);
  assert.match(importSourceError({ mode: 'xlsx', file: new File(['x'], 'calendar.xls', { type: 'application/octet-stream' }) }), /Excel/);
});
