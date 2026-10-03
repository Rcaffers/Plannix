import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMorningSummary, londonToday, summaryDateInfo } from './morningSummary.js';

const year = { id: 'year', startDate: '2026-09-01', endDate: '2027-07-31', holidays: [] };
const monday = '2026-11-02';
const periods = [
  { id: 'registration', type: 'registration', order: 0 },
  { id: 'one', type: 'teaching', order: 1, startTime: '09:00', endTime: '10:00' },
  { id: 'break', type: 'break', order: 2 },
  { id: 'two', type: 'teaching', order: 3, startTime: '10:20', endTime: '11:20' },
  { id: 'lunch', type: 'lunch', order: 4 },
  { id: 'three', type: 'teaching', order: 5, startTime: '12:00', endTime: '13:00' },
];
const base = { date: monday, dated: { weekStartDate: monday, repeatingWeekId: 'week-b', sessions: [
  { day: 0, periodId: 'one', classId: 'class-a', title: 'Fractions', notes: 'private notes' },
  { day: 0, periodId: 'three', classId: 'class-a', title: '', notes: '' },
] }, periods, classes: [{ id: 'class-a', name: '7A' }], weeks: [{ id: 'week-b', code: 'B' }], events: [
  { id: 'late', date: monday, title: 'Late', startTime: '14:00', endTime: '15:00', location: 'Hall', notes: 'event notes' },
  { id: 'all', date: monday, title: 'All day event', startTime: null, endTime: null, location: null },
  { id: 'early', date: monday, title: 'Early', startTime: '08:00', endTime: '08:30', location: null },
] };

test('London today and calendar weekdays remain correct across spring and autumn DST', () => {
  assert.equal(londonToday(new Date('2027-03-28T23:30:00Z')), '2027-03-29');
  assert.equal(londonToday(new Date('2027-10-31T23:30:00Z')), '2027-10-31');
  assert.equal(summaryDateInfo('2027-03-28', year).eligible, false);
  assert.equal(summaryDateInfo('2027-03-29', year).monday, '2027-03-29');
  assert.equal(summaryDateInfo('2027-10-31', year).eligible, false);
  assert.equal(summaryDateInfo('2027-11-01', { ...year, endDate: '2027-12-01' }).monday, '2027-11-01');
});

test('weekends, year boundaries and every inclusive closure day have no summary', () => {
  assert.equal(summaryDateInfo('2026-08-31', year).eligible, false);
  assert.equal(summaryDateInfo('2027-08-01', year).eligible, false);
  assert.equal(summaryDateInfo('2026-11-07', year).eligible, false);
  assert.equal(summaryDateInfo('2026-11-08', year).eligible, false);
  const closed = { ...year, holidays: [{ label: 'INSET', startDate: '2026-11-02', endDate: '2026-11-04' }] };
  for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) {
    assert.equal(summaryDateInfo(date, closed).eligible, false);
  }
  assert.equal(summaryDateInfo('2026-11-05', closed).eligible, true);
  assert.equal(summaryDateInfo('2026-11-02', { ...year, holidays: [{ startDate: monday, endDate: monday, holidayType: 'public' }] }).eligible, false);
});

test('canonical dated Week B sessions produce P1/P2/P3, genuine PPA and ordered events without notes', () => {
  const result = buildMorningSummary(base);
  assert.equal(result.week, 'B');
  assert.deepEqual(result.lessons.map(item => [item.period, item.className, item.title, item.isPpa]), [
    ['P1', '7A', 'Fractions', false], ['P2', null, '', true], ['P3', '7A', '', false],
  ]);
  assert.deepEqual(result.events.map(item => item.title), ['All day event', 'Early', 'Late']);
  assert.doesNotMatch(JSON.stringify(result), /private notes|event notes/);
  assert.equal(buildMorningSummary({ ...base, dated: { ...base.dated, repeatingWeekId: 'week-a' },
    weeks: [{ id: 'week-a', code: 'A' }] }).week, 'A');
});

test('failed or inconsistent dated data cannot fabricate blank PPA', () => {
  assert.throws(() => buildMorningSummary({ ...base, dated: null }), /incomplete/);
  assert.throws(() => buildMorningSummary({ ...base, dated: { ...base.dated, weekStartDate: '2026-11-09' } }), /incomplete/);
  assert.throws(() => buildMorningSummary({ ...base, dated: { ...base.dated, sessions: [{ day: 0, periodId: 'one', classId: 'missing', title: '' }] } }), /incomplete/);
  assert.throws(() => buildMorningSummary({ ...base, weeks: [] }), /incomplete/);
});
