import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLIDAY_SYSTEM_PROMPT, holidayGenerationInput, validateHolidaySuggestions } from './holidayExtraction.js';
import { mergeReviewedHolidays } from '../../src/utils/holidayReview.js';
import { syntheticPdf } from '../pdf/pdfFixtures.js';
import { extractTextFromHolidayPdf } from '../pdf/extractTextFromHolidayPdf.js';

const lines = [
  'INSET DAY 1 — Tuesday 1 September 2026',
  'INSET DAY 2 — Friday 9 October 2026',
  'INSET DAY 3 — Monday 2 November 2026',
  'INSET DAY 4 — Monday 4 January 2027',
  'INSET DAY 5 — Wednesday 21 July 2027',
  'Half term: Closure after school Friday 23 October 2026; Re-open Monday 2 November 2026',
  '190 openings plus 5 INSET days',
];
const dates = ['2026-09-01', '2026-10-09', '2026-11-02', '2027-01-04', '2027-07-21'];
// Expected mocked model response, not a claim of live model recall.
const suggestions = dates.map((date, i) => ({ label: `INSET Day ${i + 1}`, startDate: date, endDate: date }));
suggestions.push({ label: 'Half term', startDate: '2026-10-24', endDate: '2026-11-01' });
const input = { text: lines.join('\n'), academicYearStartDate: '2026-09-01', academicYearEndDate: '2027-08-31' };

test('fixed prompt explicitly covers mixed-case training and non-pupil closure vocabulary', () => {
  for (const term of ['INSET day', 'INSET days', 'inset day', 'teacher-training day', 'teacher training day',
    'staff-training day', 'staff development day', 'professional development day', 'non-pupil day',
    'pupil-free day', 'school closed to pupils', 'regardless of capitalization',
    'identical startDate and endDate', 'Preserve meaningful source labels and numbering',
    'subject to the 100-item limit']) assert.ok(HOLIDAY_SYSTEM_PROMPT.includes(term), term);
  for (const rule of ['not closures by themselves', 'never include that date merely',
    'following day through the day before reopening', 'summaries', 'are not events',
    'additional generic "INSET days"', 'Omit uncertain ranges']) assert.ok(HOLIDAY_SYSTEM_PROMPT.includes(rule), rule);
});

test('five numbered INSET days and half term survive validation and school review without saving', () => {
  const result = validateHolidaySuggestions({ holidays: suggestions }, input);
  assert.equal(result.holidays.length, 6);
  for (const [i, date] of dates.entries()) assert.deepEqual(result.holidays.find(h => h.label === `INSET Day ${i + 1}`),
    { label: `INSET Day ${i + 1}`, startDate: date, endDate: date });
  assert.ok(!result.holidays.some(h => h.label === 'INSET days' || h.label.includes('openings') || h.startDate === '2026-10-23'));
  assert.equal(result.holidays.find(h => h.label === 'Half term').endDate, '2026-11-01');
  const draft = { startDate: input.academicYearStartDate, endDate: input.academicYearEndDate, holidays: [] };
  const merged = mergeReviewedHolidays(draft, result.holidays, { createIds: false });
  assert.equal(merged.added, 6);
  assert.ok(merged.draft.holidays.every(h => h.holidayType === 'school'));
  assert.deepEqual(draft.holidays, []); // Review produces a draft; it does not mutate/persist the saved source.
});

test('INSET duplicate normalization and combined 100 limit retain existing atomic rules', () => {
  assert.throws(() => validateHolidaySuggestions({ holidays: [suggestions[0], { ...suggestions[0], label: ' INSET  Day 1 ' }] }, input), { code: 'AI_INVALID_RESPONSE' });
  const draft = { startDate: input.academicYearStartDate, endDate: input.academicYearEndDate,
    holidays: [{ ...suggestions[0], holidayType: 'public' }] };
  assert.equal(mergeReviewedHolidays(draft, [{ ...suggestions[0], label: 'inset day 1' }], { createIds: false }).skipped, 1);
  for (const count of [99, 100]) {
    const existing = { ...draft, holidays: Array.from({ length: count }, (_, i) => ({ ...suggestions[0], label: `Existing ${i}`, holidayType: i % 2 ? 'school' : 'public' })) };
    if (count === 99) assert.equal(mergeReviewedHolidays(existing, [suggestions[0]], { createIds: false }).draft.holidays.length, 100);
    else assert.throws(() => mergeReviewedHolidays(existing, [suggestions[0]]), /100 holidays/);
    assert.equal(existing.holidays.length, count);
  }
});

test('real synthetic PDF extraction and pasted source receive the identical server prompt and schema', async () => {
  const pdf = await extractTextFromHolidayPdf({ data: syntheticPdf(lines.map(line => line.replaceAll('—', '-'))) });
  const pasted = holidayGenerationInput('fixture-user', input);
  const uploaded = holidayGenerationInput('fixture-user', { ...input, text: pdf.text });
  assert.equal(uploaded.systemPrompt, pasted.systemPrompt);
  assert.deepEqual(uploaded.jsonSchema, pasted.jsonSchema);
  for (let i = 1; i <= 5; i++) assert.ok(uploaded.userContent.includes(`INSET DAY ${i}`));
  assert.deepEqual(validateHolidaySuggestions({ holidays: suggestions }, { ...input, text: pdf.text }),
    validateHolidaySuggestions({ holidays: suggestions }, input));
});
