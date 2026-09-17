import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import test from 'node:test';
import express from 'express';
import { errorHandler } from '../middleware/errorHandler.js';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { requestId } from '../middleware/requestId.js';
import { registerAcademicYearRoutes } from './academic-year-routes.js';

const requestIdValue = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';
const organisationId = '10000000-0000-4000-8000-000000000001';
const academicYearId = '20000000-0000-4000-8000-000000000001';
const holidayId = '30000000-0000-4000-8000-000000000001';
const token = 'safe.test.bearer';
const confirmedUser = {
  id: '40000000-0000-4000-8000-000000000001',
  email: 'hidden@example.test',
  email_confirmed_at: '2026-09-15T00:00:00Z',
};

class QueryBuilder {
  constructor(result, calls) {
    this.result = result;
    this.calls = calls;
  }

  select(...args) { this.calls.push(['select', ...args]); return this; }
  eq(...args) { this.calls.push(['eq', ...args]); return this; }
  order(...args) { this.calls.push(['order', ...args]); return this; }
  maybeSingle() { this.calls.push(['maybeSingle']); return Promise.resolve(this.result); }
  then(resolve, reject) { return Promise.resolve(this.result).then(resolve, reject); }
}

async function createHarness({
  authUser = confirmedUser,
  authError = null,
  tableResults = {},
  rpcResult = { data: academicYearId, error: null },
} = {}) {
  const clientCreations = [];
  const tableCalls = [];
  const rpcCalls = [];
  const requireAuth = createRequireSupabaseAuth({
    getClient: () => ({ auth: { getUser: async () => ({
      data: { user: authError ? null : authUser },
      error: authError,
    }) } }),
  });
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '100kb' }));
  registerAcademicYearRoutes({
    app,
    requireAuth,
    createRequestClient: (auth) => {
      clientCreations.push(auth);
      return {
        from(table) {
          const calls = [];
          tableCalls.push({ table, calls });
          const configured = tableResults[table];
          const result = typeof configured === 'function'
            ? configured(tableCalls.filter((entry) => entry.table === table).length - 1)
            : configured;
          return new QueryBuilder(result || { data: [], error: null }, calls);
        },
        async rpc(name, input) {
          rpcCalls.push({ name, input });
          return rpcResult;
        },
      };
    },
  });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return {
    clientCreations,
    tableCalls,
    rpcCalls,
    close: () => new Promise((resolve) => server.close(resolve)),
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

function headers(authorization = `Bearer ${token}`) {
  return {
    Authorization: authorization,
    'Content-Type': 'application/json',
    'X-Request-ID': requestIdValue,
  };
}

function validPlan(overrides = {}) {
  return {
    id: academicYearId,
    label: '2026 / 2027',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
    holidays: [{
      id: holidayId,
      label: 'Winter break',
      startDate: '2026-12-21',
      endDate: '2027-01-01',
    }],
    ...overrides,
  };
}

test('all routes require one valid confirmed bearer token and reject legacy cookies', async () => {
  const cases = [
    { authorization: null, expected: 401 },
    { authorization: 'Basic wrong', expected: 401 },
  ];
  for (const item of cases) {
    const harness = await createHarness();
    try {
      const requestHeaders = { Cookie: 'plannix_session=legacy', 'X-Request-ID': requestIdValue };
      if (item.authorization) requestHeaders.Authorization = item.authorization;
      const response = await fetch(`${harness.baseUrl}/api/academic-years?organisationId=${organisationId}`, {
        headers: requestHeaders,
      });
      assert.equal(response.status, item.expected);
      assert.deepEqual(await response.json(), { message: 'Authentication is required.' });
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
      assert.equal(harness.clientCreations.length, 0);
    } finally { await harness.close(); }
  }

  for (const [authUser, authError, status, message] of [
    [null, { status: 401 }, 401, 'Authentication is required.'],
    [{ ...confirmedUser, email_confirmed_at: null }, null, 403, 'Email confirmation is required.'],
  ]) {
    const harness = await createHarness({ authUser, authError });
    try {
      const response = await fetch(`${harness.baseUrl}/api/academic-years?organisationId=${organisationId}`, {
        headers: headers(),
      });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { message });
    } finally { await harness.close(); }
  }
});

test('duplicate Authorization headers are rejected through the HTTP stack', async () => {
  const harness = await createHarness();
  try {
    const port = Number(new URL(harness.baseUrl).port);
    const raw = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.end([
          `GET /api/academic-years?organisationId=${organisationId} HTTP/1.1`,
          'Host: 127.0.0.1',
          `Authorization: Bearer ${token}`,
          'Authorization: Bearer second.token',
          `X-Request-ID: ${requestIdValue}`,
          'Connection: close',
          '',
          '',
        ].join('\r\n'));
      });
      const chunks = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      socket.on('error', reject);
    });
    const [head, body] = raw.split('\r\n\r\n');
    assert.match(head, /^HTTP\/1\.1 401 /);
    assert.deepEqual(JSON.parse(body), { message: 'Authentication is required.' });
    assert.equal(harness.clientCreations.length, 0);
  } finally { await harness.close(); }
});

