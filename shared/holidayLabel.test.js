import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHolidayLabel } from './holidayLabel.js';
test('preserves authoritative NFC, Unicode whitespace and length semantics', () => {
  assert.equal(normalizeHolidayLabel('  Cafe\u0301\u00a0\u2003holiday  '), 'Café holiday');
  assert.equal(normalizeHolidayLabel('School holiday'), 'School holiday');
  assert.equal(normalizeHolidayLabel('é'.repeat(200)), 'é'.repeat(200));
  assert.equal(normalizeHolidayLabel('e\u0301'.repeat(200)), 'é'.repeat(200));
  assert.equal(normalizeHolidayLabel('é'.repeat(201)), null);
  assert.equal(normalizeHolidayLabel('😀'.repeat(100)), '😀'.repeat(100));
  assert.equal(normalizeHolidayLabel('😀'.repeat(101)), null);
});
test('rejects every Cc/Cf code point before normalization', () => {
  for (let point = 0; point <= 0x10ffff; point++) {
    const character = String.fromCodePoint(point);
    if (/[\p{Cc}\p{Cf}]/u.test(character)) assert.equal(normalizeHolidayLabel(`Holiday${character}name`), null, `code point ${point}`);
  }
});
test('rejects invalid types, empty strings and every forbidden markup delimiter', () => {
  for (const label of [null, undefined, 42, {}, [], '', '  \u00a0 ', '<script>text</script>', '<b>Holiday</b>', ...['<','>','`','*','[',']'].map(c => `Holiday${c}name`)]) assert.equal(normalizeHolidayLabel(label), null);
});
