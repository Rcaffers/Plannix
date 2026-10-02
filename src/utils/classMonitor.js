import { toLocalYmd } from './academicYear.js';

export const MAX_DATED_REPORT_WEEKS = 60;
export const REPORT_RANGE_LIMIT_MESSAGE = 'Choose a shorter From/To range to view Class Monitor (up to 60 weeks).';

export function londonCalendarToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isPastClassMonitorRow(row, today) {
  const finalDate = row.type === 'holiday' || row.type === 'school-unknown'
    ? row.visibleEnd : row.date;
  return finalDate < today;
}

export function localDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return toLocalYmd(date) === ymd ? date : null;
}

export function addCalendarDays(ymd, days) {
  const date = localDate(ymd);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return toLocalYmd(date);
}

export function mondayFor(ymd) {
  const date = localDate(ymd);
  if (!date) return null;
  date.setDate(date.getDate() - (date.getDay() || 7) + 1);
  return toLocalYmd(date);
}

export function reportDateError(from, to, year) {
  if (!localDate(year?.startDate) || !localDate(year?.endDate)) return 'Set valid academic-year dates before viewing a report.';
  if (!localDate(from) || !localDate(to) || from > to) return 'Enter a valid From and To date in order.';
  if (from < year.startDate || to > year.endDate) return 'Keep report dates within the selected academic year.';
  // Count calendar week starts before building a list or starting requests.
  // UTC here compares date-only values; it never converts a local lesson date.
  const firstMonday = mondayFor(from);
  const lastMonday = mondayFor(to);
  const weekCount = Math.round((Date.parse(`${lastMonday}T00:00:00Z`)
    - Date.parse(`${firstMonday}T00:00:00Z`)) / (7 * 86400000)) + 1;
  if (weekCount > MAX_DATED_REPORT_WEEKS) return REPORT_RANGE_LIMIT_MESSAGE;
  return '';
}

export function reportMondays(from, to, year) {
  if (reportDateError(from, to, year)) return [];
  const result = [];
  for (let monday = mondayFor(from); monday <= to; monday = addCalendarDays(monday, 7)) {
    const last = addCalendarDays(monday, 4);
    if (last < from || last < year.startDate || monday > year.endDate) continue;
    // Only a known public holiday can exclude a whole week. School records
    // have no persisted holiday/closure distinction, so they need dated reads.
    let teachingDay = false;
    for (let day = 0; day < 5; day += 1) {
      const date = addCalendarDays(monday, day);
      if (date < year.startDate || date > year.endDate) continue;
      if (!(year.holidays || []).some(h => h.holidayType === 'public'
        && h.startDate <= date && date <= (h.endDate || h.startDate))) teachingDay = true;
    }
    if (teachingDay) result.push(monday);
  }
  return result;
}

// The saved model only has school/public categories. A closureType is usable
// when explicitly supplied by a future source; labels and duration are not.
export function holidayReportKind(holiday) {
  if (holiday.holidayType === 'public' || holiday.closureType === 'holiday') return 'holiday';
  if (holiday.closureType === 'closure') return 'closure';
  return 'school-unknown';
}

/** Saved dated overrides are authoritative; closed days use their repeating pattern. */
export function buildClassMonitor({ year, from, to, classId, datedWeeks, recurringWeeks, periods }) {
  const orderedPeriods = [...periods].filter(p => p.type === 'teaching')
    .sort((a, b) => a.order - b.order || (a.number ?? 0) - (b.number ?? 0)
      || String(a.id).localeCompare(String(b.id)));
  const periodOrder = new Map(orderedPeriods.map((period, index) => [period.id, index]));
  const periodById = new Map(orderedPeriods.map(period => [period.id, period]));
  const repeatingById = new Map(recurringWeeks.map(week => [week.weekId, week.sessions]));
  const rows = [];
  for (const holiday of year.holidays || []) {
    const start = holiday.startDate, end = holiday.endDate || start;
    if (end < from || start > to) continue;
    const kind = holidayReportKind(holiday);
    if (kind === 'closure') continue;
    rows.push({ type: kind, date: start < from ? from : start, label: holiday.label,
      startDate: start, endDate: end, visibleStart: start < from ? from : start,
      visibleEnd: end > to ? to : end });
  }
  for (const week of datedWeeks) {
    const repeating = repeatingById.get(week.repeatingWeekId) || [];
    for (let day = 0; day < 5; day += 1) {
      const date = addCalendarDays(week.weekStartDate, day);
      if (date < from || date > to || date < year.startDate || date > year.endDate) continue;
      const closed = (year.holidays || []).filter(h => h.startDate <= date && date <= (h.endDate || h.startDate));
      if (closed.some(h => holidayReportKind(h) !== 'closure')) continue;
      const sessions = closed.length ? repeating : week.sessions;
      const reason = [...closed].sort((a, b) => a.startDate.localeCompare(b.startDate)
        || a.label.localeCompare(b.label) || String(a.id || '').localeCompare(String(b.id || '')))[0];
      for (const session of sessions) {
        if (session.classId !== classId || session.day !== day || !periodOrder.has(session.periodId)) continue;
        const period = periodById.get(session.periodId);
        rows.push({ type: closed.length ? 'closure' : 'lesson', date,
          periodOrder: periodOrder.get(session.periodId), periodId: session.periodId,
          startTime: period.startTime, endTime: period.endTime,
          label: reason?.label || '', title: session.title, notes: session.notes,
          sessionId: session.id || null });
      }
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date)
    || (['holiday', 'school-unknown'].includes(a.type) ? -1 : ['holiday', 'school-unknown'].includes(b.type) ? 1 : 0)
    || (a.periodOrder ?? -1) - (b.periodOrder ?? -1)
    || String(a.sessionId || '').localeCompare(String(b.sessionId || '')));
}
