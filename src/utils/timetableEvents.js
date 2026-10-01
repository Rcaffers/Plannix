/** Compare local calendar dates without treating a 23- or 25-hour DST day as a partial day. */
export function localCalendarDayDifference(date, monday) {
  const ordinal = value => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000;
  return ordinal(date) - ordinal(monday);
}

export function weekEventDates(monday) {
  const start = new Date(`${monday}T12:00:00`);
  if (Number.isNaN(start.getTime())) return [];
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  });
}

export function eventsForDate(events, date) {
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  return events.filter(event => event.date === date).sort((a, b) =>
    (a.startTime === null ? -1 : b.startTime === null ? 1 : compare(a.startTime, b.startTime))
    || compare(a.title, b.title) || compare(a.id, b.id));
}
