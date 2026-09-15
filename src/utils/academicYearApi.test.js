import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, createAcademicYearApi } from './api.js';

const org = '20000000-0000-4000-8000-000000000001';
const year = '40000000-0000-4000-8000-000000000001';
const holiday = '50000000-0000-4000-8000-000000000001';
const requestId = '60000000-0000-4000-8000-000000000001';

function response(payload, { ok = true, status = 200, id = requestId } = {}) {
  return { ok, status, headers: { get: (name) => name.toLowerCase() === 'x-request-id' ? id : null }, async json() { return payload; } };
}

test('academic-year requests use validated bearer sessions and omit cookies', async () => {
  const calls = [];
  const api = createAcademicYearApi({
    getSession: async () => ({ access_token: 'private-token' }),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ academicYears: [] }); },
  });
  const result = await api.list(org);
  assert.deepEqual(result, { academicYears: [], requestId });
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-token');
  assert.match(calls[0].url, new RegExp(`organisationId=${org}`));
});

test('list and load retain only approved fields and canonical support references', async () => {
  const results = [
    response({ academicYears: [{ id: year, label: 'Year', startDate: '2026-09-01', endDate: '2027-08-31', secret: 'no' }] }),
    response({ plan: { id: year, label: 'Year', startDate: '2026-09-01', endDate: '2027-08-31', secret: 'no', holidays: [{ id: holiday, label: 'Half term', startDate: '2026-10-20', endDate: '2026-10-24', secret: 'no' }] } }, { id: 'INVALID' }),
  ];
  const api = createAcademicYearApi({ getSession: async () => ({ access_token: 'token' }), fetchImpl: async () => results.shift() });
  assert.deepEqual((await api.list(org)).academicYears[0], { id: year, label: 'Year', startDate: '2026-09-01', endDate: '2027-08-31' });
  assert.deepEqual(await api.load(org, year), {
    plan: { id: year, label: 'Year', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [{ id: holiday, label: 'Half term', startDate: '2026-10-20', endDate: '2026-10-24' }] },
    requestId: null,
  });
});

test('save sends the selected organisation and preserves IDs while accepting the authoritative ID', async () => {
  let body;
  const plan = { id: year, label: 'Year', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [{ id: holiday, label: 'Break', startDate: '2026-10-01', endDate: '2026-10-02' }] };
  const api = createAcademicYearApi({
    getSession: async () => ({ access_token: 'token' }),
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return response({ ok: true, academicYearId: year }); },
  });
  assert.deepEqual(await api.save(org, plan), { academicYearId: year, requestId });
  assert.deepEqual(body, { organisationId: org, plan });
});

test('invalid UUIDs fail before fetch and failures expose only safe message and canonical request ID', async () => {
  let calls = 0;
  const api = createAcademicYearApi({
    getSession: async () => ({ access_token: 'token' }),
    fetchImpl: async () => { calls += 1; return response({ message: 'Safe failure', internal: 'secret' }, { ok: false, status: 500 }); },
  });
  await assert.rejects(() => api.list('not-a-uuid'), ApiError);
  assert.equal(calls, 0);
  await assert.rejects(() => api.list(org), (error) => error.message === 'Safe failure' && error.requestId === requestId && !String(error).includes('secret'));
});

test('a missing session never makes a data request', async () => {
  let fetched = false;
  const api = createAcademicYearApi({ getSession: async () => null, fetchImpl: async () => { fetched = true; } });
  await assert.rejects(() => api.list(org), /Authentication is required/);
  assert.equal(fetched, false);
});
