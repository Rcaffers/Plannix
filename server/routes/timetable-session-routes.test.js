import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import test from 'node:test';
import express from 'express';
import { errorHandler } from '../middleware/errorHandler.js';
import { notFound } from '../middleware/notFound.js';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { requestId } from '../middleware/requestId.js';
import { registerTimetableSessionRoutes } from './timetable-session-routes.js';

const requestIdValue = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';
const organisationId = '10000000-0000-4000-8000-000000000001';
const academicYearId = '20000000-0000-4000-8000-000000000001';
const timetableId = '30000000-0000-4000-8000-000000000001';
const weekAId = '40000000-0000-4000-8000-000000000001';
const weekBId = '40000000-0000-4000-8000-000000000002';
const collectionId = '50000000-0000-4000-8000-000000000001';
const sessionId = '60000000-0000-4000-8000-000000000001';
const periodId = '70000000-0000-4000-8000-000000000001';
const classId = '80000000-0000-4000-8000-000000000001';
const token = 'safe.test.bearer';
const weekStartDate = '2026-09-07';
const confirmedUser = { id: '90000000-0000-4000-8000-000000000001', email: 'hidden@example.test', email_confirmed_at: '2026-09-17' };

function session(overrides = {}) {
  return { id: sessionId, day: 0, periodId, classId, title: 'Mathematics', notes: 'Private note', ...overrides };
}

function defaultRpcResult(name) {
  if (name === 'plannix_get_recurring_timetable_sessions') return { data: [{ revision: 2, weeks: [
    { weekId: weekAId, code: 'A', collectionId, sessions: [session()] },
    { weekId: weekBId, code: 'B', collectionId: null, sessions: [] },
  ] }], error: null };
  if (name === 'plannix_get_dated_timetable_sessions' || name === 'plannix_remove_dated_timetable_override') return { data: [{
    revision: 3, week_start_date: weekStartDate, repeating_week_id: weekAId,
    source: 'recurring', override_exists: false, collection_id: null,
    sessions: [{ day: 0, periodId, classId, title: '', notes: '' }],
  }], error: null };
  if (name === 'plannix_save_recurring_timetable_sessions') return { data: [{ revision: 3, collection_id: collectionId, sessions: [session()] }], error: null };
  if (name === 'plannix_save_dated_timetable_sessions') return { data: [{ revision: 3, collection_id: collectionId, repeating_week_id: weekAId, sessions: [] }], error: null };
  return { data: [{ revision: 3, collections: [{ type: 'recurring', collectionId, weekId: weekAId, weekStartDate: null, sessions: [session()] }] }], error: null };
}

async function harness({ authUser = confirmedUser, authError = null, rpcResult } = {}) {
  const clientCreations = [];
  const rpcCalls = [];
  const requireAuth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async () => ({
    data: { user: authError ? null : authUser }, error: authError,
  }) } }) });
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '100kb' }));
  registerTimetableSessionRoutes({
    app,
    requireAuth,
    createRequestClient(auth) {
      clientCreations.push({ ...auth });
      return { async rpc(name, input) {
        rpcCalls.push({ name, input });
        if (rpcResult instanceof Error) throw rpcResult;
        if (typeof rpcResult === 'function') return rpcResult(name, input);
        return rpcResult || defaultRpcResult(name);
      } };
    },
  });
  app.use(notFound);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
    clientCreations,
    rpcCalls,
  };
}

const headers = (authorization = `Bearer ${token}`) => ({ Authorization: authorization, 'Content-Type': 'application/json', 'X-Request-ID': requestIdValue });
const scope = `organisationId=${organisationId}&academicYearId=${academicYearId}&timetableId=${timetableId}`;
const recurringPath = `/api/timetable/sessions/recurring?${scope}`;
const datedPath = `/api/timetable/sessions/date?${scope}&weekStartDate=${weekStartDate}`;
const validSession = (overrides = {}) => ({ id: sessionId, day: 0, periodId, classId, title: '', notes: '', ...overrides });
const recurringBody = (overrides = {}) => ({ organisationId, academicYearId, timetableId, weekId: weekAId, expectedRevision: 2, sessions: [validSession()], ...overrides });
const datedBody = (overrides = {}) => ({ organisationId, academicYearId, timetableId, weekStartDate, expectedRevision: 2, sessions: [], ...overrides });

