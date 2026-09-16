import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createClassApi, ApiError } from './api.js';
import {
  addDraftClass,
  classEntriesEqual,
  safeClassError,
  toClassRequestEntries,
  toDraftClasses,
  validateClassDraft,
} from './classPersistence.js';

const organisationId = '10000000-0000-4000-8000-000000000001';
const academicYearId = '20000000-0000-4000-8000-000000000001';
const classId = '30000000-0000-4000-8000-000000000001';
const generatedId = '30000000-0000-4000-8000-000000000002';
const requestId = '40000000-0000-4000-8000-000000000001';
const accessToken = 'private.access.token';

function response(payload, { ok = true, status = 200, reference = requestId } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => (name === 'x-request-id' ? reference : null) },
    json: async () => payload,
  };
}

function harness(result) {
  const calls = [];
  const api = createClassApi({
    getSession: async () => ({ access_token: accessToken }),
    fetchImpl: async (...args) => {
      calls.push(args);
      return typeof result === 'function' ? result(...args) : result;
    },
  });
  return { api, calls };
}

test('GET requires selected UUIDs, uses bearer auth, omits cookies, and maps public fields', async () => {
  const { api, calls } = harness(response({
    revision: 4,
    entries: [{ id: classId, name: 'Maths', frequency: 5, cadence: 'two-weeks', role: 'Admin' }],
  }));
  const result = await api.load(organisationId, academicYearId);
  assert.deepEqual(result, {
    revision: 4,
    entries: [{ id: classId, name: 'Maths', frequency: 5 }],
    requestId,
  });
  const [url, options] = calls[0];
  assert.match(url, new RegExp(`organisationId=${organisationId}.*academicYearId=${academicYearId}`));
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Authorization, `Bearer ${accessToken}`);
  assert.throws(() => api.load('', academicYearId), ApiError);
  assert.throws(() => api.load(organisationId, ''), ApiError);
});

test('PUT sends the exact revision contract and strips draft-only or forbidden fields', async () => {
  const { api, calls } = harness(response({
    revision: 1,
    entries: [{ id: generatedId, name: 'New class', frequency: 3 }],
  }));
  const result = await api.save(organisationId, academicYearId, 0, [{
    clientKey: 'local-only',
    name: ' New class ',
    frequency: 3,
    cadence: 'week',
    sortOrder: 9,
    userId: 'attacker',
  }]);
  assert.deepEqual(result.entries, [{ id: generatedId, name: 'New class', frequency: 3 }]);
  const [, options] = calls[0];
  assert.equal(options.credentials, 'omit');
  assert.deepEqual(JSON.parse(options.body), {
    organisationId,
    academicYearId,
    expectedRevision: 0,
    entries: [{ name: 'New class', frequency: 3 }],
  });
  assert.equal(options.body.includes('cadence'), false);
  assert.equal(options.body.includes('sortOrder'), false);
  assert.equal(options.body.includes('local-only'), false);
});

test('a successful empty collection remains authoritative and retains its revision', async () => {
  const { api } = harness(response({ revision: 7, entries: [] }));
  assert.deepEqual(await api.load(organisationId, academicYearId), {
    revision: 7,
    entries: [],
    requestId,
  });
});

test('persisted IDs survive rename and reorder while new rows send no fallback ID', () => {
  const entries = toDraftClasses([
    { id: classId, name: 'First', frequency: 2 },
    { name: 'Unsaved', frequency: 1 },
  ]);
  const reordered = [
    { ...entries[1], name: 'New name' },
    { ...entries[0], name: 'Renamed' },
  ];
  const requestEntries = toClassRequestEntries(reordered);
  assert.deepEqual(requestEntries[0], { name: 'New name', frequency: 1 });
  assert.equal(requestEntries[1].id, classId);
  assert.equal(requestEntries.some((entry) => String(entry.id || '').startsWith('draft-')), false);
});

