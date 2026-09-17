import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTimetableLayoutApi } from './api.js';
import { buildRowSegments } from './timetableLayout.js';
import { createDefaultLayoutDraft, layoutDraftEqual, publicLayout, safeLayoutError } from './timetableLayoutPersistence.js';

const organisationId = '10000000-0000-4000-8000-000000000001';
const academicYearId = '20000000-0000-4000-8000-000000000001';
const timetableId = '30000000-0000-4000-8000-000000000001';
const requestId = '40000000-0000-4000-8000-000000000001';
const ids = Array.from({ length: 8 }, (_, index) => `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);

const authoritative = {
  ...createDefaultLayoutDraft(), timetableId, revision: 4,
  weeks: [{ id: ids[0], code: 'A', name: 'Week A' }],
  periods: [
    { id: ids[1], type: 'teaching', number: 1, label: 'Period 1', startTime: '09:00', endTime: '10:00', enabled: true, visible: true, order: 0 },
  ],
};

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, headers: { get: () => requestId }, json: async () => body };
}

test('layout API uses bearer authentication, omits cookies, and maps exact GET and PUT contracts', async () => {
  const calls = [];
  const api = createTimetableLayoutApi({
    getSession: async () => ({ access_token: 'test-token' }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ layout: authoritative });
    },
  });
  const loaded = await api.load(organisationId, academicYearId);
  const saved = await api.save(organisationId, academicYearId, timetableId, 4, authoritative);
  assert.equal(loaded.layout.timetableId, timetableId);
  assert.equal(saved.layout.weeks[0].id, ids[0]);
  assert.equal(saved.layout.periods[0].id, ids[1]);
  assert.match(calls[0].url, new RegExp(`organisationId=${organisationId}.*academicYearId=${academicYearId}`));
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    organisationId, academicYearId, timetableId, expectedRevision: 4,
    layout: createDefaultLayoutDraft(),
  });
});

test('null GET remains an unsaved result and canonical identifiers are enforced', async () => {
  const api = createTimetableLayoutApi({ getSession: async () => ({ access_token: 'x' }), fetchImpl: async () => response({ layout: null }) });
  assert.deepEqual(await api.load(organisationId, academicYearId), { layout: null, requestId });
  assert.throws(() => api.load('not-a-uuid', academicYearId), /Organisation is invalid/);
  assert.throws(() => publicLayout({ ...authoritative, timetableId: 'bad' }), /invalid timetable/);
});

test('hidden fixed blocks reserve time while disabled or zero-duration blocks do not display or block', () => {
  const hidden = buildRowSegments({
    ...createDefaultLayoutDraft(), periodsPerDay: 2, periodLengthMinutes: 60,
    breaks: [{ startTime: '09:30', lengthMinutes: 15 }], showBreaksInTimetable: false,
    lunch: { startTime: '10:45', lengthMinutes: 30 }, showLunchInTimetable: false,
  });
  assert.deepEqual(hidden.filter((row) => row.kind === 'lesson').map((row) => row.timeLabel), ['09:45', '11:15']);
  assert.equal(hidden.some((row) => row.kind === 'break' || row.kind === 'lunch'), false);
  const disabled = buildRowSegments({ ...createDefaultLayoutDraft(), registration: { enabled: false, startTime: '09:00', lengthMinutes: 30 }, lunch: { startTime: '09:00', lengthMinutes: 0 } });
  assert.equal(disabled.find((row) => row.kind === 'lesson').timeLabel, '09:00');
});

test('dirty comparison and conflict messages preserve deliberate recovery choices', () => {
  const draft = createDefaultLayoutDraft();
  assert.equal(layoutDraftEqual(draft, { ...draft }), true);
  assert.equal(layoutDraftEqual(draft, { ...draft, periodsPerDay: 6 }), false);
  assert.match(safeLayoutError({ status: 409, message: 'Week B contains timetable sessions' }), /Week B/);
  assert.match(safeLayoutError({ status: 409, message: 'A period containing timetable sessions' }), /teaching period/);
  assert.match(safeLayoutError({ status: 409, message: 'changed since it was loaded' }), /Reload/);
});

test('context scopes requests, separates draft from authority, blocks duplicates and protects transitions', () => {
  const context = fs.readFileSync(new URL('../context/TimetableLayoutContext.jsx', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../pages/Settings.jsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(context, /organisationId.*selectedAcademicYearId/s);
  assert.match(context, /expectedGeneration !== generation\.current/);
  assert.match(context, /result\.layout === null/);
  assert.match(context, /setAuthoritativeLayout\(null\).*createDefaultLayoutDraft/s);
  assert.match(context, /saving\.current \|\| isLoading/);
  assert.match(context, /authoritativeLayout\?\.revision \|\| 0/);
  assert.match(context, /registerAcademicYearChangeGuard/);
  assert.match(context, /beforeunload/);
  assert.match(context, /confirmDirty/);
  assert.match(settings, /draft, setDraft/);
  assert.match(settings, /await saveLayout\(\)/);
  assert.match(settings, /disabled=\{isLayoutSaving/);
  assert.match(app, /__plannixConfirmLayoutDiscard/);
  assert.ok(app.indexOf('<AcademicYearProvider') < app.indexOf('<TimetableLayoutProvider'));
});

test('legacy session helpers remain while production layout calls use only the new scoped API', () => {
  const api = fs.readFileSync(new URL('./api.js', import.meta.url), 'utf8');
  const card = fs.readFileSync(new URL('../components/ProjectCard.jsx', import.meta.url), 'utf8');
  assert.match(api, /fetchTimetableSessions/);
  assert.match(api, /saveTimetableSessions/);
  assert.match(api, /clearTimetableSessionsForLayout/);
  assert.match(card, /makeLayoutKey/);
  assert.equal(api.includes("credentials: 'include',\n  });\n  const payload = await parseJsonSafe(response);\n  if (!response.ok) {\n    throw new Error(payload?.message || 'Could not load timetable layout.'"), false);
});
