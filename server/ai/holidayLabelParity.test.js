import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHolidayLabel } from '../../shared/holidayLabel.js';
import { validateHolidaySuggestions } from './holidayExtraction.js';
import { createHolidayExtractionApi } from '../../src/utils/holidayExtractionApi.js';
import { createHolidayPdfExtractionApi } from '../../src/utils/holidayPdfExtractionApi.js';
import { mergeReviewedHolidays, suggestionError } from '../../src/utils/holidayReview.js';
const boundaries = { academicYearStartDate: '2026-09-01', academicYearEndDate: '2027-08-31' };
const good = { label: 'School holiday', startDate: '2026-12-25', endDate: '2026-12-25' };
const cases = [
  ['ASCII NUL', 'Holiday\0name'], ['ASCII tab', 'Holiday\tname'], ['ASCII newline', 'Holiday\nname'], ['DEL', 'Holiday\x7fname'],
  ['Unicode control', 'Holiday\u0085name'], ['Unicode format', 'Holiday\u202ename'], ['zero width', 'Holiday\u200bname'], ['BOM', '\ufeffHoliday'],
  ['script markup', '<script>text</script>'], ['angle markup', '<em>Holiday</em>'], ['Markdown', '[Holiday]'], ['asterisk', 'Holiday*'], ['backtick', '`Holiday`'],
  ['empty', ' \u2003 '], ['length 201', 'a'.repeat(201)], ['length 200', 'a'.repeat(200)],
  ['composed', 'Café holiday'], ['decomposed', 'Cafe\u0301 holiday'], ['normal whitespace', '  School\u00a0\u2003holiday  '], ['normal', good.label],
];
for (const [name, label] of cases) test(`label parity and collection atomicity: ${name}`, async () => {
  const expected = normalizeHolidayLabel(label), holidays = [good, { ...good, label, startDate: '2027-01-01', endDate: '2027-01-01' }];
  const draft = { startDate: boundaries.academicYearStartDate, endDate: boundaries.academicYearEndDate, holidays: [] };
  assert.equal(Boolean(suggestionError(holidays[1], draft.startDate, draft.endDate)), expected === null);
  if (expected === null) {
    assert.throws(() => validateHolidaySuggestions({ holidays }, boundaries), e => e.code === 'AI_INVALID_RESPONSE');
    assert.throws(() => mergeReviewedHolidays(draft, holidays), /Each holiday needs/);
    assert.deepEqual(draft.holidays, []);
  } else assert.equal(validateHolidaySuggestions({ holidays }, boundaries).holidays[1].label, expected);
  for (const pdf of [false, true]) {
    const create = pdf ? createHolidayPdfExtractionApi : createHolidayExtractionApi;
    const extract = create({ getSession: async () => ({ access_token: 'synthetic-session-fixture' }), fetchImpl: async () => new Response(JSON.stringify({ holidays, ...(pdf ? { pageCount: 1 } : {}) })) });
    const input = { ...boundaries, ...(pdf ? { file: new Blob(['Synthetic'], { type: 'application/pdf' }) } : { text: 'Synthetic calendar' }) };
    if (expected === null) await assert.rejects(extract(input), e => e.status === 502 && !e.cause && !e.message.includes(label));
    else { const result = await extract(input); assert.equal((pdf ? result.holidays : result)[1].label, expected); }
  }
});
