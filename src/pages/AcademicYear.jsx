import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SchoolHolidayAiImport from '../components/SchoolHolidayAiImport';
import { suggestionError } from '../utils/holidayReview.js';
import SettingsSubnav from '../components/SettingsSubnav';
import { useAcademicYear } from '../context/AcademicYearContext';
import { duplicateHoliday, holidayDuplicateKey, newHolidayId, normalizeAcademicYear, validateAcademicYearDraft } from '../utils/academicYear';
import {
  fetchHolidayCountries,
  fetchPublicHolidays,
  resolveCountryFromCoordinates,
} from '../utils/api';
import './Settings.css';

export default function AcademicYear() {
  const {
    academicYears, selectedAcademicYearId, academicYear, isLoading, isSaving, error, requestReference,
    selectAcademicYear, createAcademicYear, saveAcademicYear,
  } = useAcademicYear();
  const [draft, setDraft] = useState(academicYear);
  const [savedFlash, setSavedFlash] = useState(false);
  const [holidayCountries, setHolidayCountries] = useState([]);
  const [holidayCountriesError, setHolidayCountriesError] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importError, setImportError] = useState('');
  const [manualCountryMode, setManualCountryMode] = useState(false);
  const [manualCountryInput, setManualCountryInput] = useState('');
  const [isImportingHolidays, setIsImportingHolidays] = useState(false);
  const [formError, setFormError] = useState('');
  const [reviewScope, setReviewScope] = useState(0);

  const [expanded, setExpanded] = useState({ school: false, public: false });
  const [focusHoliday, setFocusHoliday] = useState(null);
  const saveErrorRef = useRef(null);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const importScope = useRef(0);
  const importController = useRef(null);
  const importStatusRef = useRef(null);
  const [focusImportStatus, setFocusImportStatus] = useState(false);
  useEffect(() => { if (focusImportStatus) { importStatusRef.current?.focus(); setFocusImportStatus(false); } }, [focusImportStatus]);
  function invalidateImport() { importScope.current++; importController.current?.abort(); importController.current = null; }
  function beginImport() { invalidateImport(); const controller = new AbortController(); importController.current = controller; return { scope: importScope.current, controller }; }

  useEffect(() => {
    invalidateImport();
    setIsImportingHolidays(false); setImportStatus(''); setImportError('');
    return () => { invalidateImport(); };
  }, [selectedAcademicYearId, reviewScope, draft.startDate, draft.endDate]);
  useEffect(() => { setExpanded({ school: false, public: false }); setFocusHoliday(null); }, [selectedAcademicYearId, reviewScope]);
  useEffect(() => {
    if (focusHoliday) {
      document.getElementById(`holiday-label-${focusHoliday}`)?.focus();
      setFocusHoliday(null);
    }
  }, [focusHoliday, expanded]);
  function revealHoliday(holiday) {
    setExpanded(value => ({ ...value, [holiday.holidayType || 'school']: true }));
    setFocusHoliday(holiday.id);
  }

  useEffect(() => {
    setDraft(academicYear);
  }, [academicYear]);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      try {
        const countries = await fetchHolidayCountries();
        if (!isMounted) return;
        setHolidayCountries(countries);
      } catch (error) {
        if (!isMounted) return;
        setHolidayCountriesError(error.message || 'Could not load country list.');
      }
    };
    run();
    return () => {
      isMounted = false;
    };
  }, []);

  const hasUnsavedChanges = JSON.stringify(normalizeAcademicYear(draft)) !== JSON.stringify(academicYear);

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSaving) return;
    const normalized = normalizeAcademicYear(draft);
    const invalidHoliday = draft.holidays.find(({ label, startDate, endDate }) => suggestionError({ label, startDate, endDate }, draft.startDate, draft.endDate)) || duplicateHoliday(draft.holidays);
    const validationError = draft.holidays.map(({ label, startDate, endDate }) =>
      suggestionError({ label, startDate, endDate }, draft.startDate, draft.endDate),
    ).find(Boolean) || validateAcademicYearDraft(normalized);
    if (validationError) { setFormError(validationError); if (invalidHoliday) revealHoliday(invalidHoliday); return; }
    setFormError('');
    setDraft(normalized);
    const saved = await saveAcademicYear(normalized);
    if (saved) {
      setDraft(saved);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2400);
    } else {
      setExpanded({ school: true, public: true });
      requestAnimationFrame(() => saveErrorRef.current?.focus());
    }
  }

  function approveDiscard() {
    return !hasUnsavedChanges || window.confirm('Discard unsaved academic-year changes?');
  }

  async function handleYearChange(event) {
    const nextId = event.target.value;
    if (!approveDiscard()) { event.target.value = selectedAcademicYearId || ''; return; }
    setSavedFlash(false);
    setFormError('');
    setReviewScope(value => value + 1);
    await selectAcademicYear(nextId || null);
  }

  function handleCreate() {
    if (!approveDiscard()) return;
    setSavedFlash(false);
    setFormError('');
    setReviewScope(value => value + 1);
    createAcademicYear();
  }

  function addHoliday(holidayType = 'school') {
    if (draft.holidays.length >= 100) { setFormError('An academic year can contain no more than 100 holidays.'); return; }
    const holiday = { id: newHolidayId(), label: '', startDate: '', endDate: '', holidayType };
    setDraft(d => ({ ...d, holidays: [...d.holidays, holiday] }));
    revealHoliday(holiday);
  }

  function acceptAiDraft(next) {
    const added = next.holidays.find(h => !draft.holidays.some(existing => existing.id === h.id));
    setDraft(next);
    if (added) revealHoliday(added);
  }

  function removeHoliday(id) {
    setDraft((d) => ({
      ...d,
      holidays: d.holidays.filter((h) => h.id !== id),
    }));
  }

  function updateHoliday(id, patch) {
    setDraft((d) => ({
      ...d,
      holidays: d.holidays.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));
  }

  function selectedHolidayYears() {
    const startYear = Number.parseInt(String(draft.startDate || '').slice(0, 4), 10);
    if (Number.isInteger(startYear)) {
      return [startYear, startYear + 1];
    }
    return [new Date().getFullYear()];
  }

  function selectedHolidayDateRange() {
    const startDate = String(draft.startDate || '').trim();
    const endDate = String(draft.endDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return null;
    }
    return { startDate, endDate };
  }

  function resolveCountryCodeFromManualInput() {
    const text = manualCountryInput.trim();
    if (!text) return '';
    const exactByCode = holidayCountries.find((country) => country.countryCode === text.toUpperCase());
    if (exactByCode) return exactByCode.countryCode;
    const exactByLabel = holidayCountries.find(
      (country) => `${country.name} (${country.countryCode})`.toLowerCase() === text.toLowerCase(),
    );
    if (exactByLabel) return exactByLabel.countryCode;
    const exactByName = holidayCountries.find((country) => country.name.toLowerCase() === text.toLowerCase());
    if (exactByName) return exactByName.countryCode;
    return '';
  }

  function mergeImportedHolidays(currentDraft, importedHolidays) {
    const existingKeys = new Set(currentDraft.holidays.map(holidayDuplicateKey));

    const nextImported = importedHolidays
      .map((holiday) => ({
        id: newHolidayId(),
        holidayType: 'public',
        label: holiday.localName || holiday.name || 'Public holiday',
        startDate: holiday.date,
        endDate: holiday.date,
      }))
      .filter((holiday) => {
        const key = holidayDuplicateKey(holiday);
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

    if (currentDraft.holidays.length + nextImported.length > 100) throw new Error('An academic year can contain no more than 100 holidays.');
    return {
      ...currentDraft,
      holidays: [...currentDraft.holidays, ...nextImported],
    };
  }

  async function importHolidaysForCountry(countryCode, sourceLabel, { scope, controller }) {
    if (scope !== importScope.current) return;
    setIsImportingHolidays(true);
    setImportError('');
    setImportStatus('');
    try {
      const years = selectedHolidayYears();
      const results = await Promise.all(
        years.map((year) => fetchPublicHolidays({ countryCode, year }, { signal: controller.signal })),
      );
      if (scope !== importScope.current) return;
      const allHolidays = results.flat();
      const range = selectedHolidayDateRange();
      if (!range) {
        throw new Error('Set the academic year start date before importing holidays.');
      }
      const holidays = allHolidays.filter(
        (holiday) => holiday.date >= range.startDate && holiday.date <= range.endDate,
      );
      const previous = latestDraft.current;
      const next = mergeImportedHolidays(previous, holidays);
      const added = next.holidays.find(h => !previous.holidays.some(existing => existing.id === h.id));
      setDraft(next);
      if (added) revealHoliday(added);
      else setFocusImportStatus(true);
      setExpanded(value => ({ ...value, public: true }));
      setImportStatus(
        added
          ? `Imported ${next.holidays.length - previous.holidays.length} holidays for ${sourceLabel} (${range.startDate} to ${range.endDate}). Review and save.`
          : holidays.length ? 'No new public holidays added. Matching holidays are already in the draft.' : `No public holidays found for ${sourceLabel} between ${range.startDate} and ${range.endDate}.`,
      );
    } catch (error) {
      if (scope !== importScope.current || controller.signal.aborted || error?.name === 'AbortError') return;
      setImportError(error.message || 'Could not import holidays.');
      setManualCountryMode(true);
    } finally {
      controller.abort();
      if (scope === importScope.current) { setIsImportingHolidays(false); if (importController.current === controller) importController.current = null; }
    }
  }

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Location is not available in this browser.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      });
    });
  }

  async function handleUseLocation() {
    const operation = beginImport();
    const { scope, controller } = operation;
    setIsImportingHolidays(true);
    setImportError('');
    setImportStatus('');
    try {
      const position = await getCurrentPosition();
      if (scope !== importScope.current) return;
      const lat = position.coords?.latitude;
      const lng = position.coords?.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new Error('Could not read your current location.');
      }
      const { countryCode, countryName } = await resolveCountryFromCoordinates({ lat, lng }, { signal: controller.signal });
      if (scope !== importScope.current) return;
      setManualCountryInput(countryName ? `${countryName} (${countryCode})` : countryCode);
      await importHolidaysForCountry(countryCode, countryName || countryCode, operation);
    } catch (error) {
      if (scope !== importScope.current || controller.signal.aborted || error?.name === 'AbortError') return;
      setImportError(error.message || 'Could not detect your location.');
      setManualCountryMode(true);
      setIsImportingHolidays(false);
    } finally {
      if (importController.current === controller) importController.current = null;
    }
  }

  async function handleManualImport() {
    const countryCode = resolveCountryCodeFromManualInput();
    if (!countryCode) {
      setImportError('Select a country from the dropdown list.');
      return;
    }
    const country = holidayCountries.find((entry) => entry.countryCode === countryCode);
    await importHolidaysForCountry(countryCode, country?.name || countryCode, beginImport());
  }

  function holidayPanel(category) {
    const count = draft.holidays.filter(h => (h.holidayType || 'school') === category).length;
    return <>
      <div className="academic-holiday-list-controls">
        <span>{count} {category} holidays</span>
        <button id={`${category}-holidays-toggle`} type="button" className="settings-reset"
          aria-expanded={expanded[category]} aria-controls={`${category}-holidays-panel`}
          aria-label={`${expanded[category] ? 'Hide' : 'Show'} ${category} holidays (${count})`}
          onClick={() => setExpanded(value => ({ ...value, [category]: !value[category] }))}>
          {expanded[category] ? `Hide ${category} holidays` : `Show ${category} holidays (${count})`}
        </button>
      </div>
      <div id={`${category}-holidays-panel`} hidden={!expanded[category]} aria-labelledby={`${category}-holidays-toggle`}>
        {count ? renderHolidays(category) : <p className="settings-hint">No {category} holidays yet.</p>}
      </div>
    </>;
  }

  function renderHolidays(category) {
    return draft.holidays.filter(h => (h.holidayType || 'school') === category).map((h, index) => (
      <div key={h.id} className="settings-holiday-card">
        <div className="settings-holiday-card-head">
          <h3 className="settings-holiday-heading">Holiday {index + 1}</h3>
          <button
            type="button"
            className="settings-holiday-remove"
            aria-label={`Remove ${category} holiday ${index + 1}`}
            onClick={() => { removeHoliday(h.id); document.getElementById(`${category}-holidays-toggle`)?.focus(); }}
          >
            Remove
          </button>
        </div>
        <div className="settings-holiday-grid">
          <div className="settings-field settings-field--inline">
            <label htmlFor={`holiday-label-${h.id}`}>Label</label>
            <input
              id={`holiday-label-${h.id}`}
              type="text"
              value={h.label}
              placeholder="e.g. October half-term"
              autoComplete="off"
              onChange={(e) => updateHoliday(h.id, { label: e.target.value })}
            />
          </div>
          <div className="settings-field settings-field--inline">
            <label htmlFor={`holiday-start-${h.id}`}>First day</label>
            <input
              id={`holiday-start-${h.id}`}
              type="date"
              value={h.startDate}
              onChange={(e) => updateHoliday(h.id, { startDate: e.target.value })}
            />
          </div>
          <div className="settings-field settings-field--inline">
            <label htmlFor={`holiday-end-${h.id}`}>Last day</label>
            <input
              id={`holiday-end-${h.id}`}
              type="date"
              value={h.endDate}
              onChange={(e) => updateHoliday(h.id, { endDate: e.target.value })}
            />
          </div>
        </div>
      </div>
    ));
  }

  return (
    <main className="settings-page academic-year-page">
      <div className="container settings-inner settings-inner--wide">
        <p className="settings-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          <Link to="/settings">Settings</Link>
          <span aria-hidden> / </span>
          Academic year
        </p>
        <h1 className="settings-title">Academic year</h1>
        <SettingsSubnav />
        <p className="settings-lead">
          Name your academic year, record when it starts, and add school holidays and closures. On the weekly timetable (when you move
          by calendar week), days that fall in a holiday range are shown as closed so lessons are not displayed for those
          dates.
        </p>

        <div className="settings-year-picker">
          <div className="settings-field">
            <label htmlFor="academic-year-selector">Selected academic year</label>
            <select id="academic-year-selector" value={selectedAcademicYearId || ''} onChange={handleYearChange} disabled={isLoading || isSaving}>
              <option value="">{academicYears.length ? 'Choose an academic year' : 'No academic year selected'}</option>
              {academicYears.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
            </select>
          </div>
          <button type="button" className="add-row-button" onClick={handleCreate} disabled={isLoading || isSaving}>Create academic year</button>
        </div>
        {isLoading ? <p role="status">Loading academic years…</p> : null}
        {error ? <p ref={saveErrorRef} tabIndex={-1} className="settings-hint settings-hint--error" role="alert">{error}</p> : null}
        {error && requestReference ? <p className="settings-hint">Support reference: <code>{requestReference}</code></p> : null}

        <form className="settings-timetable-form" onSubmit={handleSubmit}>
          <h2 className="settings-section-title">Details</h2>
          <div className="settings-field">
            <label htmlFor="academic-year-label">Academic year</label>
            <input
              id="academic-year-label"
              type="text"
              value={draft.label}
              placeholder="e.g. 2025/2026"
              autoComplete="off"
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
            <p className="settings-hint">A label for your own reference (not shown on the timetable grid).</p>
          </div>

          <div className="settings-field">
            <label htmlFor="academic-year-start">Start date of academic year</label>
            <input
              id="academic-year-start"
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
            />
            <p className="settings-hint">Optional. For your records; holiday blanking uses the holiday date ranges below.</p>
          </div>

          <div className="settings-field">
            <label htmlFor="academic-year-end">End date of academic year</label>
            <input id="academic-year-end" type="date" value={draft.endDate} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} />
            <p className="settings-hint">The end date is inclusive.</p>
          </div>

          <section className="academic-holiday-section" aria-labelledby="school-holidays-heading">
            <h2 id="school-holidays-heading" className="settings-section-title settings-section-title--sub">School holidays and closures</h2>
            <p className="settings-hint settings-hint--tight">
              Each holiday has a name and an inclusive date range. Overlapping ranges are allowed; the first matching entry
              in the list is used. Include INSET, training and other non-pupil days as well as holidays. Manual entries and reviewed AI suggestions are saved together.
            </p>

            {holidayPanel('school')}

            <div className="settings-actions settings-actions--stack">
              <button type="button" className="add-row-button" onClick={() => addHoliday('school')} disabled={isLoading || isSaving || draft.holidays.length >= 100}>
                + Add holiday
              </button>
            </div>

            <SchoolHolidayAiImport key={`${selectedAcademicYearId || 'new'}-${reviewScope}`} draft={draft} onDraftChange={acceptAiDraft} disabled={isLoading || isSaving} />
          </section>
          <section className="academic-holiday-section" aria-labelledby="public-holidays-heading">
            <h2 id="public-holidays-heading" className="settings-section-title">Public holidays</h2>
            <p className="settings-hint">Import public holidays for your selected location, without AI. They are saved separately as public holidays. Review them below before saving.</p>
            <div className="settings-holiday-import">
              <button
                type="button"
                className="add-row-button"
                onClick={handleUseLocation}
                disabled={isImportingHolidays}
              >
                {isImportingHolidays ? 'Checking location…' : 'Use my location'}
              </button>
              <button type="button" className="settings-reset" onClick={() => { invalidateImport(); setIsImportingHolidays(false); setManualCountryMode(true); }}>Choose country</button>
              {manualCountryMode ? (
                <div className="settings-holiday-import-manual">
                  <label htmlFor="holiday-country-input">Country</label>
                  <input
                    id="holiday-country-input"
                    type="text"
                    list="holiday-country-options"
                    placeholder="Type country name"
                    value={manualCountryInput}
                    onChange={(event) => { invalidateImport(); setIsImportingHolidays(false); setImportStatus(''); setImportError(''); setManualCountryInput(event.target.value); }}
                    autoComplete="off"
                  />
                  <datalist id="holiday-country-options">
                    {holidayCountries.map((country) => (
                      <option key={country.countryCode} value={`${country.name} (${country.countryCode})`} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    className="settings-reset"
                    onClick={handleManualImport}
                    disabled={isImportingHolidays}
                  >
                    Import holidays
                  </button>
                </div>
              ) : null}
              {holidayCountriesError ? <p className="settings-hint">{holidayCountriesError}</p> : null}
              {importError ? <p className="settings-hint settings-hint--error">{importError}</p> : null}
              {importStatus ? <p ref={importStatusRef} id="public-holiday-import-status" tabIndex={-1} role="status" className="settings-hint settings-hint--success">{importStatus}</p> : null}
            </div>
            <div className="academic-holiday-manual-action">
              <button type="button" className="add-row-button" onClick={() => addHoliday('public')} disabled={isLoading || isSaving || draft.holidays.length >= 100}>+ Add public holiday</button>
            </div>
            {holidayPanel('public')}
          </section>

          <div className="settings-actions">
            <button type="submit" className="settings-save" disabled={isSaving || isLoading}>
              {isSaving ? 'Saving…' : 'Save academic year'}
            </button>
          </div>
          {formError ? <p className="settings-hint settings-hint--error" role="alert">{formError}</p> : null}
          {savedFlash ? <p className="settings-saved" role="status">Academic year saved.</p> : null}
        </form>
      </div>
    </main>
  );
}
