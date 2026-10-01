import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import SettingsSubnav from '../components/SettingsSubnav';
import { useAcademicYear } from '../context/AcademicYearContext';
import { eventApi } from '../utils/eventApi.js';
import { safeRequestReference } from '../utils/requestReference.js';
import { MAX_PERSONAL_EVENTS } from '../../shared/personalEvent.js';
import { blankEventDraft, canAddEvent, confirmedDraftUnchanged, draftFromEvent, matchingCreatedEvents, sortPersonalEvents, validateEventDraft } from '../utils/eventPage.js';
import './Settings.css';
import './Events.css';

const scopeOf = (id, year) => `${id || ''}:${year?.startDate || ''}:${year?.endDate || ''}`;
const errorDetails = (error, fallback) => ({ message: error?.message || fallback, reference: safeRequestReference(error) });
const uncertainResult = error => ![400, 401, 403, 404, 409, 413, 422, 429].includes(error?.status);

export default function Events() {
  const { selectedAcademicYearId, academicYear, isLoading: yearLoading,
    error: yearError, requestReference: yearReference, registerAcademicYearChangeGuard } = useAcademicYear();
  const [events, setEvents] = useState([]);
  const [listStatus, setListStatus] = useState('idle');
  const [pending, setPending] = useState(false);
  const [destructiveReloading, setDestructiveReloading] = useState(false);
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const scopeKey = scopeOf(selectedAcademicYearId, academicYear);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const listGeneration = useRef(0);
  const listController = useRef(null);
  const mutationController = useRef(null);
  const pendingRef = useRef(false);
  const destructiveReloadRef = useRef(false);
  const destructiveReloadGeneration = useRef(0);
  const draftVersion = useRef(0);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const titleRef = useRef(null);
  const errorRef = useRef(null);
  const addRef = useRef(null);
  const headingRef = useRef(null);
  const noticeRef = useRef(null);
  const dirty = Boolean(editor && JSON.stringify(editor.draft) !== JSON.stringify(editor.baseline));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const ready = Boolean(selectedAcademicYearId && academicYear?.id === selectedAcademicYearId
    && academicYear.startDate && academicYear.endDate && !yearLoading);
  const loading = listStatus === 'loading';
  const listReady = listStatus === 'ready';
  const focusList = () => requestAnimationFrame(() => {
    if (addRef.current && !addRef.current.disabled) addRef.current.focus();
    else headingRef.current?.focus();
  });

  const approveLeave = useCallback(() => !pendingRef.current && !destructiveReloadRef.current && (!dirtyRef.current
    || window.confirm('Discard unsaved event changes?')), []);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (pendingRef.current || destructiveReloadRef.current || dirtyRef.current)
    && (currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search || currentLocation.hash !== nextLocation.hash));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (approveLeave()) blocker.proceed();
    else blocker.reset();
  }, [blocker.state, approveLeave]);
  useEffect(() => registerAcademicYearChangeGuard(approveLeave), [approveLeave, registerAcademicYearChangeGuard]);
  useEffect(() => {
    const warn = event => { if (dirtyRef.current || pendingRef.current || destructiveReloadRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    window.__plannixConfirmEventDiscard = approveLeave;
    return () => {
      window.removeEventListener('beforeunload', warn);
      delete window.__plannixConfirmEventDiscard;
    };
  }, [approveLeave]);

  const load = useCallback(async ({ confirmedDraft } = {}) => {
    if (!ready) return false;
    const key = scopeKey;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const generation = ++listGeneration.current;
    setListStatus('loading'); setAnnouncement('Loading events…');
    try {
      const result = await eventApi.list(selectedAcademicYearId, { signal: controller.signal });
      if (scopeRef.current !== key || listGeneration.current !== generation || controller.signal.aborted) return false;
      setEvents(sortPersonalEvents(result.events));
      setListStatus('ready');
      const mayDiscard = confirmedDraft && confirmedDraftUnchanged(confirmedDraft, draftVersion.current, editorRef.current);
      if (mayDiscard) {
        const oldId = editorRef.current?.id;
        setEditor(null); setConflict(false);
        setNotice(oldId && !result.events.some(item => item.id === oldId)
          ? 'This event no longer exists. The latest events are shown.' : '');
        if (oldId && !result.events.some(item => item.id === oldId)) requestAnimationFrame(() => noticeRef.current?.focus());
        else focusList();
      }
      if (confirmedDraft && !mayDiscard) {
        setError({ message: 'Your draft changed during reload. Review it before discarding or saving.', reference: '' });
        setConflict(true);
      } else setError(null);
      setAnnouncement('Events loaded.');
      return result.events;
    } catch (cause) {
      if (scopeRef.current === key && listGeneration.current === generation && !controller.signal.aborted) {
        setError(errorDetails(cause, 'Could not load events.'));
        setListStatus('error');
        setAnnouncement('');
        requestAnimationFrame(() => errorRef.current?.focus());
      }
      return null;
    }
  }, [ready, scopeKey, selectedAcademicYearId]);

  useEffect(() => {
    scopeRef.current = scopeKey;
    listGeneration.current += 1;
    listController.current?.abort();
    mutationController.current?.abort(); mutationController.current = null;
    pendingRef.current = false; setPending(false);
    destructiveReloadGeneration.current += 1;
    destructiveReloadRef.current = false; setDestructiveReloading(false);
    draftVersion.current += 1;
    setEvents([]); setListStatus('idle'); setEditor(null); setConflict(false); setRecovery(null); setError(null); setNotice(''); setAnnouncement('');
    if (ready) void load();
    return () => {
      scopeRef.current = '';
      listGeneration.current += 1;
      listController.current?.abort();
      mutationController.current?.abort(); mutationController.current = null;
      destructiveReloadGeneration.current += 1;
      destructiveReloadRef.current = false;
    };
  }, [scopeKey, ready, load]);

  function openEditor(event = null) {
    if (pendingRef.current || destructiveReloadRef.current || !listReady || conflict || recovery || (editor && !approveLeave())) return;
    setError(null); setNotice(''); setConflict(false);
    const draft = event ? draftFromEvent(event) : blankEventDraft();
    draftVersion.current += 1;
    setEditor({ id: event?.id || null, revision: event?.revision || null, baseline: draft, draft });
    requestAnimationFrame(() => titleRef.current?.focus());
  }
  function cancel() {
    if (pendingRef.current || destructiveReloadRef.current || (recovery && !recovery.resolution)) return;
    draftVersion.current += 1;
    setEditor(null); setRecovery(null); setNotice('');
    if (!conflict) setError(null);
    focusList();
  }
  function patch(field, value) {
    if (destructiveReloadRef.current) return;
    draftVersion.current += 1;
    setEditor(current => ({ ...current, draft: { ...current.draft, [field]: value } }));
    if (!conflict) setError(null);
  }
  async function save(event, { retry = false } = {}) {
    event?.preventDefault?.();
    if (!editor || pendingRef.current || destructiveReloadRef.current || conflict || !ready || !listReady
      || (recovery && !(retry && recovery.resolution === 'retry' && recovery.action !== 'delete'))) return;
    if (!editor.id && !canAddEvent(events)) {
      setError({ message: 'This academic year already has 500 events.', reference: '' }); return;
    }
    const result = validateEventDraft(editor.draft, academicYear);
    if (!result.event) {
      setError({ message: result.message, reference: '' });
      document.getElementById(`event-${result.field}`)?.focus();
      return;
    }
    const key = scopeKey;
    pendingRef.current = true; setPending(true); setError(null); setRecovery(null); setAnnouncement('Saving event…');
    const controller = new AbortController(); mutationController.current = controller;
    try {
      const response = editor.id
        ? await eventApi.update(editor.id, editor.revision, result.event, { signal: controller.signal })
        : await eventApi.create(selectedAcademicYearId, result.event, { signal: controller.signal });
      if (scopeRef.current !== key || controller.signal.aborted) return;
      setEvents(current => sortPersonalEvents([...current.filter(item => item.id !== response.event.id), response.event]));
      setEditor(null); setConflict(false); setAnnouncement('Event saved.');
      requestAnimationFrame(() => document.getElementById(`event-edit-${response.event.id}`)?.focus());
    } catch (cause) {
      if (scopeRef.current !== key || controller.signal.aborted) return;
      if (uncertainResult(cause)) {
        setRecovery({ action: editor.id ? 'update' : 'create', id: editor.id, revision: editor.revision,
          attempted: result.event, resolution: null });
        setError({ message: 'The save outcome could not be confirmed. Reload events before trying again.', reference: safeRequestReference(cause) });
      } else setError(errorDetails(cause, 'Could not save event.'));
      if (!uncertainResult(cause) && editor.id && (cause?.status === 409 || cause?.status === 404)
        && !String(cause?.message).includes('same title') && !String(cause?.message).includes('500 events')) setConflict(true);
      setAnnouncement('');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      if (mutationController.current === controller) {
        pendingRef.current = false;
        mutationController.current = null;
        if (scopeRef.current === key) setPending(false);
      }
    }
  }
  async function remove(item, { retry = false } = {}) {
    if (!item || pendingRef.current || destructiveReloadRef.current || !listReady || conflict || (recovery && !(retry && recovery.resolution === 'retry' && recovery.action === 'delete'))
      || !window.confirm(`Delete “${item.title}”? This cannot be undone${editor?.id === item.id ? ' and will discard its unsaved draft' : ''}.`)) return;
    const key = scopeKey;
    pendingRef.current = true; setPending(true); setError(null); setRecovery(null); setAnnouncement('Deleting event…');
    const controller = new AbortController(); mutationController.current = controller;
    try {
      await eventApi.remove(item.id, item.revision, { signal: controller.signal });
      if (scopeRef.current !== key || controller.signal.aborted) return;
      setEvents(current => current.filter(record => record.id !== item.id));
      if (editor?.id === item.id) setEditor(null);
      setConflict(false); setAnnouncement('Event deleted.');
      focusList();
    } catch (cause) {
      if (scopeRef.current !== key || controller.signal.aborted) return;
      if (uncertainResult(cause)) {
        setRecovery({ action: 'delete', id: item.id, revision: item.revision, resolution: null });
        setError({ message: 'The delete outcome could not be confirmed. Reload events before trying again.', reference: safeRequestReference(cause) });
      } else {
        setError(errorDetails(cause, 'Could not delete event.'));
        if (cause?.status === 409 || cause?.status === 404) setConflict(true);
      }
      setAnnouncement('');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      if (mutationController.current === controller) {
        pendingRef.current = false;
        mutationController.current = null;
        if (scopeRef.current === key) setPending(false);
      }
    }
  }
  async function reloadLatest() {
    if (pendingRef.current || destructiveReloadRef.current || (dirty && !window.confirm('Discard unsaved event changes and reload the latest events?'))) return;
    const key = scopeKey;
    const generation = ++destructiveReloadGeneration.current;
    const confirmedDraft = { version: draftVersion.current, serializedEditor: JSON.stringify(editorRef.current) };
    destructiveReloadRef.current = true;
    setDestructiveReloading(true);
    try { await load({ confirmedDraft }); }
    finally {
      if (destructiveReloadGeneration.current === generation && scopeRef.current === key) {
        destructiveReloadRef.current = false;
        setDestructiveReloading(false);
      }
    }
  }
  async function recoverMutation() {
    if (!recovery || pendingRef.current || destructiveReloadRef.current || loading) return;
    const original = recovery;
    const key = scopeKey;
    const latest = await load();
    if (!latest || scopeRef.current !== key) return;
    if (original.action === 'create') {
      const matches = matchingCreatedEvents(latest, original.attempted);
      setRecovery({ ...original, resolution: matches.length === 1 ? 'match' : matches.length ? 'multiple' : 'retry',
        candidate: matches.length === 1 ? matches[0] : null });
      return;
    }
    const candidate = latest.find(item => item.id === original.id);
    setRecovery({ ...original,
      resolution: !candidate ? original.action === 'delete' ? 'removed' : 'deleted'
        : candidate.revision === original.revision ? 'retry'
          : candidate.revision > original.revision ? 'match' : 'multiple', candidate });
  }
  function openRecoveredEvent() {
    if (destructiveReloadRef.current || recovery?.resolution !== 'match' || !recovery.candidate || (dirty && !window.confirm('Discard this draft and open the saved event?'))) return;
    const candidate = recovery.candidate;
    const draft = draftFromEvent(candidate);
    setEditor({ id: candidate.id, revision: candidate.revision, baseline: draft, draft });
    setRecovery(null); setError(null);
    requestAnimationFrame(() => titleRef.current?.focus());
  }
  function finishRecovery() {
    if (destructiveReloadRef.current || !recovery?.resolution || (dirty && !window.confirm('Discard this draft and finish recovery?'))) return;
    setRecovery(null); setEditor(null); setError(null);
    focusList();
  }

  return <main className="settings-page events-page"><div className="container settings-inner--wide">
    <p className="settings-breadcrumb"><Link to="/settings">Settings</Link><span aria-hidden> / </span>Events</p>
    <h1 className="settings-title">Events</h1>
    <SettingsSubnav />
    <p className="settings-lead">Plan personal, single-day events for an academic year. Events do not close teaching slots.</p>
    {!selectedAcademicYearId ? <p className="events-notice">No academic year is selected. <Link to="/settings/academic-year">Choose or create an academic year</Link> first.</p> : null}
    {selectedAcademicYearId && !yearLoading ? <section aria-label="Selected academic year" className="events-year">
      <strong>{academicYear.label}</strong><span>{academicYear.startDate || 'Start date not set'} – {academicYear.endDate || 'End date not set'}</span>
    </section> : null}
    {yearError ? <div className="events-error" role="alert"><p>{yearError}</p>{yearReference ? <p>Support reference: <code>{yearReference}</code></p> : null}</div> : null}
    {selectedAcademicYearId && academicYear?.id === selectedAcademicYearId && !ready && !yearLoading ? <p className="events-notice">Set both academic-year boundaries in <Link to="/settings/academic-year">Academic Year</Link> before adding events.</p> : null}
    {yearLoading ? <p className="visually-hidden" role="status">Loading academic year…</p> : null}
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    {error ? <div className="events-error" role="alert" ref={errorRef} tabIndex={-1}>
      <p>{error.message}</p>{error.reference ? <p>Support reference: <code>{error.reference}</code></p> : null}
      {conflict ? <><p>The event may have changed or been deleted elsewhere. Reload the latest events before editing again.</p>
        <button type="button" className="settings-reset" onClick={reloadLatest} disabled={pending || loading || destructiveReloading}>Reload latest</button></> : null}
      {!conflict && !recovery && ready && !editor ? <button type="button" className="settings-reset" onClick={() => load()} disabled={pending || loading || destructiveReloading}>Retry</button> : null}
    </div> : null}
    {recovery ? <div className="events-notice" role="status">
      {recovery.resolution === null ? <><p>The server may have completed this change. Reload the full event list to check before another attempt.</p>
        <button type="button" className="settings-reset" onClick={recoverMutation} disabled={loading || pending || destructiveReloading}>Reload events</button></> : null}
      {recovery.resolution === 'match' ? <><p>{recovery.action === 'create' ? 'An event with the same date, normalized title and times is in the latest list.' : 'This event has a newer revision in the latest list.'} Review its details before using it.</p>
        <button type="button" className="settings-reset" onClick={openRecoveredEvent}>Open saved event</button>
        <button type="button" className="settings-reset" onClick={finishRecovery}>Keep latest list</button></> : null}
      {recovery.resolution === 'retry' ? <><p>{recovery.action === 'create' ? 'No event with the same date, normalized title and times was found.' : 'This event still has the same revision.'} You can explicitly retry the operation.</p>
        <button type="button" className="settings-reset" onClick={() => recovery.action === 'delete'
          ? remove(events.find(item => item.id === recovery.id), { retry: true }) : save(null, { retry: true })}>
          Retry {recovery.action === 'delete' ? 'delete' : recovery.action === 'create' ? 'create' : 'update'}
        </button><button type="button" className="settings-reset" onClick={finishRecovery}>Keep latest list</button></> : null}
      {['removed', 'deleted', 'multiple'].includes(recovery.resolution) ? <><p>{recovery.resolution === 'multiple'
        ? 'The latest list contains inconsistent matching results. Review the list before making another change.'
        : 'This event is absent from the latest list. The request outcome cannot be distinguished from another user’s change.'}</p>
        <button type="button" className="settings-reset" onClick={finishRecovery}>Finish recovery</button></> : null}
    </div> : null}
    {notice ? <p className="events-notice" ref={noticeRef} tabIndex={-1}>{notice}</p> : null}
    {ready ? <>
      <div className="events-list-heading"><h2 ref={headingRef} tabIndex={-1}>Events</h2><p>{listReady ? `${events.length} of ${MAX_PERSONAL_EVENTS} events` : 'Event count unavailable'}</p></div>
      <button ref={addRef} type="button" className="add-row-button" onClick={() => openEditor()} disabled={pending || destructiveReloading || !listReady || conflict || recovery || !canAddEvent(events)}>Add event</button>
      {listReady && !events.length && !error ? <p className="events-notice">No events yet. Add an event for this academic year.</p> : null}
      {events.length ? <ul className="events-list" aria-label="Events in selected academic year">{events.map(item =>
        <li className="events-item" key={item.id}>
          <div className="events-item-copy"><strong>{item.title}</strong><span>{item.date} · {item.startTime === null ? 'All day' : `${item.startTime}–${item.endTime}`}</span>
            {item.location ? <span>{item.location}</span> : null}</div>
          <div className="events-item-actions"><button id={`event-edit-${item.id}`} type="button" className="settings-reset" onClick={() => openEditor(item)} disabled={pending || destructiveReloading || !listReady || conflict || recovery}>Edit {item.title}</button>
            <button type="button" className="settings-reset events-delete" onClick={() => remove(item)} disabled={pending || destructiveReloading || !listReady || conflict || recovery}>Delete {item.title}</button></div>
        </li>)}
      </ul> : null}
      {editor ? <form className="settings-timetable-form events-form" onSubmit={save} noValidate aria-labelledby="events-form-heading">
        <h2 id="events-form-heading" className="settings-section-title">{editor.id ? 'Edit event' : 'Add event'}</h2>
        <div className="settings-field"><label htmlFor="event-title">Title</label><input id="event-title" ref={titleRef} type="text" value={editor.draft.title} maxLength={200} onChange={e => patch('title', e.target.value)} disabled={pending || destructiveReloading} required /></div>
        <div className="settings-field"><label htmlFor="event-date">Date</label><input id="event-date" type="date" min={academicYear.startDate} max={academicYear.endDate} value={editor.draft.date} onChange={e => patch('date', e.target.value)} disabled={pending || destructiveReloading} required /></div>
        <label className="events-check"><input type="checkbox" checked={editor.draft.allDay} onChange={e => patch('allDay', e.target.checked)} disabled={pending || destructiveReloading} />All day</label>
        {!editor.draft.allDay ? <div className="events-times"><div className="settings-field"><label htmlFor="event-startTime">Start time</label><input id="event-startTime" type="time" value={editor.draft.startTime} onChange={e => patch('startTime', e.target.value)} disabled={pending || destructiveReloading} required /></div>
          <div className="settings-field"><label htmlFor="event-endTime">End time</label><input id="event-endTime" type="time" value={editor.draft.endTime} onChange={e => patch('endTime', e.target.value)} disabled={pending || destructiveReloading} required /></div></div> : null}
        <div className="settings-field"><label htmlFor="event-location">Location (optional)</label><input id="event-location" type="text" value={editor.draft.location} maxLength={200} onChange={e => patch('location', e.target.value)} disabled={pending || destructiveReloading} /></div>
        <div className="settings-field"><label htmlFor="event-notes">Notes (optional)</label><textarea id="event-notes" value={editor.draft.notes} maxLength={2000} rows={4} onChange={e => patch('notes', e.target.value)} disabled={pending || destructiveReloading} /></div>
        <div className="settings-actions"><button type="button" className="settings-reset" onClick={cancel} disabled={pending || destructiveReloading || (recovery && !recovery.resolution)}>Cancel</button>
          <button type="submit" className="settings-save" disabled={pending || destructiveReloading || conflict || recovery || !listReady}>Save event</button></div>
      </form> : null}
    </> : null}
  </div></main>;
}