test('UUID and query validation occurs before creating a data client', async () => {
  const harness = await createHarness();
  try {
    for (const path of [
      '/api/academic-years',
      '/api/academic-years?organisationId=invalid',
      `/api/academic-years?organisationId=${organisationId}&userId=${confirmedUser.id}`,
      `/api/academic-year?organisationId=${organisationId}`,
      `/api/academic-year?organisationId=${organisationId}&academicYearId=invalid`,
      `/api/academic-year?organisationId=${organisationId}&academicYearId=${academicYearId}&email=x`,
    ]) {
      const response = await fetch(`${harness.baseUrl}${path}`, { headers: headers() });
      assert.equal(response.status, 400, path);
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(harness.clientCreations.length, 0);
  } finally { await harness.close(); }
});

test('list maps and requests deterministic academic-year ordering', async () => {
  const harness = await createHarness({
    tableResults: {
      plannix_academic_years: {
        data: [
          { id: academicYearId, name: 'Later', start_date: '2027-09-01', end_date: '2028-08-31' },
          { id: '20000000-0000-4000-8000-000000000002', name: 'Earlier', start_date: '2026-09-01', end_date: '2027-08-31' },
        ],
        error: null,
      },
    },
  });
  try {
    const response = await fetch(`${harness.baseUrl}/api/academic-years?organisationId=${organisationId}`, {
      headers: headers(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { academicYears: [
      { id: academicYearId, label: 'Later', startDate: '2027-09-01', endDate: '2028-08-31' },
      { id: '20000000-0000-4000-8000-000000000002', label: 'Earlier', startDate: '2026-09-01', endDate: '2027-08-31' },
    ] });
    assert.deepEqual(harness.tableCalls[0], {
      table: 'plannix_academic_years',
      calls: [
        ['select', 'id, name, start_date, end_date'],
        ['eq', 'organisation_id', organisationId],
        ['order', 'start_date', { ascending: false }],
        ['order', 'id', { ascending: true }],
      ],
    });
    assert.equal(harness.clientCreations.length, 1);
    assert.equal(harness.clientCreations[0].accessToken, token);
    const secondResponse = await fetch(`${harness.baseUrl}/api/academic-years?organisationId=${organisationId}`, {
      headers: headers(),
    });
    assert.equal(secondResponse.status, 200);
    assert.equal(harness.clientCreations.length, 2);
    assert.notStrictEqual(harness.clientCreations[0], harness.clientCreations[1]);
  } finally { await harness.close(); }
});

test('single plan maps exactly and orders holidays deterministically', async () => {
  const harness = await createHarness({ tableResults: {
    plannix_academic_years: { data: { id: academicYearId, name: 'Year', start_date: '2026-09-01', end_date: '2027-08-31' }, error: null },
    plannix_holidays: { data: [{ id: holidayId, name: 'Break', start_date: '2026-10-01', end_date: '2026-10-02' }], error: null },
  } });
  try {
    const response = await fetch(`${harness.baseUrl}/api/academic-year?organisationId=${organisationId}&academicYearId=${academicYearId}`, { headers: headers() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { plan: {
      id: academicYearId,
      label: 'Year',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      holidays: [{ id: holidayId, label: 'Break', startDate: '2026-10-01', endDate: '2026-10-02' }],
    } });
    assert.deepEqual(harness.tableCalls[1].calls.slice(-2), [
      ['order', 'start_date', { ascending: true }],
      ['order', 'id', { ascending: true }],
    ]);
    assert.equal(harness.clientCreations.length, 1);
  } finally { await harness.close(); }
});

test('an RLS-hidden year returns a safe 404', async () => {
  const harness = await createHarness({ tableResults: {
    plannix_academic_years: { data: null, error: null },
  } });
  try {
    const response = await fetch(`${harness.baseUrl}/api/academic-year?organisationId=${organisationId}&academicYearId=${academicYearId}`, { headers: headers() });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { message: 'Academic year was not found.' });
    assert.equal(response.headers.get('x-request-id'), requestIdValue);
  } finally { await harness.close(); }
});

test('PUT rejects unexpected identity fields and invalid plan variants before data access', async () => {
  const invalidBodies = [
    { organisationId, plan: validPlan(), userId: confirmedUser.id },
    { organisationId, plan: { ...validPlan(), email: confirmedUser.email } },
    { organisationId: 'invalid', plan: validPlan() },
    { organisationId, plan: validPlan({ id: 'invalid' }) },
    { organisationId, plan: validPlan({ label: ' ' }) },
    { organisationId, plan: validPlan({ label: 'x'.repeat(201) }) },
    { organisationId, plan: validPlan({ startDate: '2026-02-30' }) },
    { organisationId, plan: validPlan({ startDate: '2027-09-01', endDate: '2027-08-31' }) },
    { organisationId, plan: validPlan({ holidays: 'invalid' }) },
    { organisationId, plan: validPlan({ holidays: Array.from({ length: 101 }, () => ({})) }) },
    { organisationId, plan: validPlan({ holidays: [{ label: '', startDate: '2026-10-01', endDate: '2026-10-02' }] }) },
    { organisationId, plan: validPlan({ holidays: [{ label: 'Outside', startDate: '2027-09-01', endDate: '2027-09-02' }] }) },
    { organisationId, plan: validPlan({ holidays: [{ id: holidayId, label: 'A', startDate: '2026-10-01', endDate: '2026-10-02' }, { id: holidayId, label: 'B', startDate: '2026-11-01', endDate: '2026-11-02' }] }) },
  ];
  const harness = await createHarness();
  try {
    for (const body of invalidBodies) {
      const response = await fetch(`${harness.baseUrl}/api/academic-year`, {
        method: 'PUT', headers: headers(), body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(harness.clientCreations.length, 0);
    assert.equal(harness.rpcCalls.length, 0);
  } finally { await harness.close(); }
});

test('PUT maps exact RPC input and returns the authoritative UUID', async () => {
  const harness = await createHarness();
  try {
    const response = await fetch(`${harness.baseUrl}/api/academic-year`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ organisationId, plan: validPlan() }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, academicYearId });
    assert.deepEqual(harness.rpcCalls, [{
      name: 'plannix_save_academic_year',
      input: {
        target_organisation_id: organisationId,
        target_academic_year_id: academicYearId,
        target_name: '2026 / 2027',
        target_start_date: '2026-09-01',
        target_end_date: '2027-08-31',
        target_holidays: [{ id: holidayId, name: 'Winter break', start_date: '2026-12-21', end_date: '2027-01-01' }],
      },
    }]);
    assert.equal(harness.clientCreations.length, 1);
    assert.deepEqual(Object.keys(harness.clientCreations[0]).sort(), ['accessToken', 'email', 'userId']);
  } finally { await harness.close(); }
});

test('PostgREST and RPC failures are safe and logs omit sensitive inputs', async () => {
  const captured = [];
  const original = console.error;
  console.error = (entry) => captured.push(String(entry));
  try {
    const harness = await createHarness({
      tableResults: { plannix_academic_years: { data: null, error: { message: 'raw database failure' } } },
      rpcResult: { data: null, error: { message: 'raw RPC failure' } },
    });
    try {
      const list = await fetch(`${harness.baseUrl}/api/academic-years?organisationId=${organisationId}`, { headers: headers() });
      assert.equal(list.status, 500);
      assert.deepEqual(await list.json(), { message: 'Could not load academic years.' });
      const save = await fetch(`${harness.baseUrl}/api/academic-year`, {
        method: 'PUT', headers: headers(), body: JSON.stringify({ organisationId, plan: validPlan() }),
      });
      assert.equal(save.status, 500);
      assert.deepEqual(await save.json(), { message: 'Could not save the academic year.' });
      for (const entry of captured) JSON.parse(entry);
      const logs = captured.join('\n');
      for (const forbidden of [token, confirmedUser.email, '2026 / 2027', '2026-09-01', 'raw database failure', 'raw RPC failure']) {
        assert.equal(logs.includes(forbidden), false);
      }
      assert.equal(logs.includes(requestIdValue), true);
    } finally { await harness.close(); }
  } finally { console.error = original; }
});

test('malformed and oversized JSON use central safe errors with request IDs', async () => {
  const harness = await createHarness();
  try {
    for (const [body, expectedStatus, expectedMessage] of [
      ['{"organisationId":', 400, 'Request body contains invalid JSON.'],
      [JSON.stringify({ value: 'x'.repeat(110000) }), 413, 'Request body is too large.'],
    ]) {
      const response = await fetch(`${harness.baseUrl}/api/academic-year`, {
        method: 'PUT', headers: headers(), body,
      });
      assert.equal(response.status, expectedStatus);
      assert.deepEqual(await response.json(), { message: expectedMessage });
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(harness.clientCreations.length, 0);
  } finally { await harness.close(); }
});

test('production registers each new route once and removes only legacy academic-year handlers', () => {
  const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('./academic-year-routes.js', import.meta.url), 'utf8');
  assert.equal((appSource.match(/registerAcademicYearRoutes\(\{ app \}\)/g) || []).length, 1);
  assert.equal((routes.match(/app\.get\('\/api\/academic-years'/g) || []).length, 1);
  assert.equal((routes.match(/app\.get\('\/api\/academic-year'/g) || []).length, 1);
  assert.equal((routes.match(/app\.put\('\/api\/academic-year'/g) || []).length, 1);
  assert.equal(appSource.includes('planner-routes.js'), false);
  assert.equal(routes.includes('createDbPool'), false);
  assert.equal(routes.includes('adminClient'), false);
  assert.equal(routes.includes('SUPABASE_SECRET_KEY'), false);
});
