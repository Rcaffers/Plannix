import test from 'node:test';
import assert from 'node:assert/strict';
import { ambiguousNumericDate, normalizeImportPreview, previewDuplicate, previewIssues } from './importPreview.js';
const year = { startDate: '2026-09-01', endDate: '2027-08-31' };
const event = { title: 'Assembly', date: '2027-03-28', sourceDate: 'Sunday 28 March 2027', allDay: true,
  startTime: '', endTime: '', location: '', notes: '' };
const holiday = { label: 'INSET Day', startDate: '2027-03-28', endDate: '2027-03-28', sourceDate: '28 March 2027' };
test('UK ambiguous dates stay unresolved until a human edits them', () => {
  assert.equal(ambiguousNumericDate('03/04/2027'), true);
  assert.equal(ambiguousNumericDate('03-04-2027'), true);
  assert.equal(ambiguousNumericDate('28/03/2027'), false);
  assert.deepEqual(previewIssues('events', { ...event, date: '', sourceDate: '03/04/2027' }, year),
    ['Enter a real event date.', 'Confirm the ambiguous source date.']);
  assert.deepEqual(previewIssues('holidays', { ...holiday, startDate: '2027-02-30' }, year), ['Enter real first and last dates.']);
  assert.deepEqual(previewIssues('events', { ...event, date: '2028-03-28' }, year), ['Date is outside the academic year.']);
  assert.deepEqual(previewIssues('events', { ...event, sourceDate: '' }, year), ['Source date is missing. Confirm the event date.']);
});
test('missing times are not silently invented or labelled all day', () => {
  assert.deepEqual(previewIssues('events', { ...event, allDay: false }, year), ['Choose All day or enter valid paired times.']);
  assert.deepEqual(previewIssues('events', { ...event, allDay: false, startTime: '09:00', endTime: '10:00' }, year), []);
  assert.deepEqual(previewIssues('events', { ...event, startTime: '09:00' }, year), ['All-day entry cannot also have times.']);
});
test('normalization rejects entire collection on unexpected, unsafe or oversized provider output', () => {
  for (const bad of [{ ...event, title: '<script>' }, { ...event, title: 'x'.repeat(201) }, { ...event, ownerId: 'other' }])
    assert.throws(() => normalizeImportPreview('events', [event, bad]));
  assert.throws(() => normalizeImportPreview('holidays', [holiday, { ...holiday, label: '<b>Unsafe</b>' }]));
  assert.throws(() => normalizeImportPreview('events', Array(101).fill(event)));
  assert.equal(normalizeImportPreview('events', [{ ...event, title: '  Cafe\u0301  ' }])[0].title, 'Café');
});
test('exact normalized event and holiday identities detect possible duplicates', () => {
  assert.equal(previewDuplicate('events', event, [{ ...event, title: 'ASSEMBLY', startTime: null, endTime: null }]), true);
  assert.equal(previewDuplicate('events', event, [{ ...event, title: 'Other', startTime: null, endTime: null }]), false);
  assert.equal(previewDuplicate('holidays', holiday, [{ ...holiday, label: 'inset day', holidayType: 'public' }]), true);
});
