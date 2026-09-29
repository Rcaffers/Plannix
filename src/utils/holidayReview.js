import { normalizeHolidayLabel } from '../../shared/holidayLabel.js';
export { normalizeHolidayLabel };
import { holidayDuplicateKey } from './academicYear.js';
import { newHolidayId } from './academicYear.js';

export const MAX_HOLIDAY_TEXT_BYTES = 50_000;
export const textBytes = text => new TextEncoder().encode(text).length;
export const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function boundaryError(start, end) {
  return !realDate(start) || !realDate(end) || start > end || start < '1900-01-01' || end > '2200-12-31'
    || end > `${Number(start.slice(0, 4)) + 2}${start.slice(4)}`
    ? 'Set valid academic-year start and end dates (1900–2200, at most two years) before extracting holidays.' : '';
}
export function suggestionError(holiday, start, end) {
  if (!exactKeys(holiday, ['label', 'startDate', 'endDate'])) return 'A suggestion contains unexpected fields.';
  if (normalizeHolidayLabel(holiday.label) === null) return 'Each holiday needs a name of no more than 200 characters.';
  if (!realDate(holiday.startDate) || !realDate(holiday.endDate) || holiday.startDate > holiday.endDate) return 'Enter real dates, with the first day no later than the last day.';
  if (!realDate(start) || !realDate(end) || start > end || holiday.startDate < start || holiday.endDate > end) return 'Holiday dates must fall within the academic year.';
  return '';
}
const key = holidayDuplicateKey;
export function mergeReviewedHolidays(draft, selected, { createIds = true } = {}) {
  if (!Array.isArray(selected) || !selected.length) throw new Error('Select at least one suggestion.');
  const seen = new Set(draft.holidays.map(key));
  const additions = [];
  let skipped = 0;
  for (const holiday of selected) {
    const error = suggestionError(holiday, draft.startDate, draft.endDate);
    if (error) throw new Error(error);
    if (seen.has(key(holiday))) { skipped++; continue; }
    seen.add(key(holiday));
    additions.push({ ...holiday, holidayType: 'school', label: normalizeHolidayLabel(holiday.label) });
  }
  if (draft.holidays.length + additions.length > 100) throw new Error('An academic year can contain no more than 100 holidays.');
  // Generate IDs only after every selected entry has passed validation.
  return { draft: { ...draft, holidays: [...draft.holidays, ...additions.map(holiday => ({ ...holiday, id: createIds ? newHolidayId() : null }))] }, added: additions.length, skipped };
}
