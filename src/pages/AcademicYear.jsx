import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SettingsSubnav from '../components/SettingsSubnav';
import { useAcademicYear } from '../context/AcademicYearContext';
import { newHolidayId, normalizeAcademicYear } from '../utils/academicYear';
import {
  fetchHolidayCountries,
  fetchPublicHolidays,
  resolveCountryFromCoordinates,
} from '../utils/api';
import './Settings.css';

export default function AcademicYear() {
  const { academicYear, setAcademicYear } = useAcademicYear();
  const [draft, setDraft] = useState(academicYear);
  const [savedFlash, setSavedFlash] = useState(false);
  const [holidayCountries, setHolidayCountries] = useState([]);
  const [holidayCountriesError, setHolidayCountriesError] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importError, setImportError] = useState('');
  const [manualCountryMode, setManualCountryMode] = useState(false);
  const [manualCountryInput, setManualCountryInput] = useState('');
  const [isImportingHolidays, setIsImportingHolidays] = useState(false);

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

  function handleSubmit(event) {
    event.preventDefault();
    const normalized = normalizeAcademicYear(draft);
    setDraft(normalized);
    setAcademicYear(normalized);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2400);
  }

  function addHoliday() {
    setDraft((d) => ({
      ...d,
      holidays: [...d.holidays, { id: newHolidayId(), label: '', startDate: '', endDate: '' }],
    }));
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return null;
    }
    const start = new Date(`${startDate}T00:00:00`);
    if (Number.isNaN(start.getTime())) {
      return null;
    }
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    const toYmd = (value) => {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    return {
      startDate,
      endDate: toYmd(end),
    };
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
    const existingKeys = new Set(
      currentDraft.holidays.map((holiday) => {
        const label = String(holiday.label || '').trim().toLowerCase();
        return `${holiday.startDate}|${holiday.endDate || holiday.startDate}|${label}`;
      }),
    );

    const nextImported = importedHolidays
      .map((holiday) => ({
        id: newHolidayId(),
        label: holiday.localName || holiday.name || 'Public holiday',
        startDate: holiday.date,
        endDate: holiday.date,
      }))
      .filter((holiday) => {
        const key = `${holiday.startDate}|${holiday.endDate}|${holiday.label.trim().toLowerCase()}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

    return {
      ...currentDraft,
      holidays: [...currentDraft.holidays, ...nextImported],
    };
  }

  async function importHolidaysForCountry(countryCode, sourceLabel) {
    setIsImportingHolidays(true);
    setImportError('');
    setImportStatus('');
    try {
      const years = selectedHolidayYears();
      const results = await Promise.all(
        years.map((year) => fetchPublicHolidays({ countryCode, year })),
      );
      const allHolidays = results.flat();
      const range = selectedHolidayDateRange();
      if (!range) {
        throw new Error('Set the academic year start date before importing holidays.');
      }
      const holidays = allHolidays.filter(
        (holiday) => holiday.date >= range.startDate && holiday.date <= range.endDate,
      );
      setDraft((current) => mergeImportedHolidays(current, holidays));
      setImportStatus(
        holidays.length
          ? `Imported ${holidays.length} holidays for ${sourceLabel} (${range.startDate} to ${range.endDate}). Review and save.`
          : `No public holidays found for ${sourceLabel} between ${range.startDate} and ${range.endDate}.`,
      );
    } catch (error) {
      setImportError(error.message || 'Could not import holidays.');
      setManualCountryMode(true);
    } finally {
      setIsImportingHolidays(false);
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
    setIsImportingHolidays(true);
    setImportError('');
    setImportStatus('');
    try {
      const position = await getCurrentPosition();
      const lat = position.coords?.latitude;
      const lng = position.coords?.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new Error('Could not read your current location.');
      }
      const { countryCode, countryName } = await resolveCountryFromCoordinates({ lat, lng });
      setManualCountryInput(countryName ? `${countryName} (${countryCode})` : countryCode);
      await importHolidaysForCountry(countryCode, countryName || countryCode);
    } catch (error) {
      setImportError(error.message || 'Could not detect your location.');
      setManualCountryMode(true);
      setIsImportingHolidays(false);
    }
  }

  async function handleManualImport() {
    const countryCode = resolveCountryCodeFromManualInput();
    if (!countryCode) {
      setImportError('Select a country from the dropdown list.');
      return;
    }
    const country = holidayCountries.find((entry) => entry.countryCode === countryCode);
    await importHolidaysForCountry(countryCode, country?.name || countryCode);
  }

  return (
    <main className="settings-page">
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
          Name your academic year, record when it starts, and add school holidays. On the weekly timetable (when you move
          by calendar week), days that fall in a holiday range are shown as closed so lessons are not displayed for those
          dates.
        </p>

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

          <h2 className="settings-section-title settings-section-title--sub">Holidays</h2>
          <p className="settings-hint settings-hint--tight">
            Each holiday has a name and an inclusive date range. Overlapping ranges are allowed; the first matching entry
            in the list is used.
          </p>
          <div className="settings-holiday-import">
            <button
              type="button"
              className="add-row-button"
              onClick={handleUseLocation}
              disabled={isImportingHolidays}
            >
              {isImportingHolidays ? 'Checking location…' : 'Use my location'}
            </button>
            {manualCountryMode ? (
              <div className="settings-holiday-import-manual">
                <label htmlFor="holiday-country-input">Country</label>
                <input
                  id="holiday-country-input"
                  type="text"
                  list="holiday-country-options"
                  placeholder="Type country name"
                  value={manualCountryInput}
                  onChange={(event) => setManualCountryInput(event.target.value)}
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
            {importStatus ? <p className="settings-hint settings-hint--success">{importStatus}</p> : null}
          </div>

          {draft.holidays.length === 0 ? (
            <p className="settings-hint">No holidays yet. Use &quot;Add holiday&quot; to create one.</p>
          ) : null}

          {draft.holidays.map((h, index) => (
            <div key={h.id} className="settings-holiday-card">
              <div className="settings-holiday-card-head">
                <h3 className="settings-holiday-heading">Holiday {index + 1}</h3>
                <button
                  type="button"
                  className="settings-holiday-remove"
                  onClick={() => removeHoliday(h.id)}
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
          ))}

          <div className="settings-actions settings-actions--stack">
            <button type="button" className="add-row-button" onClick={addHoliday}>
              + Add holiday
            </button>
          </div>

          <div className="settings-actions">
            <button type="submit" className="settings-save">
              Save academic year
            </button>
          </div>
          {savedFlash ? <p className="settings-saved" role="status">Academic year saved.</p> : null}
        </form>
      </div>
    </main>
  );
}
