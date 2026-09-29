import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolidayExtractionApi } from './holidayExtractionApi.js';
import { createHolidayPdfExtractionApi } from './holidayPdfExtractionApi.js';
const reference = '91000000-0000-4000-8000-000000000001';
const boundaries = { academicYearStartDate: '2026-09-01', academicYearEndDate: '2027-08-31' };
for (const [code, expected] of [
  ['HOLIDAY_ATTEMPT_LIMIT', 'Too many holiday extraction attempts. Please wait before trying again.'],
  ['AI_RATE_LIMITED', 'Your AI provider is currently rate limiting requests. Please try again later.'],
  ['unknown', 'Holiday extraction is temporarily rate limited. Please try again later.'],
  [undefined, 'Holiday extraction is temporarily rate limited. Please try again later.'],
  [{ unsafe: true }, 'Holiday extraction is temporarily rate limited. Please try again later.'],
]) for (const retry of ['30', '0', '-1', 'private', '9999999']) test('text/PDF safe rate parity ' + JSON.stringify(code) + ' retry ' + retry, async () => {
  const deps = { getSession: async () => ({ access_token: 'synthetic-session' }), fetchImpl: async () => new Response(JSON.stringify({ code, message: 'PRIVATE_UPSTREAM' }), {
    status: 429, headers: { 'retry-after': retry, 'x-request-id': reference },
  }) };
  for (const [create, input] of [[createHolidayExtractionApi, { ...boundaries, text: 'Synthetic calendar' }],
    [createHolidayPdfExtractionApi, { ...boundaries, file: new Blob(['synthetic'], { type: 'application/pdf' }) }]]) {
    await assert.rejects(create(deps)(input), error => {
      assert.equal(error.message, expected); assert.equal(error.status, 429);
      assert.equal(error.requestId, reference); assert.equal(error.cause, undefined);
      assert.equal(error.retryAfter, /^\d{1,6}$/.test(retry) ? Number(retry) : undefined);
      return true;
    });
  }
});
