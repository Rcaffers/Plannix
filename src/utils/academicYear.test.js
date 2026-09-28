import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { getAcademicTimetableMondayBounds, normalizeAcademicYear, selectCurrentAcademicYear, validateAcademicYearDraft } from './academicYear.js';

const first = '40000000-0000-4000-8000-000000000001';
const second = '40000000-0000-4000-8000-000000000002';

test('current selection uses inclusive local dates and does not fall back to a nearby year', () => {
  const years = [{ id: first, startDate: '2026-09-15', endDate: '2027-08-31' }];
  assert.equal(selectCurrentAcademicYear(years, '2026-09-15'), first);
  assert.equal(selectCurrentAcademicYear(years, '2027-08-31'), first);
  assert.equal(selectCurrentAcademicYear(years, '2028-01-01'), null);
});

test('overlaps choose latest start date and then UUID deterministically', () => {
  const years = [
    { id: second, startDate: '2026-09-01', endDate: '2027-08-31' },
    { id: first, startDate: '2026-09-01', endDate: '2027-07-31' },
    { id: '40000000-0000-4000-8000-000000000003', startDate: '2026-09-10', endDate: '2027-08-31' },
  ];
  assert.equal(selectCurrentAcademicYear(years, '2026-09-15'), '40000000-0000-4000-8000-000000000003');
  assert.equal(selectCurrentAcademicYear(years.slice(0, 2), '2026-09-15'), first);
});

test('normalization retains editable year and holiday identities and end date', () => {
  assert.deepEqual(normalizeAcademicYear({ id: first, label: ' Year ', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [] }), {
    id: first, label: 'Year', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [],
  });
});

test('validation enforces year ordering and holiday boundaries', () => {
  const base = { label: 'Year', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [] };
  assert.equal(validateAcademicYearDraft(base), '');
  assert.match(validateAcademicYearDraft({ ...base, endDate: '2026-01-01' }), /valid start and end/);
  assert.match(validateAcademicYearDraft({ ...base, holidays: [{ label: 'Outside', startDate: '2027-09-01', endDate: '2027-09-02' }] }), /within/);
});

test('the editable end date controls the inclusive timetable window', () => {
  const bounds = getAcademicTimetableMondayBounds({ startDate: '2026-09-01', endDate: '2026-12-18' });
  assert.equal(bounds.minMonday.getFullYear(), 2026);
  assert.equal(bounds.maxMonday.getMonth(), 11);
});

test('context and UI include stale-response, explicit-save, switching and cleanup safeguards', async () => {
  const [context, page] = await Promise.all([
    fs.readFile(new URL('../context/AcademicYearContext.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../pages/AcademicYear.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(context, /expectedGeneration !== generation\.current/);
  assert.match(context, /clearUserAcademicYear\(\)/);
  assert.match(context, /saving\.current/);
  assert.match(context, /await loadYear\(result\.academicYearId/);
  assert.doesNotMatch(context, /catch\(\(\) => \{\}\)/);
  assert.match(page, /window\.confirm\('Discard unsaved academic-year changes\?'\)/);
  assert.match(page, /disabled=\{isSaving \|\| isLoading\}/);
  assert.match(page, /academic-year-end/);
  assert.match(page, /Create academic year/);
});

test('normalization retains both categories and defaults only legacy missing category', () => {
  const holiday = { id: first, label: 'Break', startDate: '2026-10-01', endDate: '2026-10-02' };
  const plan = { label: 'Year', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [holiday, { ...holiday, id: second, holidayType: 'public' }] };
  assert.deepEqual(normalizeAcademicYear(plan).holidays.map(h => h.holidayType), ['school', 'public']);
  for (const holidayType of ['ai', '', null, 2]) assert.match(validateAcademicYearDraft({ ...plan, holidays: [{ ...holiday, holidayType }] }), /category/);
});


test('manual holidays reject normalized duplicates across categories and count both categories', () => {
  const holiday = { id: first, label: 'Café break', startDate: '2026-12-25', endDate: '2026-12-25', holidayType: 'school' };
  const plan = { label: '2026/27', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [holiday, { ...holiday, id: second, label: ' CAFE\u0301   break ', holidayType: 'public' }] };
  assert.match(validateAcademicYearDraft(plan), /already exists/);
  plan.holidays[1].label = 'Different holiday';
  assert.equal(validateAcademicYearDraft(plan), '');
  plan.holidays = Array.from({ length: 100 }, (_, i) => ({ ...holiday, id: String(i), label: `Holiday ${i}`, holidayType: i % 2 ? 'school' : 'public' }));
  assert.equal(validateAcademicYearDraft(plan), '');
  plan.holidays.push({ ...holiday, id: 'extra' });
  assert.match(validateAcademicYearDraft(plan), /100/);
});
