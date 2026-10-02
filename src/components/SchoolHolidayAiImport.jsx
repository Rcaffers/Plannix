import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiConnectionApi } from '../utils/aiConnectionApi.js';
import { extractSchoolHolidaysFromPdf, pdfFileError } from '../utils/holidayPdfExtractionApi.js';
import { extractSchoolHolidays } from '../utils/holidayExtractionApi.js';
import { extractImportPreview, importSourceError } from '../utils/importPreviewApi.js';
import { boundaryError, MAX_HOLIDAY_TEXT_BYTES, mergeReviewedHolidays, suggestionError, textBytes } from '../utils/holidayReview.js';
import { previewIssues } from '../../shared/importPreview.js';
import { safeRequestReference } from '../utils/requestReference.js';
import './SchoolHolidayAiImport.css';

const methods = [
  ['text', 'Paste text'], ['pdf', 'Upload PDF'], ['image', 'Upload image'],
  ['xlsx', 'Upload Excel'], ['csv', 'Upload CSV'],
];
const fileTypes = {
  pdf: { name: 'PDF', accept: 'application/pdf' },
  image: { name: 'image', accept: 'image/png,image/jpeg' },
  xlsx: { name: 'Excel file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv: { name: 'CSV file', accept: '.csv,text/csv' },
};

export default function SchoolHolidayAiImport({ draft, yearLabel, userId, onDraftChange, onReviewDirtyChange, disabled = false }) {
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(null);
  const [lookup, setLookup] = useState(0);
  const [mode, setMode] = useState('text');
  const [file, setFile] = useState(null);
  const fileInput = useRef(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [review, setReview] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const operation = useRef(null);
  const reviewHeading = useRef(null);
  const errorSummary = useRef(null);
  const extractButton = useRef(null);
  const currentConnection = connection?.userId === userId ? connection.value : null;
  const currentConnectionError = connectionError?.userId === userId ? connectionError.failure : null;
  useEffect(() => {
    let active = true;
    setLoading(true); setConnection(null); setConnectionError(null);
    aiConnectionApi.load().then(value => { if (active) setConnection(value?.active ? { userId, value } : null); })
      .catch(failure => { if (active) setConnectionError({ userId, failure }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [lookup, userId]);
  function focusSource() { (mode === 'text' ? extractButton.current : fileInput.current)?.focus(); }
  function clearFile() { setFile(null); if (fileInput.current) fileInput.current.value = ''; }
  function cancel() {
    clearFile();
    operation.current?.abort(); operation.current = null; setBusy(false);
  }
  useEffect(() => {
    // Date edits invalidate an in-flight request, but retain review edits for revalidation.
    cancel();
    return () => { operation.current?.abort(); operation.current = null; };
  }, [draft.id, draft.startDate, draft.endDate, userId]);
  const hasReview = review !== null;
  useEffect(() => { onReviewDirtyChange?.(hasReview); }, [hasReview, onReviewDirtyChange]);
  useEffect(() => () => onReviewDirtyChange?.(false), [onReviewDirtyChange]);
  useEffect(() => { if (review !== null) reviewHeading.current?.focus(); }, [review === null]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  const datesError = boundaryError(draft.startDate, draft.endDate);
  const bytes = textBytes(text);
  const sourceError = mode === 'text' ? (!text.trim() || bytes > MAX_HOLIDAY_TEXT_BYTES ? 'Paste up to 50,000 bytes of calendar text.' : '')
    : mode === 'pdf' ? pdfFileError(file) : importSourceError({ mode, text, file });
  function changeMode(nextMode) {
    if (nextMode === mode || (hasReview && !window.confirm('Discard these unsaved holiday suggestions?'))) return;
    cancel(); setMode(nextMode); setReview(null); setError(null); setAnnouncement('');
  }
  async function extract() {
    if (operation.current || disabled || !currentConnection || datesError || sourceError
      || (hasReview && !window.confirm('Discard these unsaved holiday suggestions?'))) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(null); setReview(null); setAnnouncement('');
    try {
      const boundaries = { academicYearStartDate: draft.startDate, academicYearEndDate: draft.endDate };
      const imported = ['image', 'xlsx', 'csv'].includes(mode);
      const holidays = imported
        ? (await extractImportPreview({ destination: 'holidays', mode, file, ...boundaries }, { signal: controller.signal })).entries
        : mode === 'pdf' ? (await extractSchoolHolidaysFromPdf({ file, ...boundaries }, { signal: controller.signal })).holidays
          : await extractSchoolHolidays({ text, ...boundaries }, { signal: controller.signal });
      if (operation.current !== controller || controller.signal.aborted) return;
      setReview(holidays.map(({ sourceDate, ...holiday }) => ({ holiday, included: true,
        ...(imported ? { sourceDate, editedDates: [] } : {}) })));
    } catch (failure) {
      if (operation.current !== controller || controller.signal.aborted) return;
      setError(failure);
      if (failure.reason === 'connection') { setConnection(null); setLookup(value => value + 1); }
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); clearFile(); }
    }
  }
  function edit(index, patch) {
    setReview(rows => rows.map((row, i) => i === index ? { ...row, holiday: { ...row.holiday, ...patch },
      editedDates: row.editedDates && ['startDate', 'endDate'].includes(Object.keys(patch)[0])
        ? [...new Set([...row.editedDates, Object.keys(patch)[0]])] : row.editedDates } : row));
    setError(null);
  }
  function reviewIssues(row) {
    const issues = [];
    const invalid = suggestionError(row.holiday, draft.startDate, draft.endDate);
    if (invalid) issues.push(invalid);
    if (row.sourceDate !== undefined) {
      const confirmedDates = row.editedDates?.includes('startDate') && row.editedDates?.includes('endDate');
      issues.push(...previewIssues('holidays', { ...row.holiday, sourceDate: row.sourceDate }, draft)
        .filter(issue => !(confirmedDates && (issue.startsWith('Source date is missing')
          || issue.startsWith('Confirm the ambiguous')))));
    }
    return [...new Set(issues)];
  }
  const selectedRows = review?.filter(row => row.included) || [];
  const selected = selectedRows.map(row => row.holiday);
  let addError = selectedRows.flatMap(reviewIssues)[0] || '';
  if (selected.length && !addError) {
    try { mergeReviewedHolidays(draft, selected, { createIds: false }); } catch (failure) { addError = failure.message; }
  }
  function add() {
    if (disabled || !selected.length || addError) return;
    try {
      const result = mergeReviewedHolidays(draft, selected);
      onDraftChange(result.draft);
      setReview(null); setText(''); setError(null);
      setAnnouncement(`${result.added} holidays added to the draft. ${result.skipped} exact duplicates skipped. Save the academic year to keep these changes.`);
      focusSource();
    } catch (failure) { setError(failure); }
  }
  const reference = safeRequestReference(error);
  return <section className="school-holiday-ai" aria-labelledby="school-holiday-ai-heading">
    <h3 id="school-holiday-ai-heading">Import school holidays and closures with AI</h3>
    {yearLabel ? <p className="settings-hint">Academic year: <strong>{yearLabel}</strong></p> : null}
    {loading ? <p role="status" className="visually-hidden">Loading AI connection…</p> : currentConnectionError ? <div role="alert">
      <p>Could not load your AI connection. Please try again.</p>
      {safeRequestReference(currentConnectionError) && <p>Support reference: <code>{safeRequestReference(currentConnectionError)}</code></p>}
      <button type="button" className="settings-reset" onClick={() => setLookup(value => value + 1)}>Retry connection</button>
    </div> : !currentConnection ? <p>Connect an AI provider in your Profile to import school holidays and closures automatically. <Link to="/profile">Go to Profile</Link></p> : <>
      <p>Connected to {currentConnection.providerLabel}. Calendar sources are sent to this provider. Do not include pupil or staff personal information.</p>
      <p className="settings-hint">Extract suggestions from pasted text or one document. Correct and select them below, then add them to the draft. Save the academic year to keep your changes.</p>
      <div className="settings-actions school-holiday-modes" role="group" aria-label="Holiday extraction method">
        {methods.map(([value, label]) => <button type="button" className="settings-reset" key={value} aria-pressed={mode === value} onClick={() => changeMode(value)}>{label}</button>)}
      </div>
      <fieldset disabled={busy || disabled} className="school-holiday-ai-fields" aria-labelledby="school-holiday-ai-heading">
        {mode !== 'text' ? <>
          <label htmlFor="school-holiday-file">{mode === 'pdf' ? 'School calendar PDF' : mode === 'image' ? 'School calendar image' : mode === 'xlsx' ? 'School calendar Excel (.xlsx)' : 'School calendar CSV'}</label>
          <div className="school-holiday-picker">
          <input className="school-holiday-file-input" ref={fileInput} id="school-holiday-file" type="file" accept={fileTypes[mode].accept} aria-describedby="school-holiday-privacy school-holiday-dates school-holiday-file-limit school-holiday-error" onChange={event => {
            const files = event.target.files;
            const chosen = files?.length === 1 ? files[0] : null;
            operation.current?.abort(); operation.current = null; setBusy(false); setError(null);
            const invalid = mode === 'pdf' ? pdfFileError(chosen) : importSourceError({ mode, text, file: chosen });
            if (invalid) { clearFile(); setError(new Error(invalid)); } else setFile(chosen);
          }} />
          <label className="settings-reset school-holiday-file-button" htmlFor="school-holiday-file">Choose {fileTypes[mode].name}</label>
          <span className="school-holiday-filename">{file ? file.name : `No ${fileTypes[mode].name} selected`}</span>
          </div>
          <p id="school-holiday-file-limit" className="settings-hint">{mode === 'pdf' ? 'One PDF, up to 10 MiB and 50 pages. Scanned PDFs without text are not supported.'
            : mode === 'image' ? 'One PNG or JPEG image, up to 4 MiB.' : `One ${fileTypes[mode].name}, up to 2 MiB.`}</p>
          <p id="school-holiday-privacy" className="settings-hint">Plannix does not save your document or extracted text. Review suggestions before adding them to the draft.</p>
        </> : <>
        <label htmlFor="school-holiday-text">Pasted school calendar text</label>
        <textarea id="school-holiday-text" value={text} rows={6} onChange={event => setText(event.target.value)} aria-describedby="school-holiday-privacy school-holiday-limit school-holiday-dates" />
        <p id="school-holiday-privacy" className="settings-hint">Review suggestions before adding them to the draft.</p>
        <p id="school-holiday-limit" className={`settings-hint${bytes > MAX_HOLIDAY_TEXT_BYTES ? ' settings-hint--error' : ''}`}>{text.length.toLocaleString()} characters · {bytes.toLocaleString()} / 50,000 UTF-8 bytes</p>
        </>}
        <p id="school-holiday-dates" className="settings-hint">{datesError || 'Only holidays within the academic-year dates will be suggested.'}</p>
        <button ref={extractButton} type="button" className="settings-reset" onClick={extract} disabled={!!datesError || !!sourceError}>{mode === 'text' ? 'Extract holidays' : `Extract holidays from ${fileTypes[mode].name}`}</button>
      </fieldset>
      {busy && <div className="settings-actions"><span className="visually-hidden" role="status">Extracting suggestions…</span><button type="button" className="settings-reset" onClick={() => { cancel(); setAnnouncement('Extraction cancelled.'); requestAnimationFrame(() => { if (!operation.current && !reviewHeading.current && !errorSummary.current) focusSource(); }); }}>Cancel extraction</button></div>}
    </>}
    {error && <div id="school-holiday-error" ref={errorSummary} tabIndex={-1} role="alert" className="settings-hint--error school-holiday-error">
      <p>{error.message}</p>
      {error.retryAfter !== undefined && <p>Try again in {error.retryAfter} seconds.</p>}
      {reference && <p>Support reference: <code>{reference}</code></p>}
      {[401, 403, 422].includes(error.status) && <Link to="/profile">Go to Profile</Link>}
    </div>}
    {review !== null && <section className="school-holiday-review" aria-labelledby="school-holiday-review-heading">
      <h4 ref={reviewHeading} tabIndex={-1} id="school-holiday-review-heading">Review holiday suggestions</h4>
      <p>Review these suggestions. They will not be saved until you save the academic year.</p>
      {!review.length && <p>No reliable holiday suggestions were found. Try another source or add holidays manually.</p>}
      {review.map((row, index) => {
        const { holiday, included } = row;
        const issues = reviewIssues(row);
        return <div className="settings-holiday-card" key={index}>
          <h5>Suggestion {index + 1}</h5>
          <label className="school-holiday-include"><input type="checkbox" checked={included} disabled={disabled} onChange={event => { const checked = event.target.checked; setReview(rows => rows.map((row, i) => i === index ? { ...row, included: checked } : row)); }} />Include suggestion {index + 1}</label>
          {row.sourceDate ? <p className="settings-hint">Source date: {row.sourceDate}</p> : null}
          <div className="settings-holiday-grid">
            {[['label', 'Label', 'text'], ['startDate', 'First day', 'date'], ['endDate', 'Last day', 'date']].map(([field, label, type]) => <div className="settings-field" key={field}>
              <label htmlFor={`suggestion-${index}-${field}`}>{label} for suggestion {index + 1}</label>
              <input id={`suggestion-${index}-${field}`} type={type} value={holiday[field]} disabled={disabled} aria-invalid={included && !!issues.length} aria-describedby={issues.length ? `suggestion-${index}-error` : undefined} onChange={event => edit(index, { [field]: event.target.value })} />
            </div>)}
          </div>
          {issues.length ? <p id={`suggestion-${index}-error`} className="settings-hint settings-hint--error">{issues.join(' ')}{!included && ' Excluded from addition.'}</p> : null}
        </div>;
      })}
      {addError && <p className="settings-hint settings-hint--error">{addError}</p>}
      <div className="settings-actions">
        <button type="button" className="settings-reset" disabled={disabled || !selected.length || !!addError} onClick={add}>Add selected holidays</button>
        <button type="button" className="settings-reset" onClick={() => { setReview(null); setError(null); focusSource(); }}>Discard suggestions</button>
      </div>
    </section>}
    <p role="status" className="settings-hint settings-hint--success visually-hidden">{announcement}</p>
  </section>;
}
