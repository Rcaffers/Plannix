import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryError, mergeReviewedHolidays, suggestionError, textBytes } from './holidayReview.js';
const holiday = { label: 'Autumn break', startDate: '2026-10-20', endDate: '2026-10-28' };
const draft = { label: '2026/27', startDate: '2026-09-01', endDate: '2027-08-31', holidays: [{ ...holiday, id: 'existing' }] };
test('review adds atomically, skips normalized duplicates and preserves differently labelled overlaps', () => {
  const before = structuredClone(draft);
  const result = mergeReviewedHolidays(draft, [{ ...holiday, label: ' AUTUMN   break ' }, { ...holiday, label: 'Another closure' }]);
  assert.deepEqual(draft, before); assert.equal(result.skipped, 1); assert.equal(result.added, 1);
  assert.deepEqual(result.draft.holidays[0], draft.holidays[0]); assert.ok(result.draft.holidays[1].id);
});
for (const patch of [{ label: '' }, { label: 'x'.repeat(201) }, { startDate: '2026-02-30' }, { endDate: '2026-10-01' }, { endDate: '2028-01-01' }, { id: 'untrusted' }]) {
  test(`invalid review is atomic: ${JSON.stringify(patch)}`, () => {
    const before = structuredClone(draft);
    assert.throws(() => mergeReviewedHolidays(draft, [{ ...holiday, label: 'valid' }, { ...holiday, ...patch }]));
    assert.deepEqual(draft, before);
  });
}
test('100 total enforced after duplicate removal; empty selection rejected', () => {
  const full = { ...draft, holidays: Array.from({ length: 100 }, (_, index) => ({ ...holiday, label: `Holiday ${index}`, id: `${index}` })) };
  assert.equal(mergeReviewedHolidays(full, [{ ...holiday, label: 'Holiday 0' }]).skipped, 1);
  assert.throws(() => mergeReviewedHolidays(full, [holiday]), /100/);
  assert.throws(() => mergeReviewedHolidays(draft, []), /Select/);
});
test('real boundaries, multibyte limits and revalidation', () => {
  assert.ok(boundaryError('2026-02-30', '2027-01-01')); assert.ok(boundaryError('2026-01-01', '2029-01-01'));
  assert.equal(boundaryError(draft.startDate, draft.endDate), ''); assert.equal(textBytes('é'.repeat(25001)), 50002);
  assert.ok(suggestionError(holiday, '2026-11-01', draft.endDate));
});

test('review always creates school holidays and duplicate checking spans categories', () => {
  const mixed = { ...draft, holidays: [{ ...holiday, id: 'public', holidayType: 'public' }] };
  const result = mergeReviewedHolidays(mixed, [holiday]);
  assert.equal(result.added, 0);
  assert.deepEqual(result.draft.holidays, mixed.holidays);
  assert.equal(mergeReviewedHolidays(mixed, [{ ...holiday, label: 'Different holiday' }]).draft.holidays[1].holidayType, 'school');
  assert.equal(mergeReviewedHolidays(result.draft, [holiday]).skipped, 1);
  assert.throws(() => mergeReviewedHolidays(mixed, [{ ...holiday, holidayType: 'public' }]), /unexpected/);
});

test('AI combined limits 99, 100 and 101 are atomic across categories', () => {
  for (const count of [99, 100, 101]) {
    const mixed = { ...draft, holidays: Array.from({ length: count }, (_, i) => ({ ...holiday, id: String(i), label: `Existing ${i}`, holidayType: i % 2 ? 'school' : 'public' })) };
    const before = structuredClone(mixed);
    if (count === 99) assert.equal(mergeReviewedHolidays(mixed, [holiday]).draft.holidays.length, 100);
    else assert.throws(() => mergeReviewedHolidays(mixed, [holiday]), /100/);
    assert.deepEqual(mixed, before);
  }
});

test('AI batch from 99 to 101 rejects without adding its valid first suggestion', () => {
  const full = { ...draft, holidays: Array.from({ length: 99 }, (_, i) => ({ ...holiday, id: String(i), label: `Existing ${i}`, holidayType: i % 2 ? 'school' : 'public' })) };
  const before = structuredClone(full);
  assert.throws(() => mergeReviewedHolidays(full, [holiday, { ...holiday, label: 'Second addition' }]), /100/);
  assert.deepEqual(full, before);
});
