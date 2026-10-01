import { useEffect, useRef, useState } from 'react';
import { eventApi } from '../utils/eventApi.js';
import { safeRequestReference } from '../utils/requestReference.js';
import { eventsForDate, weekEventDates } from '../utils/timetableEvents.js';

const CALENDAR_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function EventCard({ event }) {
  return <article className="schedule-event-card">
    <strong>{event.title}</strong>
    <span>{event.startTime === null ? 'All day' : `${event.startTime}–${event.endTime}`}</span>
    {event.location ? <span>{event.location}</span> : null}
    {event.notes ? <details><summary>Show notes for {event.title}</summary><p>{event.notes}</p></details> : null}
  </article>;
}

export default function TimetableEvents({ academicYearId, monday, dayIndices, dayLabels,
  gridStyle, singleDay, selectedDay, nonTeachingDayOnly }) {
  const dates = weekEventDates(monday);
  const scope = academicYearId && dates.length === 7 ? `${academicYearId}:${monday}` : '';
  const [result, setResult] = useState({ scope: '', status: 'idle', events: [], error: null });
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const active = result.scope === scope ? result : { scope, status: scope ? 'loading' : 'idle', events: [], error: null };

  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    if (!scope) {
      setResult({ scope: '', status: 'idle', events: [], error: null });
      return () => { generation.current += 1; controller.abort(); };
    }
    setResult({ scope, status: 'loading', events: [], error: null });
    eventApi.list(academicYearId, { from: dates[0], to: dates[6], signal: controller.signal }).then(
      response => {
        if (generation.current !== current || controller.signal.aborted) return;
        setResult({ scope, status: 'ready', events: response.events, error: null });
      },
      error => {
        if (generation.current !== current || controller.signal.aborted) return;
        setResult({ scope, status: 'error', events: [], error: safeRequestReference(error) });
      },
    );
    return () => { generation.current += 1; controller.abort(); };
  }, [scope, retry]);

  if (!scope) return null;

  const cards = date => eventsForDate(active.events, date).map(event => <EventCard key={event.id} event={event} />);
  const extraDayIndices = Array.from({ length: Math.max(0, 7 - dayLabels.length) }, (_, index) => dayLabels.length + index);
  return <section className="schedule-events" aria-label="Saved personal events">
    <p className="visually-hidden" role="status" aria-live="polite">{active.status === 'loading' ? 'Loading events…' : active.status === 'ready' ? 'Events loaded.' : ''}</p>
    {active.status === 'error' ? <div className="schedule-events-error" role="alert">
      <p>Could not load events for this week. The timetable is still available.</p>
      {active.error ? <p>Support reference: <code>{active.error}</code></p> : null}
      <button type="button" onClick={() => setRetry(value => value + 1)}>Retry events</button>
    </div> : null}
    {!nonTeachingDayOnly ? <div className={`schedule-events-row${singleDay ? ' schedule-events-row--single-day' : ''}`} style={gridStyle ?? undefined}>
      <div className="schedule-events-time">Events</div>
      {dayIndices.map(index => <div className="schedule-events-day" key={index} aria-label={`${dayLabels[index]} events`}>
        {cards(dates[index])}
      </div>)}
    </div> : <div className="schedule-events-weekend-only">
      <p>No school periods on {CALENDAR_DAYS[selectedDay]}.</p>
      {cards(dates[selectedDay])}
      {active.status === 'ready' && !eventsForDate(active.events, dates[selectedDay]).length ? <p>No saved events for this day.</p> : null}
    </div>}
    {!singleDay && extraDayIndices.length ? <div className="schedule-events-weekend">
      {extraDayIndices.map(index => <div key={index} className="schedule-events-weekend-day">
        <strong>{CALENDAR_DAYS[index]}</strong>
        {cards(dates[index])}
      </div>)}
    </div> : null}
    <a className="schedule-events-manage" href="/settings/events">Manage events in Settings</a>
  </section>;
}
