import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import test from 'node:test';
import express from 'express';
import { errorHandler } from '../middleware/errorHandler.js';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { requestId } from '../middleware/requestId.js';
import { registerTimetableLayoutRoutes, validateTimetableLayoutBody } from './timetable-layout-routes.js';

const requestIdValue = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';
const organisationId = '10000000-0000-4000-8000-000000000001';
const academicYearId = '20000000-0000-4000-8000-000000000001';
const timetableId = '30000000-0000-4000-8000-000000000001';
const weekAId = '40000000-0000-4000-8000-000000000001';
const weekBId = '40000000-0000-4000-8000-000000000002';
const periodOneId = '50000000-0000-4000-8000-000000000001';
const breakId = '50000000-0000-4000-8000-000000000002';
const token = 'safe.test.bearer';
const confirmedUser = { id: '60000000-0000-4000-8000-000000000001', email: 'hidden@example.test', email_confirmed_at: '2026-09-17' };

class QueryBuilder {
  constructor(result, calls) { this.result = result; this.calls = calls; }
  select(...args) { this.calls.push(['select', ...args]); return this; }
  eq(...args) { this.calls.push(['eq', ...args]); return this; }
  order(...args) { this.calls.push(['order', ...args]); return this; }
  maybeSingle() { this.calls.push(['maybeSingle']); return Promise.resolve(this.result); }
}

function row(overrides = {}) {
  return {
    id: timetableId, name: 'Main timetable', cadence: 'two-week',
    school_start_time: '09:00:00', teaching_period_minutes: 60, layout_revision: 2,
    weeks: [{ id: weekBId, code: 'B', name: 'Week B', sort_order: 1 }, { id: weekAId, code: 'A', name: 'Week A', sort_order: 0 }],
    periods: [
      { id: breakId, period_type: 'break', period_number: null, label: 'Break 1', start_time: '10:00:00', end_time: '10:15:00', sort_order: 1, is_enabled: true, is_visible: false },
      { id: periodOneId, period_type: 'teaching', period_number: 1, label: 'Period 1', start_time: '09:00:00', end_time: '10:00:00', sort_order: 0, is_enabled: true, is_visible: true },
    ],
    ...overrides,
  };
}

function body(overrides = {}) {
  return {
    organisationId, academicYearId, expectedRevision: 0,
    layout: {
      name: ' Main timetable ', cycle: 'one-week', periodsPerDay: 2,
      periodLengthMinutes: 60, schoolStartTime: '09:00',
      registration: { enabled: false, startTime: '08:40', lengthMinutes: 15 },
      breaks: [{ id: breakId, startTime: '10:00', lengthMinutes: 15 }],
      lunch: { startTime: '12:30', lengthMinutes: 0 },
      showBreaksInTimetable: false, showLunchInTimetable: false,
    },
    ...overrides,
  };
}

async function harness({ authUser = confirmedUser, authError = null, queryResult = { data: row(), error: null }, rpcResult } = {}) {
  const clientCreations = []; const tableCalls = []; const rpcCalls = [];
  const requireAuth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async () => ({ data: { user: authError ? null : authUser }, error: authError }) } }) });
  const app = express(); app.use(requestId); app.use(express.json({ limit: '100kb' }));
  registerTimetableLayoutRoutes({ app, requireAuth, createRequestClient(auth) {
    clientCreations.push({ ...auth });
    return {
      from(table) { const calls = []; tableCalls.push({ table, calls }); return new QueryBuilder(queryResult, calls); },
      async rpc(name, input) {
        rpcCalls.push({ name, input });
        if (rpcResult) return rpcResult;
        return { data: [{
          timetable_id: timetableId, revision: 1,
          weeks: [{ id: weekAId, code: 'A', name: 'Week A' }],
          periods: input.target_layout.periods.map((period, index) => ({ ...period, id: period.id || `50000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}` })),
        }], error: null };
      },
    };
  } });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)), clientCreations, tableCalls, rpcCalls };
}

const headers = (authorization = `Bearer ${token}`) => ({ Authorization: authorization, 'Content-Type': 'application/json', 'X-Request-ID': requestIdValue });
const routePath = (extra = '') => `/api/timetable/layout?organisationId=${organisationId}&academicYearId=${academicYearId}${extra}`;