test('all session routes require confirmed bearer authentication and reject a legacy cookie', async () => {
  for (const item of [
    { authorization: null, status: 401 },
    { authorization: 'Basic no', status: 401 },
    { authorization: `Bearer ${token}`, authError: { status: 401 }, authUser: null, status: 401 },
    { authorization: `Bearer ${token}`, authUser: { ...confirmedUser, email_confirmed_at: null }, status: 403 },
  ]) {
    const instance = await harness(item);
    try {
      const requestHeaders = { Cookie: 'plannix_session=legacy', 'X-Request-ID': requestIdValue };
      if (item.authorization) requestHeaders.Authorization = item.authorization;
      const response = await fetch(`${instance.baseUrl}${recurringPath}`, { headers: requestHeaders });
      assert.equal(response.status, item.status);
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
      assert.equal(instance.clientCreations.length, 0);
    } finally { await instance.close(); }
  }
});

test('duplicated Authorization headers are rejected before creating a data client', async () => {
  const instance = await harness();
  try {
    const port = Number(new URL(instance.baseUrl).port);
    const raw = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.end([
        `GET ${recurringPath} HTTP/1.1`, 'Host: localhost',
        `Authorization: Bearer ${token}`, 'Authorization: Bearer duplicate.token',
        `X-Request-ID: ${requestIdValue}`, 'Connection: close', '', '',
      ].join('\r\n')));
      const chunks = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
      socket.on('error', reject);
    });
    assert.match(raw, /^HTTP\/1\.1 401 /);
    assert.equal(instance.clientCreations.length, 0);
  } finally { await instance.close(); }
});

test('recurring GET calls one snapshot RPC and returns Week A and Week B exactly', async () => {
  const instance = await harness();
  try {
    const response = await fetch(`${instance.baseUrl}${recurringPath}`, { headers: headers() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      revision: 2,
      weeks: [
        { weekId: weekAId, code: 'A', collectionId, sessions: [session()] },
        { weekId: weekBId, code: 'B', collectionId: null, sessions: [] },
      ],
    });
    assert.deepEqual(instance.rpcCalls, [{ name: 'plannix_get_recurring_timetable_sessions', input: {
      target_organisation_id: organisationId, target_academic_year_id: academicYearId, target_timetable_id: timetableId,
    } }]);
    assert.equal(instance.clientCreations.length, 1);
  } finally { await instance.close(); }
});

test('recurring PUT maps the exact RPC contract and preserves authoritative IDs and zero-based days', async () => {
  const instance = await harness();
  try {
    const response = await fetch(`${instance.baseUrl}/api/timetable/sessions/recurring`, { method: 'PUT', headers: headers(), body: JSON.stringify(recurringBody()) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revision: 3, collectionId, sessions: [session()] });
    assert.deepEqual(instance.rpcCalls[0], { name: 'plannix_save_recurring_timetable_sessions', input: {
      target_organisation_id: organisationId, target_academic_year_id: academicYearId,
      target_timetable_id: timetableId, target_week_id: weekAId, expected_revision: 2,
      target_sessions: [validSession()],
    } });
  } finally { await instance.close(); }
});

test('dated GET distinguishes inherited placements without persisted IDs', async () => {
  const instance = await harness();
  try {
    const response = await fetch(`${instance.baseUrl}${datedPath}`, { headers: headers() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      revision: 3, weekStartDate, repeatingWeekId: weekAId, source: 'recurring',
      overrideExists: false, collectionId: null,
      sessions: [{ day: 0, periodId, classId, title: '', notes: '' }],
    });
    assert.deepEqual(instance.rpcCalls[0].input, {
      target_organisation_id: organisationId, target_academic_year_id: academicYearId,
      target_timetable_id: timetableId, target_week_start_date: weekStartDate,
    });
  } finally { await instance.close(); }
});

