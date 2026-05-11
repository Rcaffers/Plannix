export const DEFAULT_ACADEMIC_YEAR = {
  label: '',
  startDate: '',
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
  const label = String(base.label || '').trim();
  let startDate = String(base.startDate || '').trim();
  if (!isValidYmd(startDate)) startDate = '';
  const holidays = Array.isArray(base.holidays)
    ? base.holidays.map((h) => normalizeHoliday(h))
    : [];
  return { label, startDate, holidays };
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
 * containing (start + 365 days). Used to clamp calendar navigation on the main timetable.
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
  const end = new Date(start);
  end.setDate(end.getDate() + 365);
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