test('validation enforces count, names, frequencies, IDs, and trimmed duplicates', () => {
  assert.equal(validateClassDraft([]), '');
  assert.match(validateClassDraft(Array.from({ length: 61 }, () => ({ name: 'A', frequency: 1 }))), /60/);
  assert.match(validateClassDraft([{ name: ' ', frequency: 1 }]), /name/);
  assert.match(validateClassDraft([{ name: 'x'.repeat(201), frequency: 1 }]), /name/);
  assert.match(validateClassDraft([{ name: 'A', frequency: 0 }]), /frequency/);
  assert.match(validateClassDraft([{ name: 'A', frequency: 51 }]), /frequency/);
  assert.match(validateClassDraft([{ name: 'A', frequency: 1.5 }]), /frequency/);
  assert.match(validateClassDraft([{ id: 'fallback-1', name: 'A', frequency: 1 }]), /ID/);
  assert.match(validateClassDraft([{ name: 'Same ', frequency: 1 }, { name: 'Same', frequency: 2 }]), /unique/);
});

test('draft identity, dirty comparison, and maximum additions are deterministic', () => {
  const authoritative = toDraftClasses([{ id: classId, name: 'Maths', frequency: 5 }]);
  assert.equal(classEntriesEqual(authoritative, toDraftClasses(authoritative)), true);
  assert.equal(classEntriesEqual(authoritative, [{ ...authoritative[0], name: 'Science' }]), false);
  assert.equal(addDraftClass(authoritative).length, 2);
  let full = [];
  for (let index = 0; index < 61; index += 1) full = addDraftClass(full);
  assert.equal(full.length, 60);
});

test('safe errors distinguish referenced removals and stale revisions and retain canonical references', async () => {
  assert.match(safeClassError({ status: 409, message: 'A class with timetable placements cannot be removed.' }), /placements/);
  assert.match(safeClassError({ status: 409, message: 'Classes changed since loading.' }), /Reload/);
  const { api } = harness(response({ message: 'Safe conflict.' }, {
    ok: false, status: 409, reference: requestId,
  }));
  await assert.rejects(
    () => api.save(organisationId, academicYearId, 0, []),
    (error) => error.status === 409 && error.requestId === requestId,
  );
  const invalidReference = harness(response({ message: 'Safe conflict.' }, {
    ok: false, status: 409, reference: 'not-a-request-id',
  }));
  await assert.rejects(
    () => invalidReference.api.save(organisationId, academicYearId, 0, []),
    (error) => error.requestId === null,
  );
});

test('shared context owns loading, revisions, stale guards, cleanup, and deliberate reload', () => {
  const context = fs.readFileSync(new URL('../context/ClassContext.jsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(context, /authoritativeEntries/);
  assert.match(context, /revision/);
  assert.match(context, /generation\.current/);
  assert.match(context, /expectedGeneration !== generation\.current/);
  assert.match(context, /confirm\('Discard unsaved class changes and reload\?'\)/);
  assert.match(context, /revision === null/);
  assert.match(context, /clear\(\)/);
  assert.match(context, /selectedAcademicYearId/);
  assert.match(context, /saving\.current \|\| isLoading/);
  assert.match(context, /setAuthoritativeEntries\(null\)/);
  assert.match(context, /expectedGeneration === generation\.current/);
  assert.match(context, /registerAcademicYearChangeGuard/);
  assert.match(context, /__plannixConfirmClassDiscard/);
  assert.match(app, /__plannixConfirmClassDiscard/);
  assert.equal((app.match(/<ClassProvider user=\{user\}>/g) || []).length, 1);
});

test('editor and ProjectCard share context and class removal never deletes sessions', () => {
  const editor = fs.readFileSync(new URL('../pages/Classes.jsx', import.meta.url), 'utf8');
  const card = fs.readFileSync(new URL('../components/ProjectCard.jsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('./api.js', import.meta.url), 'utf8');
  const persistence = fs.readFileSync(new URL('./classPersistence.js', import.meta.url), 'utf8');
  assert.match(editor, /useClasses\(\)/);
  assert.match(card, /useClasses\(\)/);
  assert.equal(editor.includes('clearTimetableSessionsForLayout'), false);
  assert.equal(editor.includes('fetchClassesPlan'), false);
  assert.equal(card.includes('fetchClassesPlan'), false);
  assert.equal(api.includes('export async function fetchClassesPlan'), false);
  assert.equal(api.includes('export async function saveClassesPlan'), false);
  assert.match(editor, /beforeunload/);
  assert.match(persistence, /Remove or reassign/);
});