test('dated save retains an intentionally empty override and database-derived week identity', async () => {
  const instance = await harness();
  try {
    const response = await fetch(`${instance.baseUrl}/api/timetable/sessions/date`, { method: 'PUT', headers: headers(), body: JSON.stringify(datedBody()) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revision: 3, collectionId, sessions: [], repeatingWeekId: weekAId });
    assert.deepEqual(instance.rpcCalls[0], { name: 'plannix_save_dated_timetable_sessions', input: {
      target_organisation_id: organisationId, target_academic_year_id: academicYearId,
      target_timetable_id: timetableId, target_week_start_date: weekStartDate,
      expected_revision: 2, target_sessions: [],
    } });
  } finally { await instance.close(); }
});

test('dated DELETE maps exact parameters and returns inherited recurring state', async () => {
  const instance = await harness();
  try {
    const response = await fetch(`${instance.baseUrl}${datedPath}&expectedRevision=2`, { method: 'DELETE', headers: headers() });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).source, 'recurring');
    assert.deepEqual(instance.rpcCalls[0], { name: 'plannix_remove_dated_timetable_override', input: {
      target_organisation_id: organisationId, target_academic_year_id: academicYearId,
      target_timetable_id: timetableId, target_week_start_date: weekStartDate, expected_revision: 2,
    } });
  } finally { await instance.close(); }
});

test('batch validates and sends all collection replacements in one RPC call', async () => {
  const instance = await harness();
  const mutations = [
    { type: 'recurring', weekId: weekAId, sessions: [validSession()] },
    { type: 'date_override', weekStartDate, sessions: [] },
  ];
  try {
    const response = await fetch(`${instance.baseUrl}/api/timetable/sessions/batch`, { method: 'PUT', headers: headers(), body: JSON.stringify({ organisationId, academicYearId, timetableId, expectedRevision: 2, mutations }) });
    assert.equal(response.status, 200);
    assert.equal(instance.rpcCalls.length, 1);
    assert.equal(instance.rpcCalls[0].name, 'plannix_apply_timetable_session_batch');
    assert.deepEqual(instance.rpcCalls[0].input.target_mutations, mutations);
  } finally { await instance.close(); }
});

