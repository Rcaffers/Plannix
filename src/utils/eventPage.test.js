import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { blankEventDraft, confirmedDraftUnchanged, draftFromEvent, matchingCreatedEvents, sortPersonalEvents, validateEventDraft } from './eventPage.js';

const year = { startDate: '2026-09-01', endDate: '2027-08-31' };
test('all-day drafts discard hidden times and normalize text', () => {
  const draft = { ...blankEventDraft(), title: '  Staff   day ', date: '2026-09-01', startTime: '09:00', endTime: '10:00' };
  assert.deepEqual(validateEventDraft(draft, year).event, { title: 'Staff day', date: '2026-09-01', startTime: null, endTime: null, location: null, notes: null });
});
test('timed drafts require ordered paired times and valid year date', () => {
  const draft = { ...blankEventDraft(), title: 'Meeting', date: '2026-09-01', allDay: false, startTime: '10:00', endTime: '09:00' };
  assert.equal(validateEventDraft(draft, year).field, 'endTime');
  draft.endTime = '11:00';
  assert.equal(validateEventDraft(draft, year).event.endTime, '11:00');
  draft.date = '2027-09-01';
  assert.equal(validateEventDraft(draft, year).field, 'date');
});
test('title, location and notes limits use the shared validator', () => {
  const draft = { ...blankEventDraft(), title: 'T', date: '2026-09-01' };
  draft.title = 'T'.repeat(200);
  assert.ok(validateEventDraft(draft, year).event);
  draft.title += 'T';
  assert.equal(validateEventDraft(draft, year).field, 'title');
  draft.title = 'T'; draft.location = 'L'.repeat(201);
  assert.equal(validateEventDraft(draft, year).field, 'location');
  draft.location = ''; draft.notes = 'N'.repeat(2001);
  assert.equal(validateEventDraft(draft, year).field, 'notes');
});
test('invalid control and markup characters identify the offending field', () => {
  const draft = { ...blankEventDraft(), title: 'Meeting', date: '2026-09-01' };
  draft.title = '<script>';
  assert.equal(validateEventDraft(draft, year).field, 'title');
  draft.title = 'Meeting'; draft.location = 'Room\u200b one';
  assert.equal(validateEventDraft(draft, year).field, 'location');
  draft.location = 'Room one'; draft.notes = 'Line\u0001 two';
  assert.equal(validateEventDraft(draft, year).field, 'notes');
});
test('uncertain create reconciliation uses the exact normalized date, title and time key', () => {
  const attempted = { title: '  Staff   Day ', date: '2026-09-01', startTime: null, endTime: null };
  const records = [
    { id: 'a', title: 'Staff Day', date: '2026-09-01', startTime: null, endTime: null },
    { id: 'b', title: 'Staff Day', date: '2026-09-02', startTime: null, endTime: null },
    { id: 'c', title: 'Staff Day', date: '2026-09-01', startTime: '09:00', endTime: '10:00' },
  ];
  assert.deepEqual(matchingCreatedEvents(records, { ...attempted, title: 'Staff Day' }).map(item => item.id), ['a']);
});
test('confirmed destructive reload cannot discard a newer programmatic draft', () => {
  const original = { id: 'event', draft: { title: 'Before confirmation', notes: 'Keep me' } };
  const confirmation = { version: 3, serializedEditor: JSON.stringify(original) };
  assert.equal(confirmedDraftUnchanged(confirmation, 3, original), true);
  assert.equal(confirmedDraftUnchanged(confirmation, 4, original), false);
  assert.equal(confirmedDraftUnchanged(confirmation, 3,
    { ...original, draft: { ...original.draft, notes: 'New programmatic edit' } }), false);
});
test('canonical records become editable drafts and sort by date, all-day, time, title and ID', () => {
  const base = { title: 'B', date: '2026-09-02', startTime: '09:00', endTime: '10:00', location: null, notes: 'line 1\nline 2' };
  assert.equal(draftFromEvent(base).notes, 'line 1\nline 2');
  assert.deepEqual(sortPersonalEvents([{ ...base, id: 'b' }, { ...base, id: 'a' }, { ...base, id: 'c', startTime: null }, { ...base, id: 'd', date: '2026-09-01' }]).map(x => x.id), ['d', 'c', 'a', 'b']);
});
test('Events navigation is registered behind the existing private-route authentication gate', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const nav = readFileSync(new URL('../components/SettingsSubnav.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/settings\/events" element=\{privateRoute\(<Events \/>\)\}/);
  assert.match(nav, /to: '\/settings\/events', label: 'Events'/);
});
