import { CANONICAL_EVENT_UUID, normalizeEventFields, realEventDate } from '../../shared/personalEvent.js';

const encoder = new TextEncoder();
const LONDON_ZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'BEGIN:DAYLIGHT',
  'DTSTART:19960331T010000',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:BST',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'DTSTART:19961027T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:GMT',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const compactDate = value => value.replaceAll('-', '');
const escapeText = value => value.replaceAll('\\', '\\\\').replace(/\r\n?|\n/g, '\\n')
  .replaceAll(';', '\\;').replaceAll(',', '\\,');

// RFC 5545 folds content lines at 75 UTF-8 octets, never in a code point.
function fold(line) {
  const parts = [];
  let part = '';
  let bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) { parts.push(part); part = ' '; bytes = 1; }
    part += character;
    bytes += length;
  }
  parts.push(part);
  return parts.join('\r\n');
}

function nextDate(value) {
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return compactDate(next.toISOString().slice(0, 10));
}

export function eventsCalendarFileName(year) {
  const fallback = `${year?.startDate?.slice(0, 4) || 'year'}-${year?.endDate?.slice(0, 4) || 'unknown'}`;
  const label = String(year?.label || fallback).normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback;
  return `plannix-events-${label}.ics`;
}

export function buildEventsCalendar(events, academicYearId, { now = new Date(), academicYear } = {}) {
  const holidays = academicYear?.holidays ?? [];
  if (!CANONICAL_EVENT_UUID.test(academicYearId) || !Array.isArray(events) || !Array.isArray(holidays)
    || (!events.length && !holidays.length)
    || !Number.isFinite(now?.getTime?.())) throw new Error('Saved events are unavailable for export.');
  if (academicYear && (academicYear.id !== academicYearId || !Array.isArray(academicYear.holidays)
    || !realEventDate(academicYear.startDate) || !realEventDate(academicYear.endDate)
    || academicYear.startDate > academicYear.endDate)) throw new Error('Saved academic year is invalid.');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  // Exchange import requires METHOD even for a one-off calendar file.
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plannix//Events Export//EN',
    'METHOD:PUBLISH',
    'CALSCALE:GREGORIAN', ...LONDON_ZONE];
  const ids = new Set();
  for (const event of events) {
    if (!CANONICAL_EVENT_UUID.test(event?.id) || event.academicYearId !== academicYearId
      || ids.has(event.id) || !Number.isSafeInteger(event.revision) || event.revision < 1
      || !realEventDate(event.date)) throw new Error('Saved event data is invalid.');
    ids.add(event.id);
    const fields = normalizeEventFields({ date:event.date, title:event.title,
      startTime:event.startTime, endTime:event.endTime, location:event.location, notes:event.notes });
    lines.push('BEGIN:VEVENT', `UID:${event.id}@plannix.co.uk`, `DTSTAMP:${stamp}`,
      `SEQUENCE:${event.revision - 1}`);
    if (fields.startTime === null) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(fields.date)}`);
      // The DATE value has four year digits; omitting DTEND still means one
      // day when the saved date is the last representable day.
      if (fields.date !== '9999-12-31') lines.push(`DTEND;VALUE=DATE:${nextDate(fields.date)}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/London:${compactDate(fields.date)}T${fields.startTime.replace(':', '')}00`,
        `DTEND;TZID=Europe/London:${compactDate(fields.date)}T${fields.endTime.replace(':', '')}00`);
    }
    lines.push(`SUMMARY:${escapeText(fields.title)}`);
    if (fields.location) lines.push(`LOCATION:${escapeText(fields.location)}`);
    if (fields.notes) lines.push(`DESCRIPTION:${escapeText(fields.notes)}`);
    lines.push('END:VEVENT');
  }
  const holidayIds = new Set();
  for (const holiday of holidays) {
    if (!CANONICAL_EVENT_UUID.test(holiday?.id) || holidayIds.has(holiday.id)
      || !['school', 'public'].includes(holiday.holidayType)
      || !realEventDate(holiday.startDate) || !realEventDate(holiday.endDate)
      || holiday.startDate > holiday.endDate || holiday.startDate < academicYear.startDate
      || holiday.endDate > academicYear.endDate || typeof holiday.label !== 'string'
      || !holiday.label.trim() || holiday.label.trim().length > 200
      || /[\p{Cc}]/u.test(holiday.label.replace(/[\r\n\t]/g, ''))) throw new Error('Saved holiday data is invalid.');
    holidayIds.add(holiday.id);
    // INSET and other closures are saved as holidays with permanent row IDs.
    lines.push('BEGIN:VEVENT', `UID:holiday-${holiday.id}@plannix.co.uk`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(holiday.startDate)}`);
    if (holiday.endDate !== '9999-12-31') lines.push(`DTEND;VALUE=DATE:${nextDate(holiday.endDate)}`);
    else if (holiday.startDate !== holiday.endDate) throw new Error('Holiday end is outside the calendar date range.');
    lines.push(`SUMMARY:${escapeText(holiday.label)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function downloadEventsCalendar(contents, filename, browser = globalThis) {
  const url = browser.URL.createObjectURL(new browser.Blob([contents], { type:'text/calendar;charset=utf-8;method=PUBLISH' }));
  try {
    const link = browser.document.createElement('a');
    link.href = url;
    link.download = filename;
    browser.document.body.append(link);
    try { link.click(); }
    finally { link.remove(); }
  } finally {
    // Leave the object URL alive briefly for browsers that start downloads later.
    browser.setTimeout(() => browser.URL.revokeObjectURL(url), 1000);
  }
}
