import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarDays, buildClassMonitor, holidayReportKind, MAX_DATED_REPORT_WEEKS,
  mondayFor, reportDateError, reportMondays, REPORT_RANGE_LIMIT_MESSAGE } from './classMonitor.js';

const classId = 'class-a', periodId = 'period-1';
const session = (id, title, day = 0) => ({ id, classId, periodId, day, title, notes: `${title} notes` });
const periods = [{ id: periodId, type: 'teaching', number: 1, order: 1, startTime: '09:00', endTime: '10:00' }];
const year = { startDate: '2026-09-01', endDate: '2027-08-31', holidays: [
  { label: 'INSET Day', closureType: 'closure', startDate: '2026-09-01', endDate: '2026-09-01' },
  { label: 'Half term', startDate: '2026-10-26', endDate: '2026-10-30' },
] };

test('local calendar dates survive both London clock changes and year boundaries', () => {
  assert.equal(mondayFor('2027-03-28'), '2027-03-22');
  assert.equal(addCalendarDays('2027-03-27', 1), '2027-03-28');
  assert.equal(addCalendarDays('2027-10-30', 1), '2027-10-31');
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(mondayFor('2027-01-01'), '2026-12-28');
  assert.equal(reportDateError('2026-08-31', '2026-09-01', year), 'Keep report dates within the selected academic year.');
  assert.equal(reportDateError('2027-02-30', '2027-03-01', year), 'Enter a valid From and To date in order.');
});

test('the report preflight permits exactly 60 calendar weeks and rejects 61 before enumeration', () => {
  const longYear = { ...year, endDate: '2028-08-31', holidays: [] };
  const from = '2026-09-07';
  const finalMonday = addCalendarDays(from, (MAX_DATED_REPORT_WEEKS - 1) * 7);
  const finalSunday = addCalendarDays(finalMonday, 6);
  assert.equal(reportDateError(from, finalSunday, longYear), '');
  assert.equal(reportMondays(from, finalSunday, longYear).length, 60);
  assert.equal(reportDateError(from, addCalendarDays(finalSunday, 1), longYear), REPORT_RANGE_LIMIT_MESSAGE);
  assert.deepEqual(reportMondays(from, addCalendarDays(finalSunday, 1), longYear), []);
  assert.equal(reportDateError('2027-03-22', '2027-03-28', longYear), '');
  assert.equal(reportDateError('2027-10-25', '2027-10-31', longYear), '');
});

test('inclusive week selection retains unclassified school ranges and closure weeks', () => {
  assert.deepEqual(reportMondays('2026-10-25', '2026-11-02', year), ['2026-10-26', '2026-11-02']);
  assert.deepEqual(reportMondays('2026-09-01', '2026-09-01', year), ['2026-08-31']);
  assert.deepEqual(reportMondays('2026-10-25', '2026-11-02', { ...year, holidays: [
    { label: 'Public holiday week', holidayType: 'public', startDate: '2026-10-26', endDate: '2026-10-30' },
  ] }), ['2026-11-02']);
});

test('dated A/B weeks, duplicate-slot lessons, INSET slots and holiday separators stay distinct', () => {
  const input = { year, from: '2026-09-01', to: '2026-11-02', classId, periods,
    recurringWeeks: [{ weekId: 'week-a', sessions: [session('a', 'Pattern A', 1), session('a2', 'Second lesson', 1)] },
      { weekId: 'week-b', sessions: [session('b', 'Pattern B', 0)] }],
    datedWeeks: [
      { weekStartDate: '2026-08-31', repeatingWeekId: 'week-a', sessions: [] },
      { weekStartDate: '2026-11-02', repeatingWeekId: 'week-b', sessions: [session('dated', 'Dated B', 0)] },
    ] };
  const rows = buildClassMonitor(input);
  assert.equal(rows.filter(row => row.type === 'closure').length, 2);
  assert.ok(rows.filter(row => row.type === 'closure').every(row => row.date === '2026-09-01' && row.label === 'INSET Day'));
  assert.equal(rows.filter(row => row.type === 'lesson').length, 1);
  assert.equal(rows.find(row => row.type === 'lesson').title, 'Dated B');
  assert.deepEqual(rows.find(row => row.type === 'school-unknown'), { type: 'school-unknown', date: '2026-10-26', label: 'Half term',
    startDate: '2026-10-26', endDate: '2026-10-30', visibleStart: '2026-10-26', visibleEnd: '2026-10-30' });
  assert.deepEqual(rows.map(row => row.date), ['2026-09-01', '2026-09-01', '2026-10-26', '2026-11-02']);
  assert.deepEqual(buildClassMonitor({ ...input, from: '2026-10-28', to: '2026-10-29' }).map(row =>
    [row.type, row.visibleStart, row.visibleEnd]), [['school-unknown', '2026-10-28', '2026-10-29']]);
});

