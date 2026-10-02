import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAcademicYear } from '../context/AcademicYearContext.jsx';
import { useClasses } from '../context/ClassContext.jsx';
import { useTimetableLayout } from '../context/TimetableLayoutContext.jsx';
import { useTimetableSessions } from '../context/TimetableSessionContext.jsx';
import { fetchDatedTimetableSessions, fetchRecurringTimetableSessions } from '../utils/timetableSessionApi.js';
import { safeRequestReference } from '../utils/requestReference.js';
import { buildClassMonitor, reportDateError, reportMondays } from '../utils/classMonitor.js';
import '../components/ProjectCard.css';
import './Settings.css';
import './Reports.css';

const dateLabel = ymd => {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day, 12));
};

async function loadDatedWeeks(scope, mondays, signal) {
  const weeks = new Array(mondays.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, mondays.length) }, async () => {
    while (next < mondays.length) {
      signal.throwIfAborted();
      const index = next++;
      weeks[index] = await fetchDatedTimetableSessions({ ...scope, weekStartDate: mondays[index] }, { signal });
    }
  }));
  return weeks;
}

export default function Reports({ user }) {
  const { academicYear, selectedAcademicYearId, isLoading: yearLoading, error: yearError,
    requestReference: yearReference } = useAcademicYear();
  const classes = useClasses();
  const layout = useTimetableLayout();
  const sessions = useTimetableSessions();
  const [selection, setSelection] = useState({ yearId: null, classId: '' });
  const [dates, setDates] = useState({ yearId: null, from: '', to: '' });
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ scope: '', status: 'idle', rows: [], error: null });
  const generation = useRef(0);
  const yearId = selectedAcademicYearId;
  const yearReady = Boolean(yearId && academicYear?.id === yearId && !yearLoading);
  const savedClasses = classes.isLoaded ? (classes.authoritativeEntries || []).filter(entry => entry.id) : [];
  const classId = selection.yearId === yearId && savedClasses.some(entry => entry.id === selection.classId)
    ? selection.classId : '';
  const from = dates.yearId === yearId ? dates.from : academicYear?.startDate || '';
  const to = dates.yearId === yearId ? dates.to : academicYear?.endDate || '';
  const dateError = yearReady ? reportDateError(from, to, academicYear) : '';
  const scope = user?.id && user.organisationId && yearReady && classes.isLoaded && layout.isPersisted
    && layout.timetableId && classId && !dateError
    ? `${user.id}:${user.organisationId}:${yearId}:${layout.timetableId}:${layout.revision}:${sessions.revision}:${classes.revision}:${classId}:${from}:${to}:${JSON.stringify(academicYear.holidays)}` : '';
  const active = result.scope === scope ? result : { scope, status: scope ? 'loading' : 'idle', rows: [], error: null };
  const selectedClass = savedClasses.find(entry => entry.id === classId);
  const patternScope = useMemo(() => ({ organisationId: user?.organisationId, academicYearId: yearId,
    timetableId: layout.timetableId }), [user?.organisationId, yearId, layout.timetableId]);

  useEffect(() => {
    setSelection({ yearId, classId: '' });
    setDates({ yearId, from: academicYear?.id === yearId ? academicYear.startDate : '',
      to: academicYear?.id === yearId ? academicYear.endDate : '' });
    setResult({ scope: '', status: 'idle', rows: [], error: null });
  }, [yearId, academicYear?.startDate, academicYear?.endDate]);

  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    if (!scope) return () => { generation.current += 1; controller.abort(); };
    setResult({ scope, status: 'loading', rows: [], error: null });
    const mondays = reportMondays(from, to, academicYear);
    Promise.all([
      mondays.length ? fetchRecurringTimetableSessions(patternScope, { signal: controller.signal }) : Promise.resolve({ weeks: [] }),
      loadDatedWeeks(patternScope, mondays, controller.signal),
    ]).then(([recurring, datedWeeks]) => {
      if (generation.current !== current || controller.signal.aborted) return;
      if (datedWeeks.some(week => week.revision !== recurring.revision)) {
        setResult({ scope, status: 'error', rows: [], error: null });
        return;
      }
      setResult({ scope, status: 'ready', rows: buildClassMonitor({ year: academicYear, from, to,
        classId, datedWeeks, recurringWeeks: recurring.weeks, periods: layout.periods }), error: null });
    }).catch(error => {
      if (generation.current !== current || controller.signal.aborted) return;
      controller.abort();
      setResult({ scope, status: 'error', rows: [], error: safeRequestReference(error) });
    });
    return () => { generation.current += 1; controller.abort(); };
  }, [scope, retry]);

  return <main className="settings-page reports-page"><div className="container settings-inner settings-inner--wide">
    <p className="settings-breadcrumb"><Link to="/">Home</Link><span aria-hidden> / </span>Reports</p>
    <h1 className="settings-title">Reports</h1>
    <div className="reports-tabs" role="group" aria-label="Report selection">
      <button type="button" className="classes-subnav-link is-active" aria-pressed="true">Class Monitor</button>
    </div>
    <div className="settings-timetable-form reports-card">
      <h2 className="settings-section-title">Class Monitor</h2>
      <p className="settings-hint">Read-only lessons from the saved dated timetable. This report uses the current period times and repeating pattern; earlier versions of the layout and pattern are not archived. School records do not yet store whether they are holidays or closures, so unclassified ranges are not counted as missed lessons.</p>
      {!yearId ? <p role="status">Select an academic year in <Link to="/settings/academic-year">Settings</Link> to view a report.</p> : null}
      {yearError ? <div className="reports-error" role="alert"><p>{yearError}</p>{yearReference ? <p>Support reference: <code>{yearReference}</code></p> : null}</div> : null}
      {classes.error ? <div className="reports-error" role="alert"><p>{classes.error}</p>{classes.requestReference ? <p>Support reference: <code>{classes.requestReference}</code></p> : null}<button type="button" className="settings-reset" onClick={classes.reload}>Retry classes</button></div> : null}
      {layout.error ? <div className="reports-error" role="alert"><p>{layout.error}</p>{layout.requestReference ? <p>Support reference: <code>{layout.requestReference}</code></p> : null}<button type="button" className="settings-reset" onClick={layout.reload}>Retry timetable</button></div> : null}
      {yearReady && !layout.isLoading && !layout.isPersisted ? <p role="status">Save a timetable layout in Settings before viewing scheduled lessons.</p> : null}
      {yearReady ? <p className="reports-year">Academic year: <strong>{academicYear.label}</strong></p> : null}
      <div className="reports-filters">
        <div className="settings-field"><label htmlFor="report-class">Class</label><select id="report-class" value={classId}
          disabled={!yearReady || !classes.isLoaded || !layout.isPersisted}
          onChange={event => setSelection({ yearId, classId: event.target.value })}>
          <option value="">Choose a class</option>{savedClasses.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select></div>
        <div className="settings-field"><label htmlFor="report-from">From</label><input id="report-from" type="date" value={from}
          min={academicYear?.startDate || undefined} max={academicYear?.endDate || undefined} disabled={!yearReady}
          onChange={event => setDates({ yearId, from: event.target.value, to })} /></div>
        <div className="settings-field"><label htmlFor="report-to">To</label><input id="report-to" type="date" value={to}
          min={academicYear?.startDate || undefined} max={academicYear?.endDate || undefined} disabled={!yearReady}
          onChange={event => setDates({ yearId, from, to: event.target.value })} /></div>
      </div>
      {dateError ? <p className="reports-error" role="alert">{dateError}</p> : null}
      <p className="visually-hidden" role="status" aria-live="polite">{active.status === 'loading' ? 'Loading Class Monitor…' : active.status === 'ready' ? 'Class Monitor loaded.' : ''}</p>
      {active.status === 'error' ? <div className="reports-error" role="alert"><p>Could not load Class Monitor. The selected dates and class are unchanged.</p>
        {active.error ? <p>Support reference: <code>{active.error}</code></p> : null}
        <button type="button" className="settings-reset" onClick={() => setRetry(value => value + 1)}>Retry report</button></div> : null}
      {active.status === 'ready' ? <section className="reports-results" aria-label={`Class Monitor for ${selectedClass?.name || 'class'}`}>
        {!active.rows.length ? <p>No scheduled lessons or school closures for this class in the selected dates.</p> : null}
        {active.rows.map((row, index) => ['holiday', 'school-unknown'].includes(row.type)
          ? <article className="reports-holiday" key={`holiday-${index}`}><h3>{row.type === 'school-unknown' ? `School holiday or closure — ${row.label}` : row.label}</h3>
            <p>{dateLabel(row.visibleStart)} – {dateLabel(row.visibleEnd)}{row.visibleStart !== row.startDate || row.visibleEnd !== row.endDate ? ' (portion in selected dates)' : ''}</p></article>
          : <article className={`reports-entry ${row.type === 'closure' ? 'reports-entry--closure' : ''}`} key={`${row.date}-${row.periodId}-${row.sessionId || index}`}>
            <p className="reports-entry-date">{dateLabel(row.date)} · {row.startTime}–{row.endTime}</p>
            {row.type === 'closure' ? <strong>Lesson not held — {row.label}</strong>
              : <div className="lesson-card reports-lesson"><strong className="session-class">{selectedClass?.name}</strong>
                {row.title ? <span className="session-lesson-title">{row.title}</span> : null}
                {row.notes ? <span className="session-lesson-notes">{row.notes}</span> : null}</div>}
          </article>)}
      </section> : null}
    </div>
  </div></main>;
}
