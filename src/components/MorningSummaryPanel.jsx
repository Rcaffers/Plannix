import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAcademicYear } from '../context/AcademicYearContext.jsx';
import { useClasses } from '../context/ClassContext.jsx';
import { useTimetableLayout } from '../context/TimetableLayoutContext.jsx';
import { fetchDatedTimetableSessions } from '../utils/timetableSessionApi.js';
import { eventApi } from '../utils/eventApi.js';
import { morningSummaryApi } from '../utils/morningSummaryApi.js';
import { buildMorningSummary, londonToday, summaryDateInfo } from '../utils/morningSummary.js';
import { safeRequestReference } from '../utils/requestReference.js';
import './MorningSummaryPanel.css';

const DEFAULT_PREFERENCES = { enabled: false, deliveryTime: '07:00', revision: 0 };

export default function MorningSummaryPanel({ userId, organisationId, preferenceApi = morningSummaryApi,
  loadDated = fetchDatedTimetableSessions, listEvents = eventApi.list }) {
  const year = useAcademicYear();
  const classes = useClasses();
  const layout = useTimetableLayout();
  const [date, setDate] = useState(() => londonToday());
  const [preferences, setPreferences] = useState({ userId: null, status: 'loading', value: DEFAULT_PREFERENCES, error: '', reference: '' });
  const [draft, setDraft] = useState(DEFAULT_PREFERENCES);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveReference, setSaveReference] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [preferenceRetry, setPreferenceRetry] = useState(0);
  const preferenceGeneration = useRef(0);
  const savingRef = useRef(false);
  const reloadingRef = useRef(false);
  const draftVersion = useRef(0);

  useEffect(() => {
    const ticket = ++preferenceGeneration.current;
    const controller = new AbortController();
    setPreferences({ userId, status: 'loading', value: DEFAULT_PREFERENCES, error: '', reference: '' });
    setDraft(DEFAULT_PREFERENCES); draftVersion.current++; setSaving(false); savingRef.current = false;
    reloadingRef.current = false; setReloading(false); setConflict(false); setReloadError('');
    setSaveError(''); setSaveReference(''); setSavedNotice('');
    if (userId) preferenceApi.load(userId, { signal: controller.signal }).then(result => {
      if (ticket !== preferenceGeneration.current || controller.signal.aborted) return;
      const value = { enabled: result.enabled, deliveryTime: result.deliveryTime, revision: result.revision };
      setPreferences({ userId, status: 'ready', value, error: '', reference: '' });
      setDraft(value);
    }).catch(error => {
      if (ticket !== preferenceGeneration.current || controller.signal.aborted) return;
      setPreferences({ userId, status: 'error', value: DEFAULT_PREFERENCES,
        error: 'Could not load morning summary preferences.', reference: safeRequestReference(error) });
    });
    return () => { controller.abort(); preferenceGeneration.current++; };
  }, [userId, preferenceRetry, preferenceApi]);

  const currentPreferences = preferences.userId === userId ? preferences : { status: 'loading' };
  async function savePreferences() {
    if (savingRef.current || reloadingRef.current || conflict || currentPreferences.status !== 'ready' || !userId) return;
    savingRef.current = true; setSaving(true); setSaveError(''); setSaveReference(''); setSavedNotice('');
    const ticket = preferenceGeneration.current;
    const value = { ...draft, revision: currentPreferences.value.revision };
    const version = draftVersion.current;
    try {
      const result = await preferenceApi.save(userId, value);
      if (ticket !== preferenceGeneration.current) return;
      const saved = { enabled: result.enabled, deliveryTime: result.deliveryTime, revision: result.revision };
      setPreferences({ userId, status: 'ready', value: saved, error: '', reference: '' });
      if (version === draftVersion.current) setDraft(saved);
      setSavedNotice('Morning summary preferences saved. Summaries are not active yet.');
    } catch (error) {
      if (ticket === preferenceGeneration.current) {
        if (error?.status === 409) {
          setConflict(true);
          setSaveError('Preferences changed elsewhere. Your choices are still here. Reload latest before saving.');
        } else setSaveError('Could not save morning summary preferences. Please retry.');
        setSaveReference(safeRequestReference(error));
      }
    } finally {
      if (ticket === preferenceGeneration.current) { savingRef.current = false; setSaving(false); }
    }
  }

  async function reloadPreferences() {
    if (!conflict || reloadingRef.current || savingRef.current || currentPreferences.status !== 'ready') return;
    const changed = draft.enabled !== currentPreferences.value.enabled
      || draft.deliveryTime !== currentPreferences.value.deliveryTime;
    if (changed && !window.confirm('Discard your unsaved morning summary preference changes and reload latest?')) return;
    reloadingRef.current = true; setReloading(true); setReloadError('');
    const ticket = preferenceGeneration.current;
    const version = draftVersion.current;
    const controller = new AbortController();
    try {
      const result = await preferenceApi.load(userId, { signal: controller.signal });
      if (ticket !== preferenceGeneration.current) return;
      if (version !== draftVersion.current) {
        setReloadError('Preferences changed while reloading. Your choices are retained; reload latest again.');
        return;
      }
      const value = { enabled: result.enabled, deliveryTime: result.deliveryTime, revision: result.revision };
      setPreferences({ userId, status: 'ready', value, error: '', reference: '' });
      setDraft(value); setConflict(false); setSaveError(''); setSaveReference('');
    } catch (error) {
      if (ticket === preferenceGeneration.current) {
        setReloadError('Could not reload preferences. Your choices are retained. Please retry.');
        setSaveReference(safeRequestReference(error));
      }
    } finally {
      controller.abort();
      if (ticket === preferenceGeneration.current) { reloadingRef.current = false; setReloading(false); }
    }
  }

  const editDraft = update => {
    if (savingRef.current || reloadingRef.current || currentPreferences.status !== 'ready') return;
    draftVersion.current++;
    setDraft(value => ({ ...value, ...update }));
    setSavedNotice('');
  };

  const selectedYear = year.selectedAcademicYearId && year.academicYear?.id === year.selectedAcademicYearId
    && !year.isLoading ? year.academicYear : null;
  const eligibility = selectedYear ? summaryDateInfo(date, selectedYear) : null;
  const ready = Boolean(userId && organisationId && selectedYear && eligibility?.eligible && layout.isPersisted && layout.timetableId
    && !layout.isLoading && classes.isLoaded && !classes.isLoading && !year.error && !layout.error && !classes.error);
  const scope = ready ? JSON.stringify([userId, organisationId, year.selectedAcademicYearId, date, layout.timetableId,
    layout.revision, classes.revision, selectedYear.holidays]) : '';
  const [preview, setPreview] = useState({ scope: '', status: 'idle', summary: null, reference: '' });
  const [previewRetry, setPreviewRetry] = useState(0);
  const previewGeneration = useRef(0);
  const active = preview.scope === scope ? preview : { scope, status: scope ? 'loading' : 'idle', summary: null, reference: '' };

  useEffect(() => {
    const ticket = ++previewGeneration.current;
    const controller = new AbortController();
    setPreview({ scope, status: scope ? 'loading' : 'idle', summary: null, reference: '' });
    if (scope) Promise.all([
      loadDated({ organisationId, academicYearId: year.selectedAcademicYearId,
        timetableId: layout.timetableId, weekStartDate: eligibility.monday }, { signal: controller.signal }),
      listEvents(year.selectedAcademicYearId, { from: date, to: date, signal: controller.signal }),
    ]).then(([dated, eventResult]) => {
      if (ticket !== previewGeneration.current || controller.signal.aborted) return;
      const summary = buildMorningSummary({ date, dated, periods: layout.periods,
        classes: classes.authoritativeEntries, events: eventResult.events, weeks: layout.weeks });
      setPreview({ scope, status: 'ready', summary, reference: '' });
    }).catch(error => {
      if (ticket !== previewGeneration.current || controller.signal.aborted) return;
      setPreview({ scope, status: 'error', summary: null, reference: safeRequestReference(error) });
    });
    return () => { controller.abort(); previewGeneration.current++; };
  }, [scope, previewRetry]);

  return <div className="morning-summary">
    <section aria-labelledby="morning-preferences-heading">
      <h2 id="morning-preferences-heading" className="settings-section-title">Morning summary preferences</h2>
      <p className="settings-hint"><strong>Morning summaries are not active yet.</strong> These preferences do not schedule or send notifications.</p>
      <p className="settings-hint">Delivery time uses Europe/London, including clock changes. It is separate from this device’s notification subscription.</p>
      {currentPreferences.status === 'error' ? <div className="settings-error" role="alert"><p>{currentPreferences.error}</p>
        {currentPreferences.reference ? <p>Support reference: <code>{currentPreferences.reference}</code></p> : null}
        <button type="button" className="settings-reset" onClick={() => setPreferenceRetry(value => value + 1)}>Retry preferences</button></div> : null}
      <div className="morning-preference-controls">
        <label className="morning-opt-in"><input type="checkbox" checked={draft.enabled}
          disabled={currentPreferences.status !== 'ready' || saving || reloading}
          onChange={event => editDraft({ enabled: event.target.checked })} />
          Opt in to morning summaries when this feature becomes active</label>
        <div className="settings-field"><label htmlFor="morning-delivery-time">Preferred delivery time (Europe/London)</label>
          <input id="morning-delivery-time" type="time" value={draft.deliveryTime}
            disabled={currentPreferences.status !== 'ready' || saving || reloading}
            onChange={event => editDraft({ deliveryTime: event.target.value })} /></div>
        <button type="button" className="settings-save" disabled={currentPreferences.status !== 'ready' || saving || reloading || conflict
          || (draft.enabled === currentPreferences.value.enabled && draft.deliveryTime === currentPreferences.value.deliveryTime)}
          onClick={savePreferences}>Save preferences</button>
      </div>
      {saveError ? <div className="settings-error" role="alert"><p>{saveError}</p>
        {reloadError ? <p>{reloadError}</p> : null}
        {saveReference ? <p>Support reference: <code>{saveReference}</code></p> : null}
        {conflict ? <button type="button" className="settings-reset" disabled={reloading || saving}
          onClick={reloadPreferences}>Reload latest</button> : null}</div> : null}
      <p className="visually-hidden" role="status" aria-live="polite">{currentPreferences.status === 'loading'
        ? 'Loading morning summary preferences.' : reloading ? 'Reloading morning summary preferences.'
          : saving ? 'Saving morning summary preferences.' : savedNotice}</p>
    </section>
    <section aria-labelledby="morning-preview-heading">
      <h2 id="morning-preview-heading" className="settings-section-title">Daily summary preview</h2>
      <p className="settings-hint">Read-only preview for the academic year selected in Settings. No summary is sent.</p>
      <div className="settings-field"><label htmlFor="morning-preview-date">Preview date (Europe/London)</label>
        <input id="morning-preview-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></div>
      {!selectedYear ? <p role="status">Select a saved academic year in <Link to="/settings/academic-year">Settings</Link> to preview a summary.</p> : null}
      {selectedYear ? <p className="settings-hint">Academic year: <strong>{selectedYear.label}</strong></p> : null}
      {selectedYear && !eligibility?.eligible ? <p role="status">No morning summary — {eligibility.reason}</p> : null}
      {selectedYear && eligibility?.eligible && !layout.isPersisted && !layout.isLoading ? <p role="status">Save a timetable layout before previewing a summary.</p> : null}
      {year.error || layout.error || classes.error ? <div className="settings-error" role="alert"><p>{year.error || layout.error || classes.error}</p>
        {year.requestReference || layout.requestReference || classes.requestReference ? <p>Support reference: <code>{year.requestReference || layout.requestReference || classes.requestReference}</code></p> : null}
        {layout.error ? <button type="button" className="settings-reset" onClick={layout.reload}>Retry timetable</button> : null}
        {classes.error ? <button type="button" className="settings-reset" onClick={classes.reload}>Retry classes</button> : null}</div> : null}
      {active.status === 'error' ? <div className="settings-error" role="alert"><p>Could not load the daily summary preview. No lesson information is shown.</p>
        {active.reference ? <p>Support reference: <code>{active.reference}</code></p> : null}
        <button type="button" className="settings-reset" onClick={() => setPreviewRetry(value => value + 1)}>Retry preview</button></div> : null}
      <p className="visually-hidden" role="status" aria-live="polite">{active.status === 'loading' ? 'Loading daily summary preview.'
        : active.status === 'ready' ? 'Daily summary preview loaded.' : ''}</p>
      {active.status === 'ready' ? <div className="morning-preview-content">
        <p><strong>{date}</strong> · Week {active.summary.week}</p>
        <h3>Teaching periods</h3>
        {active.summary.lessons.length ? <ol className="morning-lessons">{active.summary.lessons.map(lesson =>
          <li key={lesson.period}><strong>{lesson.period}</strong> — {lesson.isPpa ? 'PPA'
            : <>{lesson.className}{lesson.title ? ` — ${lesson.title}` : ' — Untitled lesson'}</>}</li>)}</ol>
          : <p>No teaching periods configured for this date.</p>}
        <h3>Events</h3>
        {active.summary.events.length ? <ul className="morning-events">{active.summary.events.map(event =>
          <li key={event.id}><strong>{event.title}</strong> — {event.startTime === null ? 'All day'
            : `${event.startTime}–${event.endTime}`}{event.location ? ` · ${event.location}` : ''}</li>)}</ul>
          : <p>No events for this date.</p>}
      </div> : null}
    </section>
  </div>;
}
