import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import { useAcademicYear } from '../context/AcademicYearContext.jsx';
import { aiConnectionApi } from '../utils/aiConnectionApi.js';
import { extractImportPreview, importSourceError } from '../utils/importPreviewApi.js';
import { safeRequestReference } from '../utils/requestReference.js';
import { previewDuplicate, previewIssues } from '../../shared/importPreview.js';
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
export default function ImportPreviewPanel({ userId, destination, existing = [], recordsReady = true,
  onDirtyChange, manageNavigation = false, manageYearGuard = false, disabled = false }) {
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
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
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
  const previewVisible = Boolean(activePreview);
  const dirtyRef = useRef(Boolean(activePreview));
  dirtyRef.current = Boolean(activePreview);
  useEffect(() => { onDirtyChange?.(Boolean(activePreview)); }, [activePreview, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const ready = Boolean(userId && selectedAcademicYearId && academicYear?.id === selectedAcademicYearId
    && !yearLoading && !boundaryError(academicYear.startDate, academicYear.endDate));
  const approveLeave = useCallback(() => !dirtyRef.current || window.confirm('Discard this unsaved import preview?'), []);
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
    setPreview(null); setError(null); setBusy(false); setText(''); setFile(null);
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
    if (value === mode || !approveLeave()) return;
    stop(); setPreview(null); setError(null); setMode(value); setAnnouncement('');
  }
  async function extract() {
    if (busy || disabled || !ready || !currentProvider || !recordsReady) return;
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
      setPreview({ scope: currentScope, destination, rows: result.entries.map(value => ({ value, editedDates: [] })) });
      setAnnouncement(`${result.entries.length} preview entries extracted. None have been saved.`);
    } catch (failure) {
      if (sequence.current !== token || controller.signal.aborted || scopeRef.current !== currentScope) return;
      setError({ message: failure.message || 'Could not extract a preview.', reference: safeRequestReference(failure), retryAfter: failure.retryAfter });
    } finally {
      if (sequence.current === token) { operation.current = null; setBusy(false); clearFile(); }
    }
  }
  function patch(index, field, value) {
    setPreview(current => current?.scope === scope ? { ...current, rows: current.rows.map((row, i) => i === index
      ? { value: { ...row.value, [field]: value }, editedDates: ['date', 'startDate', 'endDate'].includes(field)
        ? [...new Set([...row.editedDates, field])] : row.editedDates }
      : row) } : current);
  }
  function remove(index) {
    setPreview(current => current?.scope === scope ? { ...current, rows: current.rows.filter((_, i) => i !== index) } : current);
    requestAnimationFrame(() => {
      const entries = heading.current?.closest('.import-preview-results')?.querySelectorAll('.import-preview-entry');
      (entries?.[Math.min(index, entries.length - 1)]?.querySelector('input, button') || heading.current)?.focus();
    });
  }
  return <section className="import-preview-panel" aria-label={destination === 'events' ? 'Event AI import' : 'School holiday AI import'}>
    {manageNavigation ? <PreviewRouteGuard dirtyRef={dirtyRef} approveLeave={approveLeave} /> : null}
    <h3>{destination === 'events' ? 'Import events with AI' : 'Preview calendar documents with AI'}</h3>
    <p>Paste calendar text or upload a document to review possible {destination === 'events' ? 'events' : 'school holidays and closures'}. <strong>Preview only — not saved.</strong></p>
    {!ready ? <p className="import-preview-warning">Select a saved academic year with start and end dates in <Link to="/settings/academic-year">Academic Year</Link> before extracting.</p>
      : <p className={`import-preview-year${destination === 'events' ? ' settings-hint' : ''}`}>Academic year: <strong>{academicYear.label}</strong></p>}
    {providerLoading ? <p className="visually-hidden" role="status">Loading AI connection…</p>
      : currentProviderError ? <div className="import-preview-error" role="alert"><p>Could not load your AI connection.</p>
        {safeRequestReference(currentProviderError) ? <p>Support reference: <code>{safeRequestReference(currentProviderError)}</code></p> : null}
        <button type="button" className="settings-reset" onClick={() => setProviderAttempt(n => n + 1)}>Retry connection</button></div>
        : !currentProvider ? <p className="import-preview-warning">Connect an AI provider in <Link to="/profile">Profile</Link> before extracting.</p>
          : <p className="settings-hint">Connected to {currentProvider.providerLabel}. Your source will be sent to this provider for extraction. Do not include pupil or staff personal information.</p>}
    <fieldset className="import-preview-controls" disabled={!ready || busy || disabled}>
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
      <div className="import-preview-actions"><button ref={extractButton} type="button" className="settings-reset" disabled={!currentProvider || !recordsReady} onClick={extract}>Extract preview</button></div>
    </fieldset>
    {busy ? <div className="import-preview-actions"><p className="visually-hidden" role="status">Extracting preview…</p><button type="button" className="settings-reset" onClick={() => { stop(); setAnnouncement('Extraction cancelled.'); }}>Cancel extraction</button></div> : null}
    {error ? <div className="import-preview-error" role="alert" tabIndex={-1} ref={errorRef}><p>{error.message}</p>
      {error.retryAfter !== undefined ? <p>Try again in {error.retryAfter} seconds.</p> : null}
      {error.reference ? <p>Support reference: <code>{error.reference}</code></p> : null}
      <button type="button" className="settings-reset" onClick={extract} disabled={busy || !currentProvider || !ready}>Retry extraction</button></div> : null}
    {activePreview ? <section className="import-preview-results" aria-labelledby="import-preview-heading">
      <h4 id="import-preview-heading" ref={heading} tabIndex={-1}>Editable {destination === 'events' ? 'event' : 'holiday'} preview</h4>
      <p className="import-preview-warning"><strong>Preview only — these entries have not been saved.</strong> Corrections here are temporary. A later import step will handle confirmed saving.</p>
      {!activePreview.rows.length ? <p>No entries remain in this preview.</p> : null}
      {activePreview.rows.map((row, index) => {
        const dateConfirmed = destination === 'events' ? row.editedDates.includes('date')
          : row.editedDates.includes('startDate') && row.editedDates.includes('endDate');
        const issues = previewIssues(destination, row.value, academicYear).filter(issue =>
          !issue.startsWith('Confirm the ambiguous') && !(dateConfirmed && issue.startsWith('Source date is missing')));
        const ambiguous = !dateConfirmed && previewIssues(destination, row.value, academicYear).some(issue => issue.startsWith('Confirm the ambiguous'));
        if (ambiguous) issues.push('Confirm the ambiguous source date by editing the date field.');
        const duplicate = previewDuplicate(destination, row.value, existing);
        return <article className="import-preview-entry" key={index}>
          <div className="import-preview-entry-head"><h5>Entry {index + 1}</h5><button type="button" className="settings-reset" onClick={() => remove(index)}>Remove entry {index + 1}</button></div>
          {row.value.sourceDate ? <p className="settings-hint">Source date: {row.value.sourceDate}</p> : null}
          <div className="import-preview-fields">
            {sourceFields[destination].map(([field, label, type]) => <div className="settings-field" key={field}>
              <label htmlFor={`import-${index}-${field}`}>{label}</label>
              {type === 'textarea' ? <textarea id={`import-${index}-${field}`} value={row.value[field]} maxLength={2000} rows={3} onChange={event => patch(index, field, event.target.value)} />
                : <input id={`import-${index}-${field}`} type={type} inputMode={['date', 'startDate', 'endDate', 'startTime', 'endTime'].includes(field) ? 'numeric' : undefined}
                  maxLength={['date', 'startDate', 'endDate', 'startTime', 'endTime'].includes(field) ? 40 : 200}
                  value={row.value[field]} onChange={event => patch(index, field, event.target.value)} />}
            </div>)}
            {destination === 'events' ? <label className="import-preview-all-day"><input type="checkbox" checked={row.value.allDay} onChange={event => patch(index, 'allDay', event.target.checked)} />All day</label> : null}
          </div>
          {issues.length ? <ul className="import-preview-issues">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
          {duplicate ? <p className="import-preview-duplicate">Possible duplicate of an existing {destination === 'events' ? 'event' : 'holiday'}.</p> : null}
        </article>;
      })}
      <button type="button" className="settings-reset" onClick={() => { if (!window.confirm('Discard this unsaved preview?')) return; setPreview(null); setAnnouncement('Preview discarded.'); requestAnimationFrame(() => extractButton.current?.focus()); }}>Discard preview</button>
    </section> : null}
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
  </section>;
}
