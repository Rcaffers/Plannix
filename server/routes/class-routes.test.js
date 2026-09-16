import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import test from 'node:test';
import express from 'express';
import { errorHandler } from '../middleware/errorHandler.js';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { requestId } from '../middleware/requestId.js';
import { registerClassRoutes } from './class-routes.js';

const requestIdValue = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';
const organisationId = '10000000-0000-4000-8000-000000000001';
const academicYearId = '20000000-0000-4000-8000-000000000001';
const firstClassId = '30000000-0000-4000-8000-000000000001';
const secondClassId = '30000000-0000-4000-8000-000000000002';
const generatedClassId = '30000000-0000-4000-8000-000000000003';
const token = 'safe.test.bearer';
const confirmedUser = {
  id: '40000000-0000-4000-8000-000000000001',
  email: 'hidden@example.test',
  email_confirmed_at: '2026-09-16T00:00:00Z',
};

class QueryBuilder {
  constructor(result, calls) {
    this.result = result;
    this.calls = calls;
  }

  select(...args) { this.calls.push(['select', ...args]); return this; }
  eq(...args) { this.calls.push(['eq', ...args]); return this; }
  order(...args) { this.calls.push(['order', ...args]); return this; }
  maybeSingle() {
    this.calls.push(['maybeSingle']);
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

async function createHarness({
  authUser = confirmedUser,
  authError = null,
  queryResult = {
    data: { id: academicYearId, classes_revision: 0, classes: [] },
    error: null,
  },
  rpcResult = {
    data: [{ revision: 1, classes: [] }],
    error: null,
  },
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
  registerClassRoutes({
    app,
    requireAuth,
    createRequestClient: (auth) => {
      clientCreations.push({ ...auth });
      return {
        from(table) {
          const calls = [];
          tableCalls.push({ table, calls });
          return new QueryBuilder(queryResult, calls);
        },
        async rpc(name, input) {
          rpcCalls.push({ name, input });
          if (rpcResult instanceof Error) throw rpcResult;
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
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
    clientCreations,
    tableCalls,
    rpcCalls,
  };
}

function headers(authorization = `Bearer ${token}`) {
  return {
    Authorization: authorization,
    'Content-Type': 'application/json',
    'X-Request-ID': requestIdValue,
  };
}

function classPath() {
  return `/api/classes?organisationId=${organisationId}&academicYearId=${academicYearId}`;
}

function validBody(overrides = {}) {
  return {
    organisationId,
    academicYearId,
    expectedRevision: 0,
    entries: [{ id: firstClassId, name: 'Mathematics', frequency: 5 }],
    ...overrides,
  };
}

test('missing, malformed, expired, and unconfirmed authentication are rejected', async () => {
  const cases = [
    { authorization: null, authError: null, authUser: confirmedUser, status: 401, message: 'Authentication is required.' },
    { authorization: 'Basic wrong', authError: null, authUser: confirmedUser, status: 401, message: 'Authentication is required.' },
    { authorization: `Bearer ${token}`, authError: { status: 401 }, authUser: null, status: 401, message: 'Authentication is required.' },
    { authorization: `Bearer ${token}`, authError: null, authUser: { ...confirmedUser, email_confirmed_at: null }, status: 403, message: 'Email confirmation is required.' },
  ];
  for (const item of cases) {
    const harness = await createHarness({ authError: item.authError, authUser: item.authUser });
    try {
      const requestHeaders = { Cookie: 'plannix_session=legacy', 'X-Request-ID': requestIdValue };
      if (item.authorization) requestHeaders.Authorization = item.authorization;
      const response = await fetch(`${harness.baseUrl}${classPath()}`, { headers: requestHeaders });
      assert.equal(response.status, item.status);
      assert.deepEqual(await response.json(), { message: item.message });
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
      assert.equal(harness.clientCreations.length, 0);
    } finally { await harness.close(); }
  }
});

test('duplicate Authorization headers and a legacy cookie alone are rejected', async () => {
  const harness = await createHarness();
  try {
    const cookieOnly = await fetch(`${harness.baseUrl}${classPath()}`, {
      headers: { Cookie: 'plannix_session=legacy', 'X-Request-ID': requestIdValue },
    });
    assert.equal(cookieOnly.status, 401);

    const port = Number(new URL(harness.baseUrl).port);
    const raw = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.end([
        `GET ${classPath()} HTTP/1.1`,
        'Host: 127.0.0.1',
        `Authorization: Bearer ${token}`,
        'Authorization: Bearer duplicate.token',
        `X-Request-ID: ${requestIdValue}`,
        'Connection: close', '', '',
      ].join('\r\n')));
      const chunks = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      socket.on('error', reject);
    });
    assert.match(raw, /^HTTP\/1\.1 401 /);
    assert.equal(harness.clientCreations.length, 0);
  } finally { await harness.close(); }
});

test('GET validates exact canonical UUID query parameters before creating a client', async () => {
  const harness = await createHarness();
  try {
    for (const path of [
      '/api/classes',
      `/api/classes?organisationId=${organisationId}`,
      `/api/classes?academicYearId=${academicYearId}`,
      `/api/classes?organisationId=AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA&academicYearId=${academicYearId}`,
      `/api/classes?organisationId=${organisationId}&academicYearId=invalid`,
      `${classPath()}&userId=${confirmedUser.id}`,
    ]) {
      const response = await fetch(`${harness.baseUrl}${path}`, { headers: headers() });
      assert.equal(response.status, 400, path);
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(harness.clientCreations.length, 0);
  } finally { await harness.close(); }
});

test('GET uses one race-free nested query and maps exact deterministic output', async () => {
  const harness = await createHarness({ queryResult: {
    data: {
      id: academicYearId,
      classes_revision: 7,
      classes: [
        { id: firstClassId, name: 'Alpha', frequency: 3, sort_order: 0, ignored: 'no' },
        { id: secondClassId, name: 'Beta', frequency: 5, sort_order: 1 },
      ],
    },
    error: null,
  } });
  try {
    const response = await fetch(`${harness.baseUrl}${classPath()}`, { headers: headers() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), requestIdValue);
    assert.deepEqual(await response.json(), {
      revision: 7,
      entries: [
        { id: firstClassId, name: 'Alpha', frequency: 3 },
        { id: secondClassId, name: 'Beta', frequency: 5 },
      ],
    });
    assert.equal(harness.tableCalls.length, 1);
    assert.equal(harness.tableCalls[0].table, 'plannix_academic_years');
    assert.match(harness.tableCalls[0].calls[0][1], /classes_revision/);
    assert.match(harness.tableCalls[0].calls[0][1], /fk_plannix_classes_academic_year/);
    assert.deepEqual(harness.tableCalls[0].calls.slice(-5), [
      ['eq', 'organisation_id', organisationId],
      ['eq', 'id', academicYearId],
      ['order', 'sort_order', { referencedTable: 'classes', ascending: true }],
      ['order', 'id', { referencedTable: 'classes', ascending: true }],
      ['maybeSingle'],
    ]);
    assert.equal(harness.clientCreations.length, 1);
    assert.equal(harness.clientCreations[0].accessToken, token);
  } finally { await harness.close(); }
});

test('GET returns an empty authoritative collection and creates a fresh client per request', async () => {
  const harness = await createHarness();
  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${harness.baseUrl}${classPath()}`, { headers: headers() });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { revision: 0, entries: [] });
    }
    assert.equal(harness.clientCreations.length, 2);
    assert.notStrictEqual(harness.clientCreations[0], harness.clientCreations[1]);
  } finally { await harness.close(); }
});

test('GET returns a safe 404 when RLS hides the academic year', async () => {
  const harness = await createHarness({ queryResult: { data: null, error: null } });
  try {
    const response = await fetch(`${harness.baseUrl}${classPath()}`, { headers: headers() });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { message: 'Academic year was not found.' });
    assert.equal(response.headers.get('x-request-id'), requestIdValue);
  } finally { await harness.close(); }
});

test('PUT validates the body completely before creating a client', async () => {
  const invalidBodies = [
    null,
    {},
    { organisationId, academicYearId, expectedRevision: 0 },
    { ...validBody(), userId: confirmedUser.id },
    { ...validBody(), email: confirmedUser.email },
    { ...validBody(), role: 'Organisation Admin' },
    { ...validBody(), cadence: 'week' },
    validBody({ organisationId: 'invalid' }),
    validBody({ academicYearId: 'invalid' }),
    validBody({ expectedRevision: -1 }),
    validBody({ expectedRevision: 1.5 }),
    validBody({ expectedRevision: Number.MAX_SAFE_INTEGER + 1 }),
    validBody({ entries: 'missing' }),
    validBody({ entries: Array.from({ length: 61 }, () => ({ name: 'Class', frequency: 1 })) }),
    validBody({ entries: [{ id: 'invalid', name: 'Class', frequency: 1 }] }),
    validBody({ entries: [{ name: '', frequency: 1 }] }),
    validBody({ entries: [{ name: 'x'.repeat(201), frequency: 1 }] }),
    validBody({ entries: [{ name: 'Class', frequency: 0 }] }),
    validBody({ entries: [{ name: 'Class', frequency: 51 }] }),
    validBody({ entries: [{ name: 'Class', frequency: 1.5 }] }),
    validBody({ entries: [{ name: 'Class', frequency: 1, sortOrder: 0 }] }),
    validBody({ entries: [{ name: 'Class', frequency: 1, cadence: 'week' }] }),
    validBody({ entries: [
      { id: firstClassId, name: 'A', frequency: 1 },
      { id: firstClassId, name: 'B', frequency: 1 },
    ] }),
    validBody({ entries: [
      { name: ' Same ', frequency: 1 },
      { name: 'Same', frequency: 2 },
    ] }),
  ];
  const harness = await createHarness();
  try {
    for (const body of invalidBodies) {
      const response = await fetch(`${harness.baseUrl}/api/classes`, {
        method: 'PUT', headers: headers(), body: JSON.stringify(body),
      });
      assert.equal(response.status, 400, JSON.stringify(body)?.slice(0, 100));
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(harness.clientCreations.length, 0);
    assert.equal(harness.rpcCalls.length, 0);
  } finally { await harness.close(); }
});

test('PUT maps only normalized fields to the RPC and returns authoritative IDs and order', async () => {
  const harness = await createHarness({ rpcResult: {
    data: [{ revision: 3, classes: [
      { id: generatedClassId, name: 'New class', frequency: 4, sortOrder: 0 },
      { id: firstClassId, name: 'Existing', frequency: 2 },
    ] }],
    error: null,
  } });
  try {
    const response = await fetch(`${harness.baseUrl}/api/classes`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(validBody({
        expectedRevision: 2,
        entries: [
          { name: ' New class ', frequency: 4 },
          { id: firstClassId, name: 'Existing', frequency: 2 },
        ],
      })),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), requestIdValue);
    assert.deepEqual(await response.json(), { revision: 3, entries: [
      { id: generatedClassId, name: 'New class', frequency: 4 },
      { id: firstClassId, name: 'Existing', frequency: 2 },
    ] });
    assert.deepEqual(harness.rpcCalls, [{
      name: 'plannix_save_classes',
      input: {
        target_organisation_id: organisationId,
        target_academic_year_id: academicYearId,
        expected_revision: 2,
        target_classes: [
          { name: 'New class', frequency: 4 },
          { id: firstClassId, name: 'Existing', frequency: 2 },
        ],
      },
    }]);
    assert.equal(harness.clientCreations.length, 1);
  } finally { await harness.close(); }
});

test('an explicitly empty collection is sent to the RPC but missing entries is rejected', async () => {
  const harness = await createHarness();
  try {
    const response = await fetch(`${harness.baseUrl}/api/classes`, {
      method: 'PUT', headers: headers(), body: JSON.stringify(validBody({ entries: [] })),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(harness.rpcCalls[0].input.target_classes, []);
  } finally { await harness.close(); }
});

test('stable RPC codes map to safe conflict and authorization responses', async () => {
  const cases = [
    ['40001', 409, 'Classes changed since they were loaded. Reload and try again.'],
    ['23503', 409, 'A class with timetable placements cannot be removed.'],
    ['42501', 403, 'You do not have permission to save classes.'],
    ['P0002', 404, 'Academic year was not found.'],
  ];
  for (const [code, status, message] of cases) {
    const harness = await createHarness({ rpcResult: {
      data: null,
      error: { code, message: 'internal class name and database detail' },
    } });
    try {
      const response = await fetch(`${harness.baseUrl}/api/classes`, {
        method: 'PUT', headers: headers(), body: JSON.stringify(validBody()),
      });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { message });
    } finally { await harness.close(); }
  }
});

test('service, unknown query, and malformed RPC results fail safely', async () => {
  const scenarios = [
    { options: { queryResult: { data: null, error: { status: 503, message: 'raw query failure' } } }, method: 'GET', status: 503, message: 'Class data is temporarily unavailable.' },
    { options: { queryResult: new TypeError('network URL and token') }, method: 'GET', status: 503, message: 'Class data is temporarily unavailable.' },
    { options: { rpcResult: { data: null, error: { status: 503, message: 'raw service failure' } } }, method: 'PUT', status: 503, message: 'Class data is temporarily unavailable.' },
    { options: { rpcResult: new TypeError('network URL and token') }, method: 'PUT', status: 503, message: 'Class data is temporarily unavailable.' },
    { options: { rpcResult: { data: [{ revision: 1, classes: [{ id: 'bad' }] }], error: null } }, method: 'PUT', status: 500, message: 'Could not save classes.' },
  ];
  for (const scenario of scenarios) {
    const harness = await createHarness(scenario.options);
    try {
      const response = await fetch(`${harness.baseUrl}${scenario.method === 'GET' ? classPath() : '/api/classes'}`, {
        method: scenario.method,
        headers: headers(),
        ...(scenario.method === 'PUT' ? { body: JSON.stringify(validBody()) } : {}),
      });
      assert.equal(response.status, scenario.status);
      assert.deepEqual(await response.json(), { message: scenario.message });
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    } finally { await harness.close(); }
  }
});

test('malformed and oversized JSON use central safe errors with request IDs', async () => {
  const harness = await createHarness();
  try {
    for (const [body, status, message] of [
      ['{"organisationId":', 400, 'Request body contains invalid JSON.'],
      [JSON.stringify({ value: 'x'.repeat(110000) }), 413, 'Request body is too large.'],
    ]) {
      const response = await fetch(`${harness.baseUrl}/api/classes`, {
        method: 'PUT', headers: headers(), body,
      });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { message });
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(harness.clientCreations.length, 0);
  } finally { await harness.close(); }
});

test('logs omit tokens, identity, class data, request bodies, and raw service errors', async () => {
  const captured = [];
  const original = console.error;
  console.error = (entry) => captured.push(String(entry));
  const harness = await createHarness({ rpcResult: {
    data: null,
    error: { status: 503, message: 'raw database endpoint failure' },
  } });
  try {
    const response = await fetch(`${harness.baseUrl}/api/classes`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(validBody({ entries: [{ name: 'Sensitive Class', frequency: 37 }] })),
    });
    assert.equal(response.status, 503);
    for (const line of captured) JSON.parse(line);
    const logs = captured.join('\n');
    for (const forbidden of [token, confirmedUser.email, 'Sensitive Class', 'raw database endpoint failure', organisationId]) {
      assert.equal(logs.includes(forbidden), false, forbidden);
    }
    assert.equal(logs.includes('frequency'), false);
    assert.equal(logs.includes(requestIdValue), true);
  } finally {
    await harness.close();
    console.error = original;
  }
});

test('production registers class routes exactly once and removes only legacy class dependencies', () => {
  const authServer = fs.readFileSync(new URL('../auth-server.js', import.meta.url), 'utf8');
  const planner = fs.readFileSync(new URL('./planner-routes.js', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('./class-routes.js', import.meta.url), 'utf8');
  const db = fs.readFileSync(new URL('../db.js', import.meta.url), 'utf8');
  assert.equal((authServer.match(/registerClassRoutes\(\{ app \}\)/g) || []).length, 1);
  assert.equal((routes.match(/app\.get\('\/api\/classes'/g) || []).length, 1);
  assert.equal((routes.match(/app\.put\('\/api\/classes'/g) || []).length, 1);
  assert.equal(planner.includes("'/api/classes'"), false);
  assert.equal(authServer.includes('mapClassRow'), false);
  assert.equal(db.includes('mapClassRow'), false);
  assert.equal(routes.includes('createDbPool'), false);
  assert.equal(routes.includes('adminClient'), false);
  assert.equal(routes.includes('SUPABASE_SECRET_KEY'), false);
  assert.equal(routes.includes('cadence'), false);
});