test('scope, dates, revisions, unknown fields and missing collections fail before data access', async () => {
  const instance = await harness();
  try {
    const cases = [
      ['/api/timetable/sessions/recurring', 'GET', null],
      [`/api/timetable/sessions/recurring?${scope}&userId=${confirmedUser.id}`, 'GET', null],
      [`/api/timetable/sessions/date?${scope}&weekStartDate=2026-09-08`, 'GET', null],
      ['/api/timetable/sessions/recurring', 'PUT', recurringBody({ expectedRevision: -1 })],
      ['/api/timetable/sessions/recurring', 'PUT', recurringBody({ userId: confirmedUser.id })],
      ['/api/timetable/sessions/date', 'PUT', { ...datedBody(), weekId: weekAId }],
      [`${datedPath}&expectedRevision=01`, 'DELETE', null],
    ];
    for (const [path, method, body] of cases) {
      const response = await fetch(`${instance.baseUrl}${path}`, { method, headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, 400, path);
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(instance.clientCreations.length, 0);
  } finally { await instance.close(); }
});

test('session validation enforces limits, exact fields, UUIDs, text bounds and unique identities', async () => {
  const instance = await harness();
  const invalidCollections = [
    undefined,
    Array.from({ length: 61 }, () => validSession({ id: undefined })),
    [validSession({ day: 5 })],
    [validSession({ periodId: 'bad' })],
    [validSession({ classId: 'bad' })],
    [validSession({ id: 'bad' })],
    [validSession({ title: 'x'.repeat(201) })],
    [validSession({ notes: 'x'.repeat(5001) })],
    [{ ...validSession(), teacher: 'not allowed' }],
    [validSession(), validSession()],
    [validSession(), validSession({ id: '60000000-0000-4000-8000-000000000002' })],
  ];
  try {
    for (const sessions of invalidCollections) {
      const body = recurringBody();
      if (sessions === undefined) delete body.sessions;
      else body.sessions = sessions;
      const response = await fetch(`${instance.baseUrl}/api/timetable/sessions/recurring`, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      assert.ok([400, 409].includes(response.status));
    }
    assert.equal(instance.clientCreations.length, 0);
  } finally { await instance.close(); }
});

test('batch limits and duplicate targets are rejected before Supabase', async () => {
  const instance = await harness();
  try {
    for (const mutations of [[], Array.from({ length: 21 }, () => ({ type: 'recurring', weekId: weekAId, sessions: [] })), [
      { type: 'recurring', weekId: weekAId, sessions: [] },
      { type: 'recurring', weekId: weekAId, sessions: [] },
    ]]) {
      const response = await fetch(`${instance.baseUrl}/api/timetable/sessions/batch`, { method: 'PUT', headers: headers(), body: JSON.stringify({ organisationId, academicYearId, timetableId, expectedRevision: 0, mutations }) });
      assert.ok([400, 409].includes(response.status));
    }
    assert.equal(instance.clientCreations.length, 0);
  } finally { await instance.close(); }
});

test('stable RPC identifiers map to safe conflict, authorization, hidden and outage responses', async () => {
  for (const [error, status] of [
    [{ code: '40001' }, 409],
    [{ code: '23514', message: 'TIMETABLE_CLASS_FREQUENCY_EXCEEDED' }, 409],
    [{ code: '42501' }, 403],
    [{ code: 'P0002' }, 404],
    [{ status: 503, message: 'raw outage' }, 503],
    [{ code: 'XX000', message: 'raw internal' }, 500],
  ]) {
    const instance = await harness({ rpcResult: { data: null, error } });
    try {
      const response = await fetch(`${instance.baseUrl}${recurringPath}`, { headers: headers() });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
      assert.equal((await response.json()).message.includes('raw'), false);
    } finally { await instance.close(); }
  }
});

test('malformed and oversized JSON use central safe errors with request IDs', async () => {
  const instance = await harness();
  try {
    for (const [body, status] of [['{"bad":', 400], [JSON.stringify({ value: 'x'.repeat(110000) }), 413]]) {
      const response = await fetch(`${instance.baseUrl}/api/timetable/sessions/recurring`, { method: 'PUT', headers: headers(), body });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('x-request-id'), requestIdValue);
    }
    assert.equal(instance.clientCreations.length, 0);
  } finally { await instance.close(); }
});

test('structured logs omit bearer, identity and timetable-session contents', async () => {
  const original = console.error;
  const lines = [];
  console.error = (line) => lines.push(String(line));
  const instance = await harness({ rpcResult: { data: null, error: { status: 503, message: 'raw service body' } } });
  try {
    const response = await fetch(`${instance.baseUrl}/api/timetable/sessions/recurring`, { method: 'PUT', headers: headers(), body: JSON.stringify(recurringBody({ sessions: [validSession({ title: 'Sensitive title', notes: 'Sensitive notes' })] })) });
    assert.equal(response.status, 503);
  } finally { await instance.close(); console.error = original; }
  const output = lines.join('\n');
  lines.forEach((line) => assert.doesNotThrow(() => JSON.parse(line)));
  for (const forbidden of [token, confirmedUser.email, organisationId, classId, periodId, 'Sensitive title', 'Sensitive notes', 'raw service body', weekStartDate]) {
    assert.equal(output.includes(forbidden), false, forbidden);
  }
  assert.equal(output.includes(requestIdValue), true);
});

test('new routes register once and legacy endpoint contracts and planner module are gone', async () => {
  const authSource = fs.readFileSync(new URL('../auth-server.js', import.meta.url), 'utf8');
  const routeSource = fs.readFileSync(new URL('./timetable-session-routes.js', import.meta.url), 'utf8');
  assert.equal((authSource.match(/registerTimetableSessionRoutes\(\{ app \}\)/g) || []).length, 1);
  for (const path of ['recurring', 'date', 'batch']) assert.ok(routeSource.includes(`/api/timetable/sessions/${path}`));
  assert.equal(authSource.includes('planner-routes.js'), false);
  assert.equal(authSource.includes('withUserDbSession'), false);
  assert.equal(fs.existsSync(new URL('./planner-routes.js', import.meta.url)), false);
  const instance = await harness();
  try {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const response = await fetch(`${instance.baseUrl}/api/timetable/sessions`, { method, headers: headers(), ...(method === 'PUT' ? { body: '{}' } : {}) });
      assert.equal(response.status, 404);
    }
  } finally { await instance.close(); }
});
