import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiConnectionApi } from '../utils/aiConnectionApi.js';
import { extractSchoolHolidays } from '../utils/holidayExtractionApi.js';
import { boundaryError, MAX_HOLIDAY_TEXT_BYTES, mergeReviewedHolidays, suggestionError, textBytes } from '../utils/holidayReview.js';
import { safeRequestReference } from '../utils/requestReference.js';
import './SchoolHolidayAiImport.css';

export default function SchoolHolidayAiImport({ draft, onDraftChange, disabled = false }) {
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(null);
  const [lookup, setLookup] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [review, setReview] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const operation = useRef(null);
  const reviewHeading = useRef(null);
  const errorSummary = useRef(null);
  const extractButton = useRef(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setConnectionError(null);
    aiConnectionApi.load().then(value => { if (active) setConnection(value?.active ? value : null); })
      .catch(failure => { if (active) setConnectionError(failure); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [lookup]);
  function cancel() {
    operation.current?.abort(); operation.current = null; setBusy(false);
  }
  useEffect(() => {
    // Date edits invalidate an in-flight request, but retain review edits for revalidation.
    cancel();
    return () => { operation.current?.abort(); operation.current = null; };
  }, [draft.startDate, draft.endDate]);
  useEffect(() => { if (review !== null) reviewHeading.current?.focus(); }, [review === null]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  const datesError = boundaryError(draft.startDate, draft.endDate);
  const bytes = textBytes(text);
  async function extract() {
    if (operation.current || disabled || datesError || !text.trim() || bytes > MAX_HOLIDAY_TEXT_BYTES) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(null); setReview(null); setAnnouncement('');
    try {
      const holidays = await extractSchoolHolidays({ text, academicYearStartDate: draft.startDate, academicYearEndDate: draft.endDate }, { signal: controller.signal });
      if (operation.current !== controller || controller.signal.aborted) return;
      setReview(holidays.map(holiday => ({ holiday, included: true })));
    } catch (failure) {
      if (operation.current !== controller || controller.signal.aborted) return;
      setError(failure);
      if (failure.reason === 'connection') { setConnection(null); setLookup(value => value + 1); }
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); }
    }
  }
  function edit(index, patch) {
    setReview(rows => rows.map((row, i) => i === index ? { ...row, holiday: { ...row.holiday, ...patch } } : row));
    setError(null);
  }
  const selected = review?.filter(row => row.included).map(row => row.holiday) || [];
  let addError = '';
  if (selected.length) {
    try { mergeReviewedHolidays(draft, selected, { createIds: false }); } catch (failure) { addError = failure.message; }
  }
  function add() {
    if (disabled || !selected.length || addError) return;
    try {
      const result = mergeReviewedHolidays(draft, selected);
      onDraftChange(result.draft);
      setReview(null); setText(''); setError(null);
      setAnnouncement(`${result.added} holidays added to the draft. ${result.skipped} exact duplicates skipped. Save the academic year to keep these changes.`);
      extractButton.current?.focus();
    } catch (failure) { setError(failure); }
  }
  const reference = safeRequestReference(error);
  return <section className="school-holiday-ai" aria-labelledby="school-holiday-ai-heading">
    <h3 id="school-holiday-ai-heading">Import school holidays with AI</h3>
    {loading ? <p role="status">Loading AI connection…</p> : connectionError ? <div role="alert">
      <p>Could not load your AI connection. Please try again.</p>
      {safeRequestReference(connectionError) && <p>Support reference: <code>{safeRequestReference(connectionError)}</code></p>}
      <button type="button" className="settings-reset" onClick={() => setLookup(value => value + 1)}>Retry connection</button>
    </div> : !connection ? <p>Connect an AI provider in your Profile to import school holidays automatically. <Link to="/profile">Go to Profile</Link></p> : <>
      <p>Connected to {connection.providerLabel}. Paste school calendar text to find suggested holidays for review.</p>
      <fieldset disabled={busy || disabled} className="school-holiday-ai-fields" aria-labelledby="school-holiday-ai-heading">
        <label htmlFor="school-holiday-text">Pasted school calendar text</label>
        <textarea id="school-holiday-text" value={text} rows={6} onChange={event => setText(event.target.value)} aria-describedby="school-holiday-privacy school-holiday-limit school-holiday-dates" />
        <p id="school-holiday-privacy" className="settings-hint">This text will be sent to {connection.providerLabel}. Do not paste pupil, staff or other personal information.</p>
        <p id="school-holiday-limit" className={`settings-hint${bytes > MAX_HOLIDAY_TEXT_BYTES ? ' settings-hint--error' : ''}`}>{text.length.toLocaleString()} characters · {bytes.toLocaleString()} / 50,000 UTF-8 bytes</p>
        <p id="school-holiday-dates" className="settings-hint">{datesError || 'Only holidays within the academic-year dates will be suggested.'}</p>
        <button ref={extractButton} type="button" className="settings-reset" onClick={extract} disabled={!!datesError || !text.trim() || bytes > MAX_HOLIDAY_TEXT_BYTES}>{busy ? 'Extracting holidays…' : 'Extract holidays'}</button>
      </fieldset>
      {busy && <div className="settings-actions"><span role="status">Extracting suggestions…</span><button type="button" className="settings-reset" onClick={() => { cancel(); setAnnouncement('Extraction cancelled.'); requestAnimationFrame(() => { if (!operation.current && !reviewHeading.current && !errorSummary.current) extractButton.current?.focus(); }); }}>Cancel extraction</button></div>}
    </>}
    {error && <div ref={errorSummary} tabIndex={-1} role="alert" className="settings-hint--error school-holiday-error">
      <p>{error.message}</p>
      {error.retryAfter !== undefined && <p>Try again in {error.retryAfter} seconds.</p>}
      {reference && <p>Support reference: <code>{reference}</code></p>}
      {[401, 403, 422].includes(error.status) && <Link to="/profile">Go to Profile</Link>}
    </div>}
    {review !== null && <section className="school-holiday-review" aria-labelledby="school-holiday-review-heading">
      <h4 ref={reviewHeading} tabIndex={-1} id="school-holiday-review-heading">Review holiday suggestions</h4>
      <p>Review these suggestions. They will not be saved until you save the academic year.</p>
      {!review.length && <p>No reliable holiday suggestions were found. You can edit your text or add holidays manually.</p>}
      {review.map(({ holiday, included }, index) => {
        const invalid = suggestionError(holiday, draft.startDate, draft.endDate);
        return <div className="settings-holiday-card" key={index}>
          <h5>Suggestion {index + 1}</h5>
          <label className="school-holiday-include"><input type="checkbox" checked={included} disabled={disabled} onChange={event => { const checked = event.target.checked; setReview(rows => rows.map((row, i) => i === index ? { ...row, included: checked } : row)); }} />Include suggestion {index + 1}</label>
          <div className="settings-holiday-grid">
            {[['label', 'Label', 'text'], ['startDate', 'First day', 'date'], ['endDate', 'Last day', 'date']].map(([field, label, type]) => <div className="settings-field" key={field}>
              <label htmlFor={`suggestion-${index}-${field}`}>{label} for suggestion {index + 1}</label>
              <input id={`suggestion-${index}-${field}`} type={type} value={holiday[field]} disabled={disabled} aria-invalid={included && !!invalid} aria-describedby={invalid ? `suggestion-${index}-error` : undefined} onChange={event => edit(index, { [field]: event.target.value })} />
            </div>)}
          </div>
          {invalid && <p id={`suggestion-${index}-error`} className="settings-hint settings-hint--error">{invalid}{!included && ' Excluded from addition.'}</p>}
        </div>;
      })}
      {addError && <p className="settings-hint settings-hint--error">{addError}</p>}
      <div className="settings-actions">
        <button type="button" className="settings-reset" disabled={disabled || !selected.length || !!addError} onClick={add}>Add selected holidays</button>
        <button type="button" className="settings-reset" onClick={() => { setReview(null); setError(null); extractButton.current?.focus(); }}>Discard suggestions</button>
      </div>
    </section>}
    <p role="status" className="settings-hint settings-hint--success">{announcement}</p>
  </section>;
}
