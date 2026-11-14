import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import { useAcademicYear } from '../context/AcademicYearContext.jsx';
import { aiConnectionApi } from '../utils/aiConnectionApi.js';
import { extractImportPreview, importSourceError } from '../utils/importPreviewApi.js';
import { safeRequestReference } from '../utils/requestReference.js';
import { defaultEventPreviewAllDay, previewDuplicate, previewIssues } from '../../shared/importPreview.js';
import { boundaryError } from '../utils/holidayReview.js';
import './ImportPreviewPanel.css';

const sourceFields = {
  events: [['title', 'Title', 'text'], ['date', 'Date (YYYY-MM-DD)', 'text'],
    ['startTime', 'Start time (HH:MM)', 'text'], ['endTime', 'End time (HH:MM)', 'text'],
    ['location', 'Location', 'text'], ['notes', 'Notes', 'textarea']],
  holidays: [['label', 'Label', 'text'], ['startDate', 'First day (YYYY-MM-DD)', 'text'],
    ['endDate', 'Last day (YYYY-MM-DD)', 'text']],
};
function PreviewRouteGuard({ dirtyRef, approveLeave }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search || currentLocation.hash !== nextLocation.hash));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (approveLeave()) blocker.proceed(); else blocker.reset();
  }, [blocker.state, approveLeave]);
  return null;
}
function rowIssues(destination, row, year) {
  const dateConfirmed = destination === 'events' ? row.editedDates.includes('date')
    : row.editedDates.includes('startDate') && row.editedDates.includes('endDate');
  const original = previewIssues(destination, row.value, year);
  const issues = original.filter(issue => !issue.startsWith('Confirm the ambiguous')
    && !(dateConfirmed && issue.startsWith('Source date is missing')));
  if (!dateConfirmed && original.some(issue => issue.startsWith('Confirm the ambiguous')))
    issues.push('Confirm the ambiguous source date by editing the date field.');
  return issues;
}
export default function ImportPreviewPanel({ userId, destination, existing = [], recordsReady = true,
  onDirtyChange, onReviewEvent, onAddAllEvents, canReviewEvent = true, canAddAllEvents = true,
  manageNavigation = false, manageYearGuard = false, disabled = false }) {
  const { selectedAcademicYearId, academicYear, isLoading: yearLoading, registerAcademicYearChangeGuard } = useAcademicYear();
  const [mode, setMode] = useState('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [provider, setProvider] = useState(null);
  const [providerError, setProviderError] = useState(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerAttempt, setProviderAttempt] = useState(0);
  const currentProvider = provider?.userId === userId ? provider.value : null;
  const currentProviderError = providerError?.userId === userId ? providerError.failure : null;
  const providerRequired = !(destination === 'events' && mode === 'pdf');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const bulkRef = useRef(false);
  const [error, setError] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const fileInput = useRef(null);
  const operation = useRef(null);
  const sequence = useRef(0);
  const heading = useRef(null);
  const errorRef = useRef(null);
  const extractButton = useRef(null);
  const scope = `${userId || ''}:${selectedAcademicYearId || ''}:${academicYear?.startDate || ''}:${academicYear?.endDate || ''}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const activePreview = preview?.scope === scope ? preview : null;
  const validBulkRows = destination === 'events' && activePreview ? activePreview.rows.filter(row =>
    !row.uncertain && !rowIssues(destination,row,academicYear).length && !previewDuplicate(destination,row.value,existing)) : [];
  const previewVisible = Boolean(activePreview);
  const dirtyRef = useRef(Boolean(activePreview));
  dirtyRef.current = Boolean(activePreview);
  useEffect(() => { onDirtyChange?.(Boolean(activePreview)); }, [activePreview, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const ready = Boolean(userId && selectedAcademicYearId && academicYear?.id === selectedAcademicYearId
    && !yearLoading && !boundaryError(academicYear.startDate, academicYear.endDate));
  const approveLeave = useCallback(() => !bulkRef.current && (!dirtyRef.current || window.confirm('Discard this unsaved import preview?')), []);
  useEffect(() => manageYearGuard ? registerAcademicYearChangeGuard(approveLeave) : undefined,
    [registerAcademicYearChangeGuard, approveLeave, manageYearGuard]);
  useEffect(() => {
    if (!manageNavigation) return undefined;
    const unload = event => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    window.__plannixConfirmImportPreviewDiscard = approveLeave;
    return () => { window.removeEventListener('beforeunload', unload); delete window.__plannixConfirmImportPreviewDiscard; };
  }, [approveLeave, manageNavigation]);
  function clearFile() { setFile(null); if (fileInput.current) fileInput.current.value = ''; }
  function stop() { sequence.current += 1; operation.current?.abort(); operation.current = null; setBusy(false); clearFile(); }
  useEffect(() => {
    sequence.current += 1; operation.current?.abort(); operation.current = null;
    setPreview(null); setError(null); setBusy(false); setBulkMessage(''); setText(''); setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    return () => { sequence.current += 1; operation.current?.abort(); operation.current = null; };
  }, [scope]);
  useEffect(() => {
    let current = true;
    setProvider(null); setProviderError(null); setProviderLoading(true);
    aiConnectionApi.load().then(value => { if (current) setProvider(value?.active ? { userId, value } : null); })
      .catch(failure => { if (current) setProviderError({ userId, failure }); })
      .finally(() => { if (current) setProviderLoading(false); });
    return () => { current = false; };
  }, [userId, providerAttempt]);
  useEffect(() => { if (previewVisible) heading.current?.focus(); }, [previewVisible]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function changeMode(value) {
    if (bulkRef.current) return;
    if (value === mode || !approveLeave()) return;
    stop(); setPreview(null); setError(null); setMode(value); setAnnouncement('');
  }
  async function extract() {
    if (busy || bulkRef.current || disabled || !ready || (providerRequired && !currentProvider) || !recordsReady) return;
    const sourceError = importSourceError({ mode, text, file });
    if (sourceError) { setError({ message: sourceError }); return; }
    if (!approveLeave()) return;
    stop(); // invalidate every previous response before starting this one
    const controller = new AbortController(), token = ++sequence.current, currentScope = scope;
    operation.current = controller; setBusy(true); setError(null); setPreview(null); setAnnouncement('Extracting import preview…');
    try {
      const result = await extractImportPreview({ destination, mode, text, file,
        academicYearStartDate: academicYear.startDate, academicYearEndDate: academicYear.endDate }, { signal: controller.signal });
      if (sequence.current !== token || controller.signal.aborted || scopeRef.current !== currentScope) return;
      setPreview({ scope: currentScope, destination, rows: result.entries.map((value,id) => ({ id,
        value: destination === 'events' ? defaultEventPreviewAllDay(value) : value,
        editedDates: [], uncertain:false })) });
      setBulkMessage('');
      setAnnouncement(`${result.entries.length} preview entries extracted. None have been saved.`);
    } catch (failure) {
      if (sequence.current !== token || controller.signal.aborted || scopeRef.current !== currentScope) return;
      setError({ message: failure.message || 'Could not extract a preview.', reference: safeRequestReference(failure), retryAfter: failure.retryAfter });
    } finally {
      if (sequence.current === token) { operation.current = null; setBusy(false); clearFile(); }
    }
  }
  function patch(index, field, value) {
    if (bulkRef.current) return;
    setPreview(current => current?.scope === scope ? { ...current, rows: current.rows.map((row, i) => i === index
      ? { ...row, value: { ...row.value, [field]: value }, failed:false, editedDates: ['date', 'startDate', 'endDate'].includes(field)
        ? [...new Set([...row.editedDates, field])] : row.editedDates }
      : row) } : current);
  }
  function remove(index) {
    if (bulkRef.current) return;
    setPreview(current => current?.scope === scope ? { ...current, rows: current.rows.filter((_, i) => i !== index) } : current);
    requestAnimationFrame(() => {
      const entries = heading.current?.closest('.import-preview-results')?.querySelectorAll('.import-preview-entry');
      (entries?.[Math.min(index, entries.length - 1)]?.querySelector('input, button') || heading.current)?.focus();
    });
  }
  async function addAll() {
    if (!onAddAllEvents || !canAddAllEvents || !recordsReady || disabled || bulkRef.current || !validBulkRows.length
      || !window.confirm(`Add ${validBulkRows.length} valid reviewed events? Invalid and duplicate entries will stay unsaved.`)) return;
    const currentScope=scope, batch=validBulkRows.map(row=>({id:row.id,value:row.value}));
    bulkRef.current=true; setBulkBusy(true); setBulkMessage('Adding reviewed events…');
    try {
      const result=await onAddAllEvents(batch);
      if (scopeRef.current!==currentScope) return;
      if (!result) {
        const uncertain=new Set(batch.map(row=>row.id));
        setPreview(current=>current?.scope===currentScope ? { ...current, rows:current.rows.map(row=>
          uncertain.has(row.id) ? { ...row,uncertain:true } : row) } : current);
        setBulkMessage('The session changed before the batch outcome could be confirmed. Check the Events list before another import. No automatic retry will occur.');
        return;
      }
      const removed=new Set([...result.added,...result.skipped]);
      const uncertain=new Set(result.uncertain);
      const failed=new Set(result.failed);
      setPreview(current=>current?.scope===currentScope ? { ...current, rows:current.rows
        .filter(row=>!removed.has(row.id)).map(row=>uncertain.has(row.id) ? { ...row,uncertain:true }
          : failed.has(row.id) ? { ...row,failed:true } : row) } : current);
      setBulkMessage(`${result.added.length} added, ${result.skipped.length} skipped, ${result.failed.length} failed`+
        `${result.uncertain.length ? `, ${result.uncertain.length} unconfirmed` : ''}. ${result.message || ''}`);
    } catch {
      if (scopeRef.current!==currentScope) return;
      const uncertain=new Set(batch.map(row=>row.id));
      setPreview(current=>current?.scope===currentScope ? { ...current, rows:current.rows.map(row=>
        uncertain.has(row.id) ? { ...row,uncertain:true } : row) } : current);
      setBulkMessage('The batch outcome is unconfirmed. Check the Events list before starting another import. No automatic retry will occur.');
    } finally { bulkRef.current=false; setBulkBusy(false); }
  }
  return <section className="import-preview-panel" aria-label={destination === 'events' ? 'Event AI import' : 'School holiday AI import'}>
    {manageNavigation ? <PreviewRouteGuard dirtyRef={dirtyRef} approveLeave={approveLeave} /> : null}
    <h3>{destination === 'events' ? 'Import events with AI' : 'Preview calendar documents with AI'}</h3>
    <p>Paste calendar text or upload a document to review possible {destination === 'events' ? 'events' : 'school holidays and closures'}. <strong>Preview only — not saved.</strong></p>
    {!ready ? <p className="import-preview-warning">Select a saved academic year with start and end dates in <Link to="/settings/academic-year">Academic Year</Link> before extracting.</p>
      : <p className={`import-preview-year${destination === 'events' ? ' settings-hint' : ''}`}>Academic year: <strong>{academicYear.label}</strong></p>}
    {providerLoading ? <p className="visually-hidden" role="status">Loading AI connection…</p>
      : currentProviderError ? <div className={providerRequired ? 'import-preview-error' : 'import-preview-warning'} role="alert"><p>{providerRequired
        ? 'Could not load your AI connection.'
        : 'AI connection is unavailable. Readable date-column PDFs can still be previewed; other layouts need an AI connection.'}</p>
        {safeRequestReference(currentProviderError) ? <p>Support reference: <code>{safeRequestReference(currentProviderError)}</code></p> : null}
        <button type="button" className="settings-reset" onClick={() => setProviderAttempt(n => n + 1)}>Retry connection</button></div>
        : !currentProvider ? <p className="import-preview-warning">{providerRequired
          ? <>Connect an AI provider in <Link to="/profile">Profile</Link> before extracting.</>
          : <>Readable date-column PDFs can be previewed without an AI connection. Other layouts require a connection in <Link to="/profile">Profile</Link>.</>}</p>
          : <p className="settings-hint">Connected to {currentProvider.providerLabel}. {providerRequired
            ? 'Your source will be sent to this provider for extraction.'
            : 'Readable date-column PDFs are parsed on the server; other PDF layouts may be sent to this provider.'} Do not include pupil or staff personal information.</p>}
    <fieldset className="import-preview-controls" disabled={!ready || busy || bulkBusy || disabled}>
      <legend>Import source</legend>
      {destination === 'events' ? null : <p className="import-preview-method-label">Source</p>}
      <div className={`import-preview-choices${destination === 'events' ? ' import-preview-choices--buttons' : ''}`} role="group" aria-label="Import source">
        {[['text', 'Paste text'], ['pdf', 'Upload PDF'], ['image', 'Upload image'], ['xlsx', 'Upload Excel'], ['csv', 'Upload CSV']].map(([value, label]) =>
          destination === 'events'
            ? <button type="button" className="settings-reset" key={value} aria-pressed={mode === value} onClick={() => changeMode(value)}>{label}</button>
            : <label key={value}><input type="radio" name={`import-method-${destination}`} value={value} checked={mode === value} onChange={() => changeMode(value)} />{label}</label>)}
      </div>
      {mode === 'text' ? <div className="settings-field"><label htmlFor={`import-preview-text-${destination}`}>Calendar text</label><textarea id={`import-preview-text-${destination}`} rows={7} value={text} onChange={event => setText(event.target.value)} /></div>
        : <div className="settings-field"><span>{mode === 'pdf' ? 'School calendar PDF' : mode === 'image' ? 'Calendar image (PNG or JPEG)' : mode === 'xlsx' ? 'Calendar Excel (.xlsx)' : 'Calendar CSV'}</span>
          <div className="import-preview-picker"><input className="visually-hidden import-preview-file-input" ref={fileInput} id={`import-preview-file-${destination}`} type="file" accept={mode === 'pdf' ? 'application/pdf' : mode === 'image' ? 'image/png,image/jpeg' : mode === 'xlsx' ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : '.csv,text/csv'}
            onChange={event => { setFile(event.target.files?.length === 1 ? event.target.files[0] : null); setError(null); }} />
            <label className="settings-reset import-preview-file-label" htmlFor={`import-preview-file-${destination}`}>Choose {mode === 'pdf' ? 'PDF' : mode === 'image' ? 'image' : mode === 'xlsx' ? 'Excel file' : 'CSV file'}</label>
            <span className="settings-hint import-preview-filename">{file ? file.name : `No ${mode === 'pdf' ? 'PDF' : mode === 'image' ? 'image' : mode === 'xlsx' ? 'Excel file' : 'CSV file'} selected`}</span></div></div>}
      <p className="settings-hint">One PDF up to 10 MiB and 50 pages, one PNG/JPEG up to 4 MiB, or one CSV/Excel file up to 2 MiB. PDF scans without text are not supported. Pasted text is limited to 50,000 UTF-8 bytes.</p>
      <div className="import-preview-actions"><button ref={extractButton} type="button" className="settings-reset" disabled={(providerRequired && !currentProvider) || !recordsReady} onClick={extract}>Extract preview</button></div>
    </fieldset>
    {busy ? <div className="import-preview-actions"><p className="visually-hidden" role="status">Extracting preview…</p><button type="button" className="settings-reset" onClick={() => { stop(); setAnnouncement('Extraction cancelled.'); }}>Cancel extraction</button></div> : null}
    {error ? <div className="import-preview-error" role="alert" tabIndex={-1} ref={errorRef}><p>{error.message}</p>
      {error.retryAfter !== undefined ? <p>Try again in {error.retryAfter} seconds.</p> : null}
      {error.reference ? <p>Support reference: <code>{error.reference}</code></p> : null}
      <button type="button" className="settings-reset" onClick={extract} disabled={busy || (providerRequired && !currentProvider) || !ready}>Retry extraction</button></div> : null}
    {activePreview ? <section className="import-preview-results" aria-labelledby="import-preview-heading">
      <h4 id="import-preview-heading" ref={heading} tabIndex={-1}>Editable {destination === 'events' ? 'event' : 'holiday'} preview</h4>
      <p className="import-preview-warning"><strong>Preview only — these entries have not been saved.</strong> {destination === 'events'
        ? 'Entries without times are marked All day by default. Uncheck it to enter times. ' : null}
      {destination === 'events' && onReviewEvent
        ? 'Review one entry in the event editor, then select Save event to save it.'
        : 'Corrections here are temporary. A later import step will handle confirmed saving.'}</p>
      {!activePreview.rows.length ? <p>No entries remain in this preview.</p> : null}
      {activePreview.rows.map((row, index) => {
        const issues = rowIssues(destination,row,academicYear);
        const duplicate = previewDuplicate(destination, row.value, existing);
        return <article className="import-preview-entry" key={row.id}>
          <div className="import-preview-entry-head"><h5>Entry {index + 1}</h5><button type="button" className="settings-reset" disabled={bulkBusy} onClick={() => remove(index)}>Remove entry {index + 1}</button></div>
          {row.value.sourceDate ? <p className="settings-hint">Source date: {row.value.sourceDate}</p> : null}
          {row.uncertain ? <p className="import-preview-duplicate">This save outcome is unconfirmed. Check the Events list; this entry will not be retried automatically.</p> : null}
          {row.failed ? <p className="import-preview-error">This entry was not confirmed saved. Review it and try again.</p> : null}
          <div className="import-preview-fields">
            {sourceFields[destination].map(([field, label, type]) => <div className="settings-field" key={field}>
              <label htmlFor={`import-${index}-${field}`}>{label}</label>
              {type === 'textarea' ? <textarea id={`import-${index}-${field}`} value={row.value[field]} maxLength={2000} rows={3} disabled={bulkBusy} onChange={event => patch(index, field, event.target.value)} />
                : <input id={`import-${index}-${field}`} type={type} inputMode={['date', 'startDate', 'endDate', 'startTime', 'endTime'].includes(field) ? 'numeric' : undefined}
                  maxLength={['date', 'startDate', 'endDate', 'startTime', 'endTime'].includes(field) ? 40 : 200}
                  value={row.value[field]} disabled={bulkBusy} onChange={event => patch(index, field, event.target.value)} />}
            </div>)}
            {destination === 'events' ? <label className="import-preview-all-day"><input type="checkbox" checked={row.value.allDay} disabled={bulkBusy} onChange={event => patch(index, 'allDay', event.target.checked)} />All day</label> : null}
          </div>
          {issues.length ? <ul className="import-preview-issues">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
          {duplicate ? <p className="import-preview-duplicate">Possible duplicate of an existing {destination === 'events' ? 'event' : 'holiday'}.</p> : null}
          {destination === 'events' && onReviewEvent ? <button type="button" className="settings-reset"
            disabled={disabled || bulkBusy || !recordsReady || !canReviewEvent || issues.length > 0 || duplicate || row.uncertain}
            onClick={() => onReviewEvent(row.value)}>Review entry {index + 1} in event editor</button> : null}
        </article>;
      })}
      {destination === 'events' && onAddAllEvents ? <div className="import-preview-actions">
        <button type="button" className="settings-save" disabled={bulkBusy || disabled || !canAddAllEvents || !validBulkRows.length}
          onClick={addAll}>Add all valid events ({validBulkRows.length})</button>
        <p className="settings-hint">Check the All day choices before saving. Entries with missing dates or unresolved outcomes stay in the preview.</p>
      </div> : null}
      {bulkMessage ? <p className="import-preview-warning" role="status">{bulkMessage}</p> : null}
      <button type="button" className="settings-reset" disabled={bulkBusy} onClick={() => { if (!window.confirm('Discard this unsaved preview?')) return; setPreview(null); setBulkMessage(''); setAnnouncement('Preview discarded.'); requestAnimationFrame(() => extractButton.current?.focus()); }}>Discard preview</button>
    </section> : null}
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
  </section>;
}
