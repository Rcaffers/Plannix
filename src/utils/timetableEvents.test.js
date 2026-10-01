import assert from 'node:assert/strict';
import test from 'node:test';
import { eventsForDate, localCalendarDayDifference, weekEventDates } from './timetableEvents.js';

test('Europe/London calendar indexing survives spring and autumn clock changes', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    const date = (year, month, day) => new Date(year, month - 1, day, 12);
    assert.equal(localCalendarDayDifference(date(2027, 3, 27), date(2027, 3, 22)), 5);
    assert.equal(localCalendarDayDifference(date(2027, 3, 28), date(2027, 3, 22)), 6);
    assert.equal(localCalendarDayDifference(date(2027, 10, 30), date(2027, 10, 25)), 5);
    assert.equal(localCalendarDayDifference(date(2027, 10, 31), date(2027, 10, 25)), 6);
    assert.equal(localCalendarDayDifference(date(2027, 7, 4), date(2027, 6, 28)), 6);
    assert.equal(localCalendarDayDifference(date(2028, 1, 2), date(2027, 12, 27)), 6);
    assert.deepEqual(weekEventDates('2027-03-22').slice(5), ['2027-03-27', '2027-03-28']);
    assert.deepEqual(weekEventDates('2027-10-25').slice(5), ['2027-10-30', '2027-10-31']);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('Monday through Sunday map to local dates across month and year boundaries', () => {
  assert.deepEqual(weekEventDates('2027-12-27'), [
    '2027-12-27', '2027-12-28', '2027-12-29', '2027-12-30', '2027-12-31', '2028-01-01', '2028-01-02',
  ]);
});

test('holiday and weekend events remain on their dates; all-day cards sort before timed cards', () => {
  const make = (id, date, startTime, title) => ({ id, date, startTime, title });
  const events = [make('c', '2026-10-31', '09:00', 'Trip'), make('b', '2026-10-31', null, 'Closed'),
    make('a', '2026-10-31', null, 'Assembly'), make('d', '2026-10-31', '09:00', 'Trip'),
    make('holiday', '2026-10-30', null, 'Half-term')];
  assert.deepEqual(eventsForDate(events, '2026-10-31').map(item => item.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(eventsForDate(events, '2026-10-30').map(item => item.id), ['holiday']);
});
