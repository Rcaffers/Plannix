import { realEventDate } from '../../shared/personalEvent.js';
import { eventsForDate } from './timetableEvents.js';

export const londonToday = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export function summaryDateInfo(date, academicYear) {
  if (!realEventDate(date)) return { eligible: false, reason: 'Choose a valid date.' };
  if (!academicYear?.id || !realEventDate(academicYear.startDate)
    || !realEventDate(academicYear.endDate)) return { eligible: false, reason: 'Select a saved academic year.' };
  if (date < academicYear.startDate || date > academicYear.endDate) {
    return { eligible: false, reason: 'This date is outside the selected academic year.' };
  }
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return { eligible: false, reason: 'Weekends have no morning summary.' };
  const closure = (academicYear.holidays || []).find(item => item.startDate <= date
    && date <= (item.endDate || item.startDate));
  if (closure) return { eligible: false, reason: 'This date is a saved holiday or closure.' };
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return { eligible: true, monday: monday.toISOString().slice(0, 10), dayIndex: day - 1 };
}

export function buildMorningSummary({ date, dated, periods, classes, events, weeks }) {
  const info = summaryDateInfo(date, { id: 'selected', startDate: date, endDate: date, holidays: [] });
  if (!info.eligible || !dated || dated.weekStartDate !== info.monday
    || !Array.isArray(dated.sessions) || !Array.isArray(periods)
    || !Array.isArray(classes) || !Array.isArray(events) || !Array.isArray(weeks)) {
    throw new Error('Morning summary data is incomplete.');
  }
  const periodList = periods.filter(period => period.type === 'teaching' && period.enabled !== false)
    .sort((a, b) => a.order - b.order || (a.number ?? 0) - (b.number ?? 0)
      || String(a.id).localeCompare(String(b.id)));
  const classNames = new Map(classes.map(item => [item.id, item.name]));
  const daySessions = dated.sessions.filter(session => session.day === info.dayIndex);
  if (daySessions.some(session => !periodList.some(period => period.id === session.periodId)
    || !classNames.has(session.classId))) throw new Error('Morning summary data is incomplete.');
  const slotCounts = new Map();
  for (const session of daySessions) slotCounts.set(session.periodId, (slotCounts.get(session.periodId) || 0) + 1);
  if ([...slotCounts.values()].some(count => count > 1)) throw new Error('Morning summary data is incomplete.');
  const byPeriod = new Map(daySessions.map(session => [session.periodId, session]));
  const week = weeks.find(item => item.id === dated.repeatingWeekId);
  if (!week) throw new Error('Morning summary data is incomplete.');
  return {
    date, week: week.code,
    lessons: periodList.map((period, index) => {
      const session = byPeriod.get(period.id);
      return { period: `P${index + 1}`, startTime: period.startTime, endTime: period.endTime,
        className: session ? classNames.get(session.classId) : null,
        title: session?.title || '', isPpa: !session };
    }),
    events: eventsForDate(events, date).map(event => ({ id: event.id, title: event.title,
      startTime: event.startTime, endTime: event.endTime, location: event.location })),
  };
}
