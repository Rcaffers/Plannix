import assert from 'node:assert/strict';
import test from 'node:test';
import { eventIdentityKey, normalizeEventFields, realEventDate } from './personalEvent.js';
const base = { date: '2026-09-01', title: '  Café   Day ', startTime: null, endTime: null };
test('real local dates and paired local times without UTC conversion', () => {
  assert.equal(realEventDate('2026-02-29'), false);
  assert.equal(realEventDate('2028-02-29'), true);
  assert.deepEqual(normalizeEventFields(base), { date: '2026-09-01', title: 'Café Day', startTime: null, endTime: null, location: null, notes: null });
  assert.deepEqual(normalizeEventFields({ ...base, startTime: '09:00', endTime: '10:00' }).startTime, '09:00');
  for (const times of [{ startTime: '09:00' }, { startTime: '10:00', endTime: '09:00' }, { startTime: '9:00', endTime: '10:00' }]) {
    assert.throws(() => normalizeEventFields({ ...base, ...times }));
  }
});
test('text limits, controls and type checks are shared by browser and server', () => {
  assert.equal(normalizeEventFields({ ...base, title: 'Cafe\u0301  Day' }).title, 'Café Day');
  assert.equal(normalizeEventFields({ ...base, title: 'x'.repeat(200) }).title.length, 200);
  for (const patch of [
    { title: '' }, { title: 'x'.repeat(201) }, { title: 'Bad\u200b' }, { title: 'Bad\u0001' },
    { title: '<script>' }, { location: 'x'.repeat(201) }, { notes: 'x'.repeat(2001) },
    { title: 4 }, { location: 4 }, { notes: 4 }, { date: '2026-02-30' }, { ownerId: 'attacker' },
  ]) assert.throws(() => normalizeEventFields({ ...base, ...patch }));
  assert.equal(normalizeEventFields({ ...base, notes: '  Line 1\r\nLine 2  ' }).notes, 'Line 1\nLine 2');
});
test('duplicate identity ignores case, NFC and repeated whitespace but preserves times', () => {
  const first = normalizeEventFields(base);
  const second = normalizeEventFields({ ...base, title: 'cafe\u0301 day' });
  assert.equal(eventIdentityKey(first), eventIdentityKey(second));
  assert.notEqual(eventIdentityKey(first), eventIdentityKey({ ...first, startTime: '09:00', endTime: '10:00' }));
});
test('Unicode 16 format controls and mistaken non-format code points follow their categories', () => {
  for (const cp of [0x110bd, 0x110cd]) {
    for (const field of ['title', 'location', 'notes']) {
      assert.throws(() => normalizeEventFields({ ...base, [field]: 'A' + String.fromCodePoint(cp) + 'B' }));
    }
  }
  for (const cp of [0x10cbd, 0x10ccd, 0x2065]) {
    assert.equal(normalizeEventFields({ ...base, title: 'A' + String.fromCodePoint(cp) + 'B' }).title,
      'A' + String.fromCodePoint(cp) + 'B');
  }
  assert.equal(normalizeEventFields({ ...base, notes: 'Line one\r\nLine two\tmore' }).notes,
    'Line one\nLine two more');
});
