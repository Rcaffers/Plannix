export const DEFAULT_ACADEMIC_YEAR = {
  id: null,
  label: '',
  startDate: '',
  endDate: '',
  holidays: [],
};

export function newHolidayId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Local calendar date as YYYY-MM-DD (no timezone shift). */
export function toLocalYmd(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isValidYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
}

export function normalizeHoliday(raw) {
  const id = String(raw?.id || '').trim() || newHolidayId();
  const label = String(raw?.label || '').trim();
  let startDate = String(raw?.startDate || '').trim();
  let endDate = String(raw?.endDate || '').trim();
  if (!isValidYmd(startDate)) startDate = '';
  if (!isValidYmd(endDate)) endDate = '';
  if (startDate && !endDate) endDate = startDate;
  if (startDate && endDate && endDate < startDate) {
    const t = startDate;
    startDate = endDate;
    endDate = t;
  }
  return { id, label, startDate, endDate };
}

export function normalizeAcademicYear(partial) {
  const base = { ...DEFAULT_ACADEMIC_YEAR, ...partial };
  const id = String(base.id || '').trim() || null;
  const label = String(base.label || '').trim();
  let startDate = String(base.startDate || '').trim();
  let endDate = String(base.endDate || '').trim();
  if (!isValidYmd(startDate)) startDate = '';
  if (!isValidYmd(endDate)) endDate = '';
  const holidays = Array.isArray(base.holidays)
    ? base.holidays.map((h) => normalizeHoliday(h))
    : [];
  return { id, label, startDate, endDate, holidays };
}

export function selectCurrentAcademicYear(academicYears, today = toLocalYmd(new Date())) {
  return [...(Array.isArray(academicYears) ? academicYears : [])]
    .filter((year) => isValidYmd(year?.startDate) && isValidYmd(year?.endDate)
      && year.startDate <= today && today <= year.endDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id))[0]?.id || null;
}

export function validateAcademicYearDraft(plan) {
  const normalized = normalizeAcademicYear(plan);
  if (!normalized.label || normalized.label.length > 200) return 'Enter an academic-year name of no more than 200 characters.';
  if (!isValidYmd(normalized.startDate) || !isValidYmd(normalized.endDate)
    || normalized.startDate > normalized.endDate) return 'Enter a valid start and end date.';
  if (normalized.holidays.length > 100) return 'An academic year can contain no more than 100 holidays.';
  for (const holiday of normalized.holidays) {
    if (!holiday.label || holiday.label.length > 200) return 'Each holiday needs a name of no more than 200 characters.';
    if (!isValidYmd(holiday.startDate) || !isValidYmd(holiday.endDate)
      || holiday.startDate > holiday.endDate
      || holiday.startDate < normalized.startDate || holiday.endDate > normalized.endDate) {
      return 'Holiday dates must fall within the academic year.';
    }
  }
  return '';
}

/**
 * @returns {string|null} Holiday label if `date` falls on an inclusive holiday range, else null.
 */
export function holidayLabelForLocalDate(academicYear, date) {
  const ymd = toLocalYmd(date);
  if (!ymd) return null;
  const holidays = Array.isArray(academicYear?.holidays) ? academicYear.holidays : [];
  for (const h of holidays) {
    const start = h.startDate;
    const end = h.endDate || h.startDate;
    if (!start || !isValidYmd(start)) continue;
    const endOk = isValidYmd(end) ? end : start;
    if (ymd >= start && ymd <= endOk) {
      return h.label?.trim() ? h.label.trim() : 'Holiday';
    }
  }
  return null;
}

/**
 * True when Monday–Friday of the week starting at `weekMonday` are all holiday days
 * (each day falls in at least one holiday range). Partial weeks do not count.
 */
export function isFullCalendarWeekHoliday(academicYear, weekMonday) {
  const m = weekMonday instanceof Date ? new Date(weekMonday) : new Date(weekMonday);
  if (Number.isNaN(m.getTime())) return false;
  m.setHours(12, 0, 0, 0);
  for (let i = 0; i < 5; i += 1) {
    const d = new Date(m);
    d.setDate(d.getDate() + i);
    if (!holidayLabelForLocalDate(academicYear, d)) return false;
  }
  return true;
}

const DEFAULT_LOOKBACK_WEEKS = 52 * 12;

/** Monday 00:00 local for the ISO week containing `date` (matches timetable week columns). */
function startOfWeekMondayLocal(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  return result;
}

/**
 * First/last Monday of the timetable window when an academic start date is set:
 * from the Monday of the week containing that date through the Monday of the week
 * containing the configured inclusive end date. Used to clamp calendar navigation on the main timetable.
 */
export function getAcademicTimetableMondayBounds(academicYear) {
  const ymd = String(academicYear?.startDate || '').trim();
  if (!isValidYmd(ymd)) {
    return { minMonday: null, maxMonday: null };
  }
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const start = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (Number.isNaN(start.getTime())) {
    return { minMonday: null, maxMonday: null };
  }
  const minMonday = startOfWeekMondayLocal(start);
  const endYmd = String(academicYear?.endDate || '').trim();
  let end = new Date(start);
  if (isValidYmd(endYmd)) {
    const [endYear, endMonth, endDay] = endYmd.split('-').map((x) => parseInt(x, 10));
    end = new Date(endYear, endMonth - 1, endDay, 12, 0, 0, 0);
  } else {
    end.setDate(end.getDate() + 365);
  }
  const maxMonday = startOfWeekMondayLocal(end);
  return { minMonday, maxMonday };
}

/**
 * Counts Mon-start school weeks strictly before `weekMonday` where every weekday is a holiday.
 * Used to shift two-week timetable (A/B) so a full holiday week does not break alternation.
 */
export function countFullHolidayWeeksBeforeMonday(
  academicYear,
  weekMonday,
  maxLookbackWeeks = DEFAULT_LOOKBACK_WEEKS,
) {
  if (!academicYear?.holidays?.length) return 0;
  const anchor = weekMonday instanceof Date ? new Date(weekMonday) : new Date(weekMonday);
  if (Number.isNaN(anchor.getTime())) return 0;
  anchor.setHours(12, 0, 0, 0);
  let count = 0;
  let m = new Date(anchor);
  m.setDate(m.getDate() - 7);
  for (let i = 0; i < maxLookbackWeeks; i += 1) {
    if (isFullCalendarWeekHoliday(academicYear, m)) count += 1;
    m.setDate(m.getDate() - 7);
  }
  return count;
}