test('empty slots and unscheduled lessons never become report entries', () => {
  assert.deepEqual(buildClassMonitor({ year: { ...year, holidays: [] }, from: '2027-01-04', to: '2027-01-04', classId, periods,
    recurringWeeks: [], datedWeeks: [{ weekStartDate: '2027-01-04', sessions: [{ ...session('other', 'Other class'), classId: 'class-b' }], repeatingWeekId: 'week-a' }] }), []);
});

test('configured period order wins over input order, and overlapping closures do not duplicate slots', () => {
  const later = { id: 'period-2', type: 'teaching', number: 2, order: 2, startTime: '10:00', endTime: '11:00' };
  const sameDate = { ...year, holidays: [
    { label: 'INSET Day', closureType: 'closure', startDate: '2026-09-01', endDate: '2026-09-01' },
    { label: 'Staff training', closureType: 'closure', startDate: '2026-09-01', endDate: '2026-09-01' },
  ] };
  const rows = buildClassMonitor({ year: sameDate, from: '2026-09-01', to: '2026-09-01', classId,
    periods: [later, ...periods], recurringWeeks: [{ weekId: 'week-a', sessions: [
      { ...session('second', 'Later', 1), periodId: later.id }, session('first', 'Earlier', 1),
    ] }], datedWeeks: [{ weekStartDate: '2026-08-31', repeatingWeekId: 'week-a', sessions: [] }] });
  assert.deepEqual(rows.map(row => [row.type, row.sessionId, row.label]), [
    ['closure', 'first', 'INSET Day'], ['closure', 'second', 'INSET Day'],
  ]);
});

test('public duration never implies missed lessons; unclassified school duration never implies INSET', () => {
  const holidays = [
    { label: 'Public single day', holidayType: 'public', startDate: '2026-09-08', endDate: '2026-09-08' },
    { label: 'Public range', holidayType: 'public', startDate: '2026-09-09', endDate: '2026-09-10' },
    { label: 'INSET-looking label', holidayType: 'school', startDate: '2026-09-11', endDate: '2026-09-11' },
    { label: 'School range', holidayType: 'school', startDate: '2026-09-14', endDate: '2026-09-18' },
  ];
  assert.deepEqual(holidays.map(holidayReportKind), ['holiday', 'holiday', 'school-unknown', 'school-unknown']);
  const rows = buildClassMonitor({ year: { ...year, holidays }, from: '2026-09-08', to: '2026-09-18', classId,
    periods, recurringWeeks: [{ weekId: 'week-a', sessions: [session('a', 'Pattern', 1)] }],
    datedWeeks: [{ weekStartDate: '2026-09-07', repeatingWeekId: 'week-a', sessions: [] },
      { weekStartDate: '2026-09-14', repeatingWeekId: 'week-a', sessions: [] }] });
  assert.deepEqual(rows.map(row => [row.type, row.label]), [
    ['holiday', 'Public single day'], ['holiday', 'Public range'],
    ['school-unknown', 'INSET-looking label'], ['school-unknown', 'School range'],
  ]);
  assert.deepEqual(reportMondays('2026-09-14', '2026-09-18', { ...year, holidays }), ['2026-09-14']);
});

test('explicit multi-day closures use each affected recurring slot and overlapping ranges do not duplicate them', () => {
  const holidays = [
    { label: 'Training', closureType: 'closure', startDate: '2026-09-07', endDate: '2026-09-11' },
    { label: 'Other closure', closureType: 'closure', startDate: '2026-09-08', endDate: '2026-09-09' },
  ];
  const rows = buildClassMonitor({ year: { ...year, holidays }, from: '2026-09-08', to: '2026-09-09', classId,
    periods, recurringWeeks: [{ weekId: 'week-a', sessions: [session('tuesday', 'Pattern', 1), session('wednesday', 'Pattern', 2)] }],
    datedWeeks: [{ weekStartDate: '2026-09-07', repeatingWeekId: 'week-a', sessions: [] }] });
  assert.deepEqual(rows.map(row => [row.type, row.date, row.sessionId, row.label]), [
    ['closure', '2026-09-08', 'tuesday', 'Training'], ['closure', '2026-09-09', 'wednesday', 'Training'],
  ]);
  assert.deepEqual(reportMondays('2026-09-07', '2026-09-11', { ...year, holidays }), ['2026-09-07']);
});
