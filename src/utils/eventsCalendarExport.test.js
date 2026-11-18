import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEventsCalendar, eventsCalendarFileName } from './eventsCalendarExport.js';

const yearId = '10000000-0000-4000-8000-000000000001';
const event = (id, fields = {}) => ({ id, academicYearId:yearId, revision:1,
  date:'2026-12-31', title:'End of term', startTime:null, endTime:null,
  location:null, notes:null, ...fields });
const id = '20000000-0000-4000-8000-000000000001';
const stamp = new Date('2026-11-18T12:34:56.000Z');

test('one-day all-day event has an exclusive next-day end across year and leap-day boundaries', () => {
  const calendar = buildEventsCalendar([event(id)], yearId, {now:stamp});
  assert.match(calendar,/DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  const leap = buildEventsCalendar([event(id,{date:'2028-02-29'})],yearId,{now:stamp});
  assert.match(leap,/DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301/);
  const last = buildEventsCalendar([event(id,{date:'9999-12-31'})],yearId,{now:stamp});
  assert.match(last,/DTSTART;VALUE=DATE:99991231\r\nSUMMARY:/);
  assert.match(calendar,/UID:20000000-0000-4000-8000-000000000001@plannix\.co\.uk/);
  assert.equal(eventsCalendarFileName({label:'2026/27'}),'plannix-events-2026-27.ics');
});

test('timed events retain London wall times and include both UK clock-change rules', () => {
  const events = [
    event(id,{date:'2027-03-27',startTime:'09:00',endTime:'10:30',title:'Before spring clock change'}),
    event('20000000-0000-4000-8000-000000000002',
      {date:'2027-03-29',startTime:'09:00',endTime:'10:30',title:'After spring clock change'}),
    event('20000000-0000-4000-8000-000000000003',
      {date:'2027-10-24',startTime:'09:00',endTime:'10:30',title:'After autumn clock change'}),
    event('20000000-0000-4000-8000-000000000004',
      {date:'2027-03-28',startTime:'01:30',endTime:'01:45',title:'Spring transition hour'}),
    event('20000000-0000-4000-8000-000000000005',
      {date:'2027-10-31',startTime:'01:30',endTime:'01:45',title:'Autumn transition hour'}),
  ];
  const calendar = buildEventsCalendar(events,yearId,{now:stamp});
  for (const date of ['20270327','20270329','20271024']) {
    assert.ok(calendar.includes(`DTSTART;TZID=Europe/London:${date}T090000`));
    assert.ok(calendar.includes(`DTEND;TZID=Europe/London:${date}T103000`));
  }
  assert.match(calendar,/RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU/);
  assert.match(calendar,/RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU/);
  // The Events model stores wall times, without a UTC offset or fold choice.
  assert.ok(calendar.includes('DTSTART;TZID=Europe/London:20270328T013000'));
  assert.ok(calendar.includes('DTSTART;TZID=Europe/London:20271031T013000'));
  assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,5);
  assert.equal((calendar.match(/BEGIN:VTIMEZONE/g)||[]).length,1);
});

test('calendar text escapes punctuation and newlines and folds Unicode by UTF-8 octets', () => {
  const calendar = buildEventsCalendar([event(id,{title:'Science, Art; Music \\ club',
    location:'Room, 2; West \\ wing', notes:`Line one\n${'é'.repeat(80)}, item`})],yearId,{now:stamp});
  const unfolded = calendar.replace(/\r\n /g,'');
  assert.match(unfolded,/SUMMARY:Science\\, Art\\; Music \\\\ club\r\n/);
  assert.match(unfolded,/LOCATION:Room\\, 2\\; West \\\\ wing\r\n/);
  assert.match(unfolded,/DESCRIPTION:Line one\\n/);
  assert.ok(unfolded.includes('\\, item'));
  for (const line of calendar.split('\r\n')) assert.ok(new TextEncoder().encode(line).length<=75);
  assert.ok(calendar.endsWith('\r\n'));
});

test('export rejects absent, duplicate, malformed and wrong-year saved records instead of emitting a partial file', () => {
  assert.throws(()=>buildEventsCalendar([],yearId),/unavailable/);
  assert.throws(()=>buildEventsCalendar([event(id),event(id)],yearId),/invalid/);
  assert.throws(()=>buildEventsCalendar([event(id,{academicYearId:'10000000-0000-4000-8000-000000000002'})],yearId),/invalid/);
  assert.throws(()=>buildEventsCalendar([event(id,{date:'2027-02-30'})],yearId),/invalid/);
  assert.throws(()=>buildEventsCalendar([event(id,{startTime:'09:00',endTime:null})],yearId),/paired/);
});
