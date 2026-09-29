import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolidayPdfExtractionApi, pdfFileError } from './holidayPdfExtractionApi.js';
const file = new File(['Synthetic PDF'], 'local-only.pdf', { type: 'application/pdf' });
const input = { file, academicYearStartDate: '2026-09-01', academicYearEndDate: '2027-08-31' };
const holiday = { label: 'Closure', startDate: '2026-12-25', endDate: '2026-12-25' };
const payload = { holidays: [holiday], pageCount: 1 };
const getSession = async () => ({ access_token: 'synthetic-test-session' });
const response = (body = payload, status = 200) => new Response(JSON.stringify(body), { status });
test('PDF raw File, boundaries only in URL, auth/no-cache/signal; closed result', async () => {
  const controller = new AbortController();
  const extract = createHolidayPdfExtractionApi({ getSession, fetchImpl: async (url, options) => {
    assert.ok(url.endsWith('/api/ai/holidays/extract-pdf?boundaryStart=2026-09-01&boundaryEnd=2027-08-31'));
    assert.equal(options.body, file); assert.equal(options.headers['Content-Type'], 'application/pdf'); assert.equal(options.headers.Authorization, 'Bearer synthetic-test-session');
    assert.equal(options.signal, controller.signal); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.doesNotMatch(url, /local-only/);
    return response();
  } });
  assert.deepEqual(await extract(input, { signal: controller.signal }), payload);
});
for (const bad of [null, new Blob([]), new Blob(['x'], { type: 'text/plain' }), new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])]) test('invalid file rejected before session/network', async () => {
  const extract = createHolidayPdfExtractionApi({ getSession: () => assert.fail('auth'), fetchImpl: () => assert.fail('network') });
  await assert.rejects(extract({ ...input, file: bad }), error => error.status === 400);
});
test('exact size and unknown MIME accepted for authoritative server validation', () => {
  assert.equal(pdfFileError(new Blob([new Uint8Array(10 * 1024 * 1024)])), '');
});
for (const bad of [null, {}, { ...payload, text: 'PRIVATE' }, { ...payload, pageCount: 0 }, { ...payload, pageCount: 51 }, { ...payload, pageCount: '1' }, { ...payload, holidays: [{ ...holiday, provider: 'x' }] }, { ...payload, holidays: [{ ...holiday, startDate: 'bad' }] }, { ...payload, holidays: Array(101).fill(holiday) }]) test('malformed response is rejected without content', async () => {
  const extract = createHolidayPdfExtractionApi({ getSession, fetchImpl: async () => response(bad) });
  await assert.rejects(extract(input), error => error.status === 502 && !error.message.includes('PRIVATE') && !error.cause);
});
for (const status of [400, 401, 403, 409, 413, 415, 422, 429, 500, 502, 503, 504]) test(`safe error ${status}`, async () => {
  const extract = createHolidayPdfExtractionApi({ getSession, fetchImpl: async () => response({ message: 'PRIVATE_UPSTREAM' }, status) });
  await assert.rejects(extract(input), error => error.status === status && !error.message.includes('PRIVATE') && !error.cause);
});
test('application attempt limit and provider rate limit stay distinct', async () => {
  for (const message of ['Too many holiday extraction attempts. Please try again later.', 'AI provider rate limit reached. Please try again later.']) {
    await assert.rejects(createHolidayPdfExtractionApi({ getSession, fetchImpl: async () => response({ message }, 429) })(input), error => error.message === message);
  }
});
test('missing connection, missing authentication, cancellation before/after session and response', async () => {
  await assert.rejects(createHolidayPdfExtractionApi({ getSession, fetchImpl: async () => response({ message: 'Connect an AI provider in Profile before extracting holidays.' }, 409) })(input), error => error.reason === 'connection');
  await assert.rejects(createHolidayPdfExtractionApi({ getSession: async () => null, fetchImpl: () => assert.fail('network') })(input), error => error.status === 401);
  for (const phase of ['before', 'session', 'response']) {
    const controller = new AbortController(); if (phase === 'before') controller.abort();
    const extract = createHolidayPdfExtractionApi({ getSession: async () => { if (phase === 'session') controller.abort(); return getSession(); }, fetchImpl: async () => { assert.equal(phase, 'response'); controller.abort(); return response(); } });
    await assert.rejects(extract(input, { signal: controller.signal }), error => error.name === 'AbortError');
  }
});
