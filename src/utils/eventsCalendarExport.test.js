import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEventsCalendar, downloadEventsCalendar, eventsCalendarFileName } from './eventsCalendarExport.js';

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

test('a multi-event calendar declares the publication method required by Exchange import', () => {
  const events = Array.from({ length: 249 }, (_, index) => event(
    `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    { date: '2026-12-31', title: `Synthetic event ${index + 1}` }));
  const calendar = buildEventsCalendar(events, yearId, { now: stamp });
  assert.match(calendar, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:[^\r\n]+\r\nMETHOD:PUBLISH\r\n/);
  assert.equal((calendar.match(/\r\nMETHOD:/g) || []).length, 1);
  assert.equal((calendar.match(/BEGIN:VEVENT\r\n/g) || []).length, events.length);
  assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));
});

test('download supplies matching publication media type without changing event bytes', async () => {
  let blob;
  let filename;
  let revoked = false;
  const browser = {
    Blob,
    URL: { createObjectURL(value) { blob = value; return 'blob:synthetic-calendar'; },
      revokeObjectURL() { revoked = true; } },
    document: { body: { append() {} }, createElement() {
      return { click() { filename = this.download; }, remove() {} };
    } },
    setTimeout(callback) { callback(); },
  };
  const calendar = buildEventsCalendar([event(id)], yearId, { now: stamp });
  downloadEventsCalendar(calendar, 'plannix-events-2026-27.ics', browser);
  assert.equal(blob.type, 'text/calendar;charset=utf-8;method=publish');
  assert.equal(await blob.text(), calendar);
  assert.equal(filename, 'plannix-events-2026-27.ics');
  assert.equal(revoked, true);
});

const closureId = '50000000-0000-4000-8000-000000000001';
const closure = (fields = {}) => ({ id:closureId, label:'Winter holiday', holidayType:'school',
  startDate:'2026-12-19', endDate:'2027-01-03', ...fields });
const plan = holidays => ({ id:yearId, label:'2026/27', startDate:'2026-09-01', endDate:'2027-08-31', holidays });

test('saved holiday ranges remain one entry with inclusive-to-exclusive year and leap-day ends', () => {
  const calendar = buildEventsCalendar([],yearId,{ now:stamp, academicYear:plan([closure()]) });
  assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,1);
  assert.match(calendar,/DTSTART;VALUE=DATE:20261219\r\nDTEND;VALUE=DATE:20270104/);
  assert.match(calendar,/SUMMARY:Winter holiday/);
  const leapPlan = { ...plan([]), startDate:'2027-09-01', endDate:'2028-08-31', holidays:[closure({startDate:'2028-02-28',endDate:'2028-02-29'})] };
  assert.match(buildEventsCalendar([],yearId,{academicYear:leapPlan}),/DTSTART;VALUE=DATE:20280228\r\nDTEND;VALUE=DATE:20280301/);
});

test('single-day INSET and public holidays retain labels and stable IDs distinct from event IDs', () => {
  const academicYear=plan([closure({id, label:'INSET training', startDate:'2026-09-01',endDate:'2026-09-01'}),
    closure({holidayType:'public',label:'Public holiday',startDate:'2026-12-25',endDate:'2026-12-25'})]);
  const calendar=buildEventsCalendar([event(id)],yearId,{academicYear,now:stamp});
  assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,3);
  assert.match(calendar,/UID:holiday-20000000-0000-4000-8000-000000000001@plannix.co.uk/);
  assert.match(calendar,/UID:20000000-0000-4000-8000-000000000001@plannix.co.uk/);
  assert.match(calendar,/DTSTART;VALUE=DATE:20260901\r\nDTEND;VALUE=DATE:20260902\r\nSUMMARY:INSET training/);
  assert.match(calendar,/SUMMARY:Public holiday/);
  const later=buildEventsCalendar([event(id)],yearId,{academicYear,now:new Date('2026-11-19T00:00:00Z')});
  assert.deepEqual(calendar.match(/UID:[^\r]+/g),later.match(/UID:[^\r]+/g));
});

test('incomplete, wrong-year, duplicate or out-of-range closure data blocks the whole calendar', () => {
  for(const academicYear of [
    {...plan([]),id:'10000000-0000-4000-8000-000000000002'},
    {...plan([]),holidays:undefined},
    plan([closure({id:null})]), plan([closure(),closure()]),
    plan([closure({endDate:'2027-02-30'})]), plan([closure({startDate:'2026-08-31'})]),
    plan([closure({startDate:'2027-01-04'})]),
  ]) assert.throws(()=>buildEventsCalendar([event(id)],yearId,{academicYear}),/invalid/);
});

test('holiday labels retain the wider saved-name contract and escape calendar text', () => {
  const academicYear=plan([closure({label:'Training <all staff>, briefing; room \\ A\nSecond line'})]);
  const calendar=buildEventsCalendar([],yearId,{academicYear}).replace(/\r\n /g,'');
  assert.ok(calendar.includes('SUMMARY:Training <all staff>\\, briefing\\; room \\\\ A\\nSecond line\r\n'));
});
