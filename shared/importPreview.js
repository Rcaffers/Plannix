import { normalizeEventText, realEventDate, normalizeEventFields, eventIdentityKey } from './personalEvent.js';
import { normalizeHolidayLabel } from './holidayLabel.js';
import { holidayDuplicateKey } from './holidayKey.js';

export const IMPORT_PREVIEW_LIMIT = 100;
export const IMPORT_TEXT_BYTES = 50_000;
export const IMPORT_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMPORT_DESTINATIONS = ['holidays', 'events'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, length, multiline = false) => {
  if (typeof value !== 'string') throw Error();
  const normalized = normalizeEventText(value, length, { multiline });
  return normalized || '';
};
const dateText = value => text(value, 80);
const rawDate = value => text(value, 40);

// The provider may report an unresolved date, but never arbitrary fields or
// unsafe text. The same whole-collection check runs server-side and in browser.
export function normalizeImportPreview(destination, entries) {
  if (!IMPORT_DESTINATIONS.includes(destination) || !Array.isArray(entries) || entries.length > IMPORT_PREVIEW_LIMIT) throw Error('Invalid import preview.');
  return entries.map(entry => {
    try {
      if (destination === 'events') {
        if (!exact(entry, ['title', 'date', 'sourceDate', 'allDay', 'startTime', 'endTime', 'location', 'notes'])
          || typeof entry.allDay !== 'boolean') throw Error();
        return { title: text(entry.title, 200), date: rawDate(entry.date), sourceDate: dateText(entry.sourceDate),
          allDay: entry.allDay, startTime: text(entry.startTime, 30), endTime: text(entry.endTime, 30),
          location: text(entry.location, 200), notes: text(entry.notes, 2000, true) };
      }
      if (!exact(entry, ['label', 'startDate', 'endDate', 'sourceDate']) || typeof entry.label !== 'string') throw Error();
      const label = entry.label.trim() ? normalizeHolidayLabel(entry.label) : '';
      if (label === null) throw Error();
      return { label, startDate: rawDate(entry.startDate), endDate: rawDate(entry.endDate), sourceDate: dateText(entry.sourceDate) };
    } catch { throw Error('Invalid import preview.'); }
  });
}

// An explicit slash/dot numeric date that can be read in two day/month orders
// requires confirmation even though UK order is the default interpretation.
export function ambiguousNumericDate(sourceDate) {
  const match = /(?:^|\D)(0?[1-9]|1[0-2])[/.-](0?[1-9]|1[0-2])[/.-](?:\d{2}|\d{4})(?:\D|$)/.exec(sourceDate);
  return Boolean(match && Number(match[1]) !== Number(match[2]));
}
export function previewIssues(destination, entry, year) {
  const issues = [];
  if (!year?.startDate || !year?.endDate) return ['Select an academic year with saved dates.'];
  if (destination === 'events') {
    if (!entry.title) issues.push('Enter a title.');
    if (!entry.sourceDate) issues.push('Source date is missing. Confirm the event date.');
    if (!realEventDate(entry.date)) issues.push('Enter a real event date.');
    else if (entry.date < year.startDate || entry.date > year.endDate) issues.push('Date is outside the academic year.');
    if (ambiguousNumericDate(entry.sourceDate)) issues.push('Confirm the ambiguous source date.');
    if (entry.allDay && (entry.startTime || entry.endTime)) issues.push('All-day entry cannot also have times.');
    if (!entry.allDay && (!/^\d{2}:\d{2}$/.test(entry.startTime) || !/^\d{2}:\d{2}$/.test(entry.endTime)
      || entry.endTime <= entry.startTime)) issues.push('Choose All day or enter valid paired times.');
    if (!issues.length) {
      try { normalizeEventFields({ date: entry.date, title: entry.title,
        startTime: entry.allDay ? null : entry.startTime, endTime: entry.allDay ? null : entry.endTime,
        location: entry.location, notes: entry.notes }); } catch { issues.push('Check event fields.'); }
    }
  } else {
    if (!entry.label) issues.push('Enter a label.');
    else if (normalizeHolidayLabel(entry.label) === null) issues.push('Check the label for unsupported characters or length.');
    if (!entry.sourceDate) issues.push('Source date is missing. Confirm the holiday dates.');
    if (!realEventDate(entry.startDate) || !realEventDate(entry.endDate) || entry.startDate > entry.endDate) issues.push('Enter real first and last dates.');
    else if (entry.startDate < year.startDate || entry.endDate > year.endDate) issues.push('Dates are outside the academic year.');
    if (ambiguousNumericDate(entry.sourceDate)) issues.push('Confirm the ambiguous source date.');
  }
  return issues;
}
export function previewDuplicate(destination, entry, existing) {
  try {
    if (destination === 'events') {
      const value = normalizeEventFields({ date: entry.date, title: entry.title,
        startTime: entry.allDay ? null : entry.startTime, endTime: entry.allDay ? null : entry.endTime,
        location: entry.location, notes: entry.notes });
      return existing.some(item => eventIdentityKey(item) === eventIdentityKey(value));
    }
    return existing.some(item => holidayDuplicateKey(item) === holidayDuplicateKey(entry));
  } catch { return false; }
}