test('missing, malformed, expired, unconfirmed, cookie-only and duplicate authentication are rejected', async () => {
  for (const item of [
    { authorization: null, status: 401 }, { authorization: 'Basic nope', status: 401 },
    { authorization: `Bearer ${token}`, authError: { status: 401 }, status: 401 },
    { authorization: `Bearer ${token}`, authUser: { ...confirmedUser, email_confirmed_at: null }, status: 403 },
  ]) {
    const instance = await harness(item);
    try {
      const requestHeaders = { Cookie: 'plannix_session=legacy', 'X-Request-ID': requestIdValue };
      if (item.authorization) requestHeaders.Authorization = item.authorization;
      const response = await fetch(`${instance.baseUrl}${routePath()}`, { headers: requestHeaders });
      assert.equal(response.status, item.status); assert.equal(response.headers.get('x-request-id'), requestIdValue); assert.equal(instance.clientCreations.length, 0);
    } finally { await instance.close(); }
  }
  const instance = await harness();
  try {
    const port = Number(new URL(instance.baseUrl).port);
    const raw = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.end([`GET ${routePath()} HTTP/1.1`, 'Host: localhost', `Authorization: Bearer ${token}`, 'Authorization: Bearer duplicate', 'Connection: close', '', ''].join('\r\n')));
      const chunks = []; socket.on('data', (chunk) => chunks.push(chunk)); socket.on('end', () => resolve(Buffer.concat(chunks).toString())); socket.on('error', reject);
    });
    assert.match(raw, /^HTTP\/1\.1 401 /);
  } finally { await instance.close(); }
});

