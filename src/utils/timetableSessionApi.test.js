import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTimetableSessionApi } from './timetableSessionApi.js';

const ids = Array.from({ length: 10 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const scope = { organisationId: ids[0], academicYearId: ids[1], timetableId: ids[2] };
const requestId = ids[9];
const session = { id: ids[6], day: 0, periodId: ids[4], classId: ids[5], title: 'Topic', notes: 'Notes' };
const recurring = { revision: 3, weeks: [{ weekId: ids[3], code: 'A', collectionId: ids[7], sessions: [session] }] };

function response(payload, status = 200, header = requestId) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => header }, json: async () => payload };
}

test('all six contracts use validated bearer authentication and omit cookies', async () => {
  const calls = [];
  const replies = [recurring,
    { revision: 4, collectionId: ids[7], sessions: [session] },
    { revision: 4, weekStartDate: '2026-09-14', repeatingWeekId: ids[3], source: 'recurring', overrideExists: false, collectionId: null,
      sessions: [{ day: 0, periodId: ids[4], classId: ids[5], title: '', notes: '' }] },
    { revision: 5, collectionId: ids[7], repeatingWeekId: ids[3], sessions: [session] },
    { revision: 6, weekStartDate: '2026-09-14', repeatingWeekId: ids[3], source: 'recurring', overrideExists: false, collectionId: null, sessions: [] },
    { revision: 7, collections: [{ type: 'recurring', collectionId: ids[7], weekId: ids[3], sessions: [session] }] },
  ];
  const api = createTimetableSessionApi({ getSession: async () => ({ access_token: 'private-test-token' }),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(replies[calls.length - 1]); } });
  await api.loadRecurring(scope);
  await api.saveRecurring({ ...scope, weekId: ids[3], expectedRevision: 3, sessions: [session] });
  await api.loadDate({ ...scope, weekStartDate: '2026-09-14' });
  await api.saveDate({ ...scope, weekStartDate: '2026-09-14', expectedRevision: 4, sessions: [session] });
  await api.removeDate({ ...scope, weekStartDate: '2026-09-14', expectedRevision: 5 });
  await api.saveBatch({ ...scope, expectedRevision: 6, mutations: [{ type: 'recurring', weekId: ids[3], sessions: [session] }] });
  assert.equal(calls.length, 6);
  calls.forEach(({ options }) => { assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, 'Bearer private-test-token'); });
  assert.deepEqual(calls.map(({ options }) => options.method), ['GET', 'PUT', 'GET', 'PUT', 'DELETE', 'PUT']);
  assert.equal(calls.some(({ options }) => String(options.body || '').includes('private-test-token')), false);
});

test('dated inheritance retains no fake collection or session identifiers', async () => {
  const api = createTimetableSessionApi({ getSession: async () => ({ access_token: 'x' }), fetchImpl: async () => response({
    revision: 2, weekStartDate: '2026-09-14', repeatingWeekId: ids[3], source: 'recurring', overrideExists: false,
    collectionId: null, sessions: [{ day: 1, periodId: ids[4], classId: ids[5], title: '', notes: '' }],
  }) });
  const result = await api.loadDate({ ...scope, weekStartDate: '2026-09-14' });
  assert.equal(result.collectionId, null);
  assert.equal('id' in result.sessions[0], false);
  assert.equal(result.requestId, requestId);
});

test('empty overrides, authoritative generated IDs, and revisions map exactly', async () => {
  const api = createTimetableSessionApi({ getSession: async () => ({ access_token: 'x' }), fetchImpl: async () => response({
    revision: 9, collectionId: ids[7], repeatingWeekId: ids[3], sessions: [],
  }) });
  assert.deepEqual(await api.saveDate({ ...scope, weekStartDate: '2026-09-14', expectedRevision: 8, sessions: [] }),
    { revision: 9, collectionId: ids[7], repeatingWeekId: ids[3], sessions: [], requestId });
});

test('UUID, Monday, revision, session identity, and response validation fail safely', async () => {
  const api = createTimetableSessionApi({ getSession: async () => ({ access_token: 'x' }), fetchImpl: async () => response(recurring) });
  assert.throws(() => api.loadRecurring({ ...scope, organisationId: 'bad' }), /Organisation is invalid/);
  assert.throws(() => api.loadDate({ ...scope, weekStartDate: '2026-09-15' }), /Week start date is invalid/);
  assert.throws(() => api.saveRecurring({ ...scope, weekId: ids[3], expectedRevision: -1, sessions: [] }), /revision is invalid/);
  assert.throws(() => api.saveRecurring({ ...scope, weekId: ids[3], expectedRevision: 0,
    sessions: [{ ...session, periodId: 'bad' }] }), /invalid timetable session data/);
  const invalid = createTimetableSessionApi({ getSession: async () => ({ access_token: 'x' }), fetchImpl: async () => response({ revision: 0, weeks: [{ code: 'A' }] }) });
  await assert.rejects(invalid.loadRecurring(scope), /invalid timetable session data/);
});

test('safe failures retain only canonical request references and conflict status', async () => {
  const api = createTimetableSessionApi({ getSession: async () => ({ access_token: 'secret' }),
    fetchImpl: async () => response({ message: 'Timetable sessions changed since they were loaded.' }, 409, requestId) });
  await assert.rejects(api.loadRecurring(scope), (error) => error.status === 409 && error.requestId === requestId
    && !error.message.includes('secret'));
  const badHeader = createTimetableSessionApi({ getSession: async () => ({ access_token: 'x' }),
    fetchImpl: async () => response({ message: 'Safe failure.' }, 400, 'not-a-uuid') });
  await assert.rejects(badHeader.loadRecurring(scope), (error) => error.requestId === null);
});

test('production React has no legacy session endpoint or persistence identities', () => {
  const api = fs.readFileSync(new URL('./api.js', import.meta.url), 'utf8');
  const card = fs.readFileSync(new URL('../components/ProjectCard.jsx', import.meta.url), 'utf8');
  const sessionApi = fs.readFileSync(new URL('./timetableSessionApi.js', import.meta.url), 'utf8');
  assert.equal(api.includes('/api/timetable/sessions?'), false);
  assert.equal(card.includes('layoutKey'), false);
  assert.equal(card.includes('weekKey'), false);
  assert.equal(card.includes('teacher:'), false);
  assert.equal(card.includes('meta:'), false);
  assert.match(sessionApi, /sessions\/batch/);
  assert.equal((sessionApi.match(/credentials: 'omit'/g) || []).length, 1);
});
