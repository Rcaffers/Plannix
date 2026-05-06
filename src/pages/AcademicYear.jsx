import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SettingsSubnav from '../components/SettingsSubnav';
import { useAcademicYear } from '../context/AcademicYearContext';
import { newHolidayId, normalizeAcademicYear } from '../utils/academicYear';
import './Settings.css';

export default function AcademicYear() {
  const { academicYear, setAcademicYear } = useAcademicYear();
  const [draft, setDraft] = useState(academicYear);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDraft(academicYear);
  }, [academicYear]);

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