test('GET validates UUIDs and exact query fields before creating a client', async () => {
  const instance = await harness();
  try {
    for (const path of ['/api/timetable/layout', `/api/timetable/layout?organisationId=${organisationId}`, `${routePath()}&timetableId=bad`, `${routePath()}&userId=${confirmedUser.id}`]) {
      const response = await fetch(`${instance.baseUrl}${path}`, { headers: headers() });
      assert.equal(response.status, 400); assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(instance.clientCreations.length, 0);
  } finally { await instance.close(); }
});

test('GET uses one nested snapshot query and maps deterministic public fields', async () => {
  const instance = await harness();
  try {
    const response = await fetch(`${instance.baseUrl}${routePath()}`, { headers: headers() });
    assert.equal(response.status, 200);
    const result = (await response.json()).layout;
    assert.equal(result.timetableId, timetableId); assert.equal(result.revision, 2);
    assert.deepEqual(result.weeks.map((week) => week.code), ['A', 'B']);
    assert.deepEqual(result.periods.map((period) => period.type), ['teaching', 'break']);
    assert.equal(result.showBreaksInTimetable, false);
    assert.equal(instance.tableCalls.length, 1); assert.match(instance.tableCalls[0].calls[0][1], /plannix_timetable_weeks/); assert.match(instance.tableCalls[0].calls[0][1], /plannix_timetable_periods/);
    assert.ok(instance.tableCalls[0].calls.some((call) => call[0] === 'eq' && call[1] === 'is_default' && call[2] === true));
  } finally { await instance.close(); }
});

test('GET no-default and explicit hidden behavior are safe and request-scoped', async () => {
  const instance = await harness({ queryResult: { data: null, error: null } });
  try {
    const missingDefault = await fetch(`${instance.baseUrl}${routePath()}`, { headers: headers() });
    assert.deepEqual(await missingDefault.json(), { layout: null });
    const hidden = await fetch(`${instance.baseUrl}${routePath(`&timetableId=${timetableId}`)}`, { headers: headers() });
    assert.equal(hidden.status, 404); assert.equal(instance.clientCreations.length, 2);
    assert.ok(instance.tableCalls[1].calls.some((call) => call[0] === 'eq' && call[1] === 'id' && call[2] === timetableId));
  } finally { await instance.close(); }
});

test('PUT validation enforces exact fields, identifiers, boundaries, times and duplicate IDs', () => {
  const invalid = [
    { userId: confirmedUser.id }, { expectedRevision: -1 }, { timetableId: 'bad' },
    { layout: { ...body().layout, role: 'admin' } }, { layout: { ...body().layout, name: ' '.repeat(2) } },
    { layout: { ...body().layout, cycle: 'three-week' } }, { layout: { ...body().layout, periodsPerDay: 0 } }, { layout: { ...body().layout, periodsPerDay: 13 } },
    { layout: { ...body().layout, periodLengthMinutes: 19 } }, { layout: { ...body().layout, periodLengthMinutes: 121 } }, { layout: { ...body().layout, schoolStartTime: '9:00' } },
    { layout: { ...body().layout, breaks: Array.from({ length: 7 }, () => ({ startTime: '10:00', lengthMinutes: 5 })) } },
    { layout: { ...body().layout, registration: { enabled: false, startTime: '08:40', lengthMinutes: 4 } } },
    { layout: { ...body().layout, lunch: { startTime: '12:30', lengthMinutes: 181 } } },
    { layout: { ...body().layout, registration: { id: breakId, enabled: false, startTime: '08:40', lengthMinutes: 15 } } },
  ];
  invalid.forEach((override) => assert.throws(() => validateTimetableLayoutBody({ ...body(), ...override })));
  assert.doesNotThrow(() => validateTimetableLayoutBody(body()));
});

test('PUT accepts the exact numeric boundaries', () => {
  assert.doesNotThrow(() => validateTimetableLayoutBody(body({ layout: {
    ...body().layout,
    periodsPerDay: 1,
    periodLengthMinutes: 20,
    registration: { enabled: true, startTime: '00:00', lengthMinutes: 5 },
    breaks: [{ startTime: '00:05', lengthMinutes: 120 }],
    lunch: { startTime: '02:05', lengthMinutes: 180 },
  } })));
  assert.doesNotThrow(() => validateTimetableLayoutBody(body({ layout: {
    ...body().layout,
    periodsPerDay: 12,
    periodLengthMinutes: 20,
    registration: { enabled: false, startTime: '00:00', lengthMinutes: 120 },
    breaks: [],
    lunch: { startTime: '23:59', lengthMinutes: 0 },
  } })));
  assert.doesNotThrow(() => validateTimetableLayoutBody(body({ layout: {
    ...body().layout,
    periodsPerDay: 1,
    periodLengthMinutes: 120,
    schoolStartTime: '20:00',
    registration: { enabled: false, startTime: '00:00', lengthMinutes: 120 },
    breaks: [],
    lunch: { startTime: '23:59', lengthMinutes: 0 },
  } })));
});

test('hidden enabled lunch continues to block teaching placement', () => {
  const validated = validateTimetableLayoutBody(body({ layout: {
    ...body().layout,
    schoolStartTime: '12:00',
    periodLengthMinutes: 30,
    breaks: [],
    lunch: { startTime: '12:30', lengthMinutes: 45 },
    showLunchInTimetable: false,
  } }));
  const lunch = validated.rpcLayout.periods.find((period) => period.type === 'lunch');
  assert.equal(lunch.enabled, true);
  assert.equal(lunch.visible, false);
  assert.deepEqual(
    validated.rpcLayout.periods.filter((period) => period.type === 'teaching').map((period) => [period.startTime, period.endTime]),
    [['12:00', '12:30'], ['13:15', '13:45']],
  );
});

test('PUT generates deterministic ID-free teaching rows and exact RPC input', async () => {
  const instance = await harness();
  try {
    const response = await fetch(`${instance.baseUrl}/api/timetable/layout`, { method: 'PUT', headers: headers(), body: JSON.stringify(body()) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-request-id'), requestIdValue);
    assert.equal(instance.tableCalls.length, 0); assert.equal(instance.rpcCalls.length, 1);
    const call = instance.rpcCalls[0]; assert.equal(call.name, 'plannix_save_timetable_layout');
    assert.deepEqual(Object.keys(call.input), ['target_organisation_id', 'target_academic_year_id', 'target_timetable_id', 'expected_revision', 'target_layout']);
    const teaching = call.input.target_layout.periods.filter((period) => period.type === 'teaching');
    assert.deepEqual(teaching.map((period) => [period.startTime, period.endTime]), [['09:00', '10:00'], ['10:15', '11:15']]);
    assert.ok(teaching.every((period) => !Object.hasOwn(period, 'id')));
    const hiddenBreak = call.input.target_layout.periods.find((period) => period.type === 'break'); assert.equal(hiddenBreak.enabled, true); assert.equal(hiddenBreak.visible, false);
    const registration = call.input.target_layout.periods.find((period) => period.type === 'registration'); assert.equal(registration.enabled, false); assert.equal(registration.endTime, '08:55');
    const lunch = call.input.target_layout.periods.find((period) => period.type === 'lunch'); assert.equal(lunch.enabled, false); assert.equal(lunch.endTime, lunch.startTime);
    const result = (await response.json()).layout; assert.equal(result.timetableId, timetableId); assert.ok(result.periods.every((period) => isFinite(period.order) && period.id));
  } finally { await instance.close(); }
});

test('one-week and two-week saves each use one fresh request client', async () => {
  const instance = await harness();
  try {
    for (const cycle of ['one-week', 'two-week']) {
      const requestBody = body({ layout: { ...body().layout, cycle } });
      const response = await fetch(`${instance.baseUrl}/api/timetable/layout`, { method: 'PUT', headers: headers(), body: JSON.stringify(requestBody) }); assert.equal(response.status, 200);
    }
    assert.equal(instance.clientCreations.length, 2); assert.deepEqual(instance.rpcCalls.map((call) => call.input.target_layout.cadence), ['one-week', 'two-week']);
  } finally { await instance.close(); }
});

test('stable RPC errors map safely without exposing arbitrary details', async () => {
  const cases = [[{ code: '40001' }, 409], [{ code: '23503', message: 'TIMETABLE_LAYOUT_WEEK_IN_USE' }, 409], [{ code: '23503', message: 'TIMETABLE_LAYOUT_PERIOD_IN_USE' }, 409], [{ code: '23505' }, 409], [{ code: '42501' }, 403], [{ code: 'P0002' }, 404], [{ status: 503 }, 503], [{ code: 'XX000', message: 'private data' }, 500]];
  for (const [error, status] of cases) {
    const instance = await harness({ rpcResult: { data: null, error } });
    try {
      const response = await fetch(`${instance.baseUrl}/api/timetable/layout`, { method: 'PUT', headers: headers(), body: JSON.stringify(body()) });
      assert.equal(response.status, status); assert.doesNotMatch((await response.json()).message, /private data/);
    } finally { await instance.close(); }
  }
});

test('structured error logs omit bearer tokens, layout values, times and raw service errors', async () => {
  const original = console.error;
  const lines = [];
  console.error = (line) => lines.push(String(line));
  const instance = await harness({ rpcResult: { data: null, error: { status: 503, message: 'raw-internal-service-message' } } });
  try {
    const sensitive = body({ layout: { ...body().layout, name: 'Sensitive timetable name', schoolStartTime: '09:37' } });
    const response = await fetch(`${instance.baseUrl}/api/timetable/layout`, { method: 'PUT', headers: headers(), body: JSON.stringify(sensitive) });
    assert.equal(response.status, 503);
  } finally {
    await instance.close();
    console.error = original;
  }
  assert.ok(lines.length > 0);
  lines.forEach((line) => {
    assert.doesNotMatch(line, new RegExp(token));
    assert.doesNotMatch(line, /Sensitive timetable name|09:37|raw-internal-service-message/);
    assert.doesNotThrow(() => JSON.parse(line));
  });
});

test('malformed and oversized JSON return safe errors with request IDs', async () => {
  const instance = await harness();
  try {
    for (const [payload, status] of [['{"bad":', 400], [JSON.stringify({ value: 'x'.repeat(110000) }), 413]]) {
      const response = await fetch(`${instance.baseUrl}/api/timetable/layout`, { method: 'PUT', headers: headers(), body: payload });
      assert.equal(response.status, status); assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
  } finally { await instance.close(); }
});

test('production registers layout routes once after legacy planner removal', () => {
  const authSource = fs.readFileSync(new URL('../auth-server.js', import.meta.url), 'utf8');
  assert.equal((authSource.match(/registerTimetableLayoutRoutes\(\{ app \}\)/g) || []).length, 1);
  assert.equal(authSource.includes('planner-routes.js'), false);
  assert.equal(authSource.includes('withUserDbSession'), false);
});
