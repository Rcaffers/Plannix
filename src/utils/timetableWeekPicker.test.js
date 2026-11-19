import test from 'node:test';
import assert from 'node:assert/strict';
import { pickerDate, pickerAddDays, pickerMonday, pickerShiftMonth, pickerClamp, pickerDays } from './timetableWeekPicker.js';

test('strict dates reject invalid academic-year boundaries', () => {
  for (const date of ['', null, '2027-02-29', '2026-13-01', '2026-1-01']) assert.equal(pickerDate(date), null);
  assert.ok(pickerDate('2028-02-29'));
});
test('calendar uses local Monday weeks across year and London clock boundaries', () => {
  assert.equal(pickerMonday('2027-01-03'), '2026-12-28');
  assert.equal(pickerMonday('2027-01-04'), '2027-01-04');
  assert.equal(pickerMonday('2027-03-28'), '2027-03-22');
  assert.equal(pickerAddDays('2027-03-28', 1), '2027-03-29');
  assert.equal(pickerAddDays('2027-10-31', 1), '2027-11-01');
});
test('month movement preserves valid days and clamps academic-year bounds', () => {
  assert.equal(pickerShiftMonth('2027-01-31', 1), '2027-02-28');
  assert.equal(pickerShiftMonth('2028-03-31', -1), '2028-02-29');
  assert.equal(pickerClamp('2027-04-30', '2026-09-01', '2027-04-04'), '2027-04-04');
  assert.equal(pickerClamp('2026-08-31', '2026-09-01', '2027-04-04'), '2026-09-01');
  assert.equal(pickerClamp('2026-10-12', '2026-09-01', '2027-04-04'), '2026-10-12');
});
test('month grid contains six complete Monday-to-Sunday weeks', () => {
  const days = pickerDays('2027-01-03');
  assert.equal(days.length, 42);
  assert.equal(days[0], '2026-12-28');
  assert.equal(days.at(-1), '2027-02-07');
  assert.equal(new Set(days).size, 42);
});
