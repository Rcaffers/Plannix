import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHolidayExtractionApi } from './holidayExtractionApi.js';
const input = { text: 'Synthetic school calendar text', academicYearStartDate: '2026-09-01', academicYearEndDate: '2027-08-31' };
const holiday = { label: 'Autumn break', startDate: '2026-10-20', endDate: '2026-10-28' };
const reference = '00000000-0000-4000-8000-000000000001';
const response = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), { status, headers });
const session = async () => ({ access_token: 'synthetic-session-fixture' });
test('authenticated exact payload, no cache, signal, safe response', async () => {
  let calls = 0; const controller = new AbortController();
  const extract = createHolidayExtractionApi({ getSession: session, fetchImpl: async (url, options) => {
    calls++; assert.ok(url.endsWith('/api/ai/holidays/extract')); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-session-fixture'); assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store'); assert.equal(options.signal, controller.signal); assert.deepEqual(JSON.parse(options.body), input);
    return response({ holidays: [holiday] });
  } });
  assert.deepEqual(await extract(input, { signal: controller.signal }), [holiday]); assert.equal(calls, 1);
});
for (const patch of [{ provider: 'openai' }, { text: '' }, { text: ' ' }, { text: 'a'.repeat(50001) }, { text: 'é'.repeat(25001) }, { academicYearStartDate: '' }, { academicYearEndDate: '2027-02-30' }, { academicYearEndDate: '2029-01-01' }]) {
  test(`invalid request rejected before auth/network: ${Object.keys(patch)[0]} ${typeof patch.text === 'string' ? patch.text.length : ''}`, async () => {
    let calls = 0; const extract = createHolidayExtractionApi({ getSession: async () => { calls++; }, fetchImpl: async () => { calls++; } });
    await assert.rejects(extract({ ...input, ...patch }), error => error.status === 400); assert.equal(calls, 0);
  });
}
for (const status of [400, 401, 403, 409, 413, 422, 429, 502, 503, 504, 500]) {
  test(`safe status ${status}, support reference and no retries`, async () => {
    let calls = 0;
    const extract = createHolidayExtractionApi({ getSession: session, fetchImpl: async () => { calls++; return response({ message: 'SENSITIVE upstream text' }, status, { 'x-request-id': reference, 'retry-after': '30' }); } });
    await assert.rejects(extract(input), error => { assert.equal(error.status, status); assert.equal(error.requestId, reference); assert.ok(!error.message.includes('SENSITIVE')); assert.equal(error.cause, undefined); if (status === 429) assert.equal(error.retryAfter, 30); return true; }); assert.equal(calls, 1);
  });
}
test('missing connection distinguished from busy response', async () => {
  const extract = createHolidayExtractionApi({ getSession: session, fetchImpl: async () => response({ message: 'Connect an AI provider in Profile before extracting holidays.' }, 409) });
  await assert.rejects(extract(input), error => error.reason === 'connection');
});
for (const payload of [null, {}, { holidays: [], key: 'unexpected' }, { holidays: 'bad' }, { holidays: [{ ...holiday, id: 'bad' }] }, { holidays: [{ ...holiday, label: 42 }] }, { holidays: Array(101).fill(holiday) }]) {
  test('malformed response fails closed', async () => {
    const extract = createHolidayExtractionApi({ getSession: session, fetchImpl: async () => response(payload) });
    await assert.rejects(extract(input), error => error.status === 502);
  });
}
test('zero suggestions, non-JSON, aborted/auth failures and sanitized references', async () => {
  assert.deepEqual(await createHolidayExtractionApi({ getSession: session, fetchImpl: async () => response({ holidays: [] }) })(input), []);
  await assert.rejects(createHolidayExtractionApi({ getSession: session, fetchImpl: async () => new Response('<html>private proxy error</html>') })(input), /safely read/);
  await assert.rejects(createHolidayExtractionApi({ getSession: async () => null, fetchImpl: () => assert.fail('network') })(input), error => error.status === 401);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createHolidayExtractionApi({ getSession: () => assert.fail('auth'), fetchImpl: () => assert.fail('network') })(input, { signal: controller.signal }), error => error.name === 'AbortError');
  await assert.rejects(createHolidayExtractionApi({ getSession: session, fetchImpl: async () => response({}, 500, { 'x-request-id': 'private text' }) })(input), error => !error.requestId);
});
test('client boundary contains no storage, server imports, Vault or extra save route', async () => {
  const paths = ['src/components/SchoolHolidayAiImport.jsx', 'src/utils/holidayExtractionApi.js', 'src/utils/holidayReview.js'];
  for (const path of paths) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|server\/ai|vault|apiKey|\.rpc\(|\.from\(/);
  }
});
test('exact multibyte byte limit accepted, unexpected failures sanitized and in-flight cancellation propagated', async () => {
  const extract = createHolidayExtractionApi({ getSession: session, fetchImpl: async () => response({ holidays: [] }) });
  assert.deepEqual(await extract({ ...input, text: 'é'.repeat(25000) }), []);
  await assert.rejects(createHolidayExtractionApi({ getSession: session, fetchImpl: async () => { throw new Error('SENSITIVE upstream failure'); } })(input), error => !error.message.includes('SENSITIVE') && error.cause === undefined);
  const controller = new AbortController();
  const cancelled = createHolidayExtractionApi({ getSession: session, fetchImpl: async () => { controller.abort(); throw new Error('SENSITIVE abort'); } });
  await assert.rejects(cancelled(input, { signal: controller.signal }), error => error.name === 'AbortError' && !error.message.includes('SENSITIVE'));
});
