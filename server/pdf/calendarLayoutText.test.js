import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calendarPageLayout } from './calendarLayoutText.js';
import { extractTextFromHolidayPdf } from './extractTextFromHolidayPdf.js';

const horizontal = (str, x, y) => ({ str, transform:[5,0,0,5,x,y] });
const vertical = (str, x, y, size = 5) => ({ str, transform:[0,size,-size,0,x,y] });

test('printed month/day columns keep rotated titles and repeated multi-day labels together', () => {
  const items = [horizontal('September',130,769),horizontal('October',420,769)];
  for(let day=1;day<=30;day++) items.push(horizontal(String(day),30+(day-1)*9,761));
  for(let day=1;day<=31;day++) items.push(horizontal(String(day),310+(day-1)*9,761));
  items.push(vertical('Meetings / School Events',25,685,7));
  for(let day=11;day<=13;day++) items.push(vertical('Residential',33+(day-1)*9,74));
  items.push(vertical('Open Evening',313+(8-1)*9,700));
  items.push(horizontal('Unplaced Event',500,350));
  const text=calendarPageLayout(items,1);
  assert.match(text,/September 11–13: Residential/);
  assert.match(text,/October 8: Open Evening/);
  assert.match(text,/Unresolved label \(no reliable date\): Unplaced Event/);
  assert.doesNotMatch(text,/Meetings \/ School Events/);
});

test('weak or missing calendar geometry does not assign a date', () => {
  assert.equal(calendarPageLayout([horizontal('September',100,769),vertical('Trip',100,74)],1),null);
});

test('a repeated label crossing December and January stays in separately labelled months', () => {
  const items=[horizontal('December',90,769),horizontal('January',190,769)];
  for(let day=25;day<=31;day++) items.push(horizontal(String(day),30+(day-25)*9,761));
  for(let day=1;day<=7;day++) items.push(horizontal(String(day),120+(day-1)*9,761));
  items.push(vertical('Winter programme',84,74),vertical('Winter programme',120,74));
  const text=calendarPageLayout(items,1);
  assert.match(text,/December 31: Winter programme/);
  assert.match(text,/January 1: Winter programme/);
  assert.doesNotMatch(text,/December 31–1/);
});

// The supplied school PDF stays outside Git because it contains real school
// content. Operators can rerun this exact-file regression with the local path.
if (process.env.PLANNIX_CALENDAR_REGRESSION_PDF) test('supplied landscape calendar retains known date and range alignments', async () => {
  const data=await readFile(process.env.PLANNIX_CALENDAR_REGRESSION_PDF);
  const original=await extractTextFromHolidayPdf({data});
  const aligned=await extractTextFromHolidayPdf({data,calendarLayout:true});
  assert.equal(aligned.pageCount,3);
  assert.match(aligned.text,/October 8: Open Evening/);
  assert.match(aligned.text,/September 11–13: Kielder Forest Residential/);
  assert.match(aligned.text,/January 21: Yr9 Options Evening/);
  assert.match(aligned.text,/May 14–16: PGL Residential/);
  assert.doesNotMatch(original.text,/October 8: Open Evening/);
  assert.ok(Buffer.byteLength(aligned.text)<50_000);
});
