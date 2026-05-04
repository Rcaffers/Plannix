import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { DEFAULT_LUNCH, DEFAULT_REGISTRATION, TIMETABLE_CYCLE } from '../utils/timetableLayout';
import './Settings.css';

const BREAKS_MAX = 6;

function ensureLunch(d) {
  return d.lunch && typeof d.lunch === 'object' ? d.lunch : { ...DEFAULT_LUNCH };
}

function ensureBreaks(d) {
  return Array.isArray(d.breaks) ? d.breaks : [];
}

function ensureRegistration(d) {
  return d.registration && typeof d.registration === 'object' ? d.registration : { ...DEFAULT_REGISTRATION };
}

export default function Settings() {
  const { layout, setLayout, resetLayout } = useTimetableLayout();
  const [draft, setDraft] = useState(layout);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDraft(layout);
  }, [layout]);

  function handleSubmit(event) {
    event.preventDefault();
    setLayout(draft);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2400);
  }

  function handleResetTimetable() {
    resetLayout();
  }

  function setBreakCount(count) {
    const n = Math.min(BREAKS_MAX, Math.max(0, Math.floor(Number(count)) || 0));
    setDraft((d) => {
      const cur = [...ensureBreaks(d)];
      while (cur.length < n) {
        cur.push({ startTime: '10:45', lengthMinutes: 15 });
      }
      return { ...d, breaks: cur.slice(0, n) };
    });
  }

  function updateBreak(index, patch) {
    setDraft((d) => {
      const breaks = [...ensureBreaks(d)];
      breaks[index] = { ...breaks[index], ...patch };
      return { ...d, breaks };
    });
  }

  function updateLunch(patch) {
    setDraft((d) => ({
      ...d,
      lunch: { ...ensureLunch(d), ...patch },
    }));
  }

  function updateRegistration(patch) {
    setDraft((d) => ({
      ...d,
      registration: { ...ensureRegistration(d), ...patch },
    }));
  }

  const breaks = ensureBreaks(draft);
  const lunch = ensureLunch(draft);
  const registration = ensureRegistration(draft);

  return (
    <main className="settings-page">
      <div className="container settings-inner settings-inner--wide">
        <p className="settings-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          Settings
        </p>
        <h1 className="settings-title">Settings</h1>
        <p className="settings-lead">
          Configure the sample timetable: teaching periods, optional registration, breaks, lunch, and week cycle. Rows
          are ordered by start time (lessons use fixed spacing from the school start; registration, breaks, and lunch use
          the times you set).
        </p>

        <form className="settings-timetable-form" onSubmit={handleSubmit}>
          <h2 className="settings-section-title">Timetable layout</h2>

          <div className="settings-field">
            <label htmlFor="timetable-periods">Periods per day</label>
            <input
              id="timetable-periods"
              type="number"
              min={1}
              max={12}
              value={draft.periodsPerDay}
              onChange={(e) =>
                setDraft((d) => ({ ...d, periodsPerDay: Number.parseInt(e.target.value, 10) || 1 }))
              }
            />
            <p className="settings-hint">Number of teaching period slots (1–12). Each has the same length below.</p>
          </div>

          <div className="settings-field">
            <label htmlFor="timetable-length">Period length (minutes)</label>
            <input
              id="timetable-length"
              type="number"
              min={20}
              max={120}
              step={5}
              value={draft.periodLengthMinutes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, periodLengthMinutes: Number.parseInt(e.target.value, 10) || 60 }))
              }
            />
            <p className="settings-hint">Lesson periods run back-to-back from the school start time.</p>
          </div>

          <div className="settings-field">
            <label htmlFor="timetable-start">School day start</label>
            <input
              id="timetable-start"
              type="time"
              value={draft.schoolStartTime}
              onChange={(e) => setDraft((d) => ({ ...d, schoolStartTime: e.target.value }))}
            />
            <p className="settings-hint">When period 1 begins.</p>
          </div>

          <fieldset className="settings-fieldset">
            <legend className="settings-legend">Timetable cycle</legend>
            <label className="settings-radio">
              <input
                type="radio"
                name="timetable-cycle"
                checked={draft.cycle === TIMETABLE_CYCLE.ONE_WEEK}
                onChange={() => setDraft((d) => ({ ...d, cycle: TIMETABLE_CYCLE.ONE_WEEK }))}
              />
              One week (Mon–Fri)
            </label>
            <label className="settings-radio">
              <input
                type="radio"
                name="timetable-cycle"
                checked={draft.cycle === TIMETABLE_CYCLE.TWO_WEEK}
                onChange={() => setDraft((d) => ({ ...d, cycle: TIMETABLE_CYCLE.TWO_WEEK }))}
              />
              Two weeks (Mon–Fri for week 1, then Mon–Fri for week 2)
            </label>
          </fieldset>

          <h2 className="settings-section-title settings-section-title--sub">Registration</h2>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={Boolean(registration.enabled)}
              onChange={(e) => updateRegistration({ enabled: e.target.checked })}
            />
            Include registration in the timetable
          </label>
          <p className="settings-hint settings-hint--tight">
            When enabled, a registration row appears in the grid (same on each day). Set when it starts and how long it
            lasts.
          </p>
          {registration.enabled ? (
            <div className="settings-registration-grid">
              <div className="settings-field settings-field--inline">
                <label htmlFor="registration-start">Start time</label>
                <input
                  id="registration-start"
                  type="time"
                  value={registration.startTime}
                  onChange={(e) => updateRegistration({ startTime: e.target.value })}
                />
              </div>
              <div className="settings-field settings-field--inline">
                <label htmlFor="registration-length">Length (minutes)</label>
                <input
                  id="registration-length"
                  type="number"
                  min={5}
                  max={120}
                  step={5}
                  value={registration.lengthMinutes}
                  onChange={(e) =>
                    updateRegistration({
                      lengthMinutes: Number.parseInt(e.target.value, 10) || 15,
                    })
                  }
                />
              </div>
            </div>
          ) : null}

          <h2 className="settings-section-title settings-section-title--sub">Breaks</h2>
          <div className="settings-field">
            <label htmlFor="timetable-break-count">Number of breaks</label>
            <input
              id="timetable-break-count"
              type="number"
              min={0}
              max={BREAKS_MAX}
              value={breaks.length}
              onChange={(e) => setBreakCount(e.target.value)}
            />
            <p className="settings-hint">
              Up to {BREAKS_MAX} breaks. Rows are ordered by start time together with lessons; for the clearest grid,
              place breaks between lesson end times (lessons stay evenly spaced from the school start).
            </p>
          </div>

          {breaks.map((b, index) => (
            <div key={index} className="settings-break-card">
              <h3 className="settings-break-heading">Break {index + 1}</h3>
              <div className="settings-break-grid">
                <div className="settings-field settings-field--inline">
                  <label htmlFor={`break-start-${index}`}>Start time</label>
                  <input
                    id={`break-start-${index}`}
                    type="time"
                    value={b.startTime}
                    onChange={(e) => updateBreak(index, { startTime: e.target.value })}
                  />
                </div>
                <div className="settings-field settings-field--inline">
                  <label htmlFor={`break-length-${index}`}>Length (minutes)</label>
                  <input
                    id={`break-length-${index}`}
                    type="number"
                    min={5}
                    max={120}
                    step={5}
                    value={b.lengthMinutes}
                    onChange={(e) =>
                      updateBreak(index, {
                        lengthMinutes: Number.parseInt(e.target.value, 10) || 15,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ))}

          <p className="settings-hint settings-hint--tight">
            Use the option below to keep break times saved but hide break rows from the timetable.
          </p>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={draft.showBreaksInTimetable !== false}
              onChange={(e) => setDraft((d) => ({ ...d, showBreaksInTimetable: e.target.checked }))}
            />
            Show break rows in the timetable
          </label>

          <h2 className="settings-section-title settings-section-title--sub">Lunch</h2>
          <div className="settings-lunch-grid">
            <div className="settings-field settings-field--inline">
              <label htmlFor="lunch-start">Start time</label>
              <input
                id="lunch-start"
                type="time"
                value={lunch.startTime}
                onChange={(e) => updateLunch({ startTime: e.target.value })}
              />
            </div>
            <div className="settings-field settings-field--inline">
              <label htmlFor="lunch-length">Length (minutes)</label>
              <input
                id="lunch-length"
                type="number"
                min={0}
                max={180}
                step={5}
                value={lunch.lengthMinutes}
                onChange={(e) =>
                  updateLunch({
                    lengthMinutes: Number.parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </div>
          </div>
          <p className="settings-hint settings-hint--tight">
            Set lunch length to 0 to remove lunch from the schedule. Use the option below to keep lunch configured but
            hide it from the timetable.
          </p>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={draft.showLunchInTimetable !== false}
              onChange={(e) => setDraft((d) => ({ ...d, showLunchInTimetable: e.target.checked }))}
            />
            Show lunch row in the timetable
          </label>
          <p className="settings-hint settings-hint--tight">
            When off, lunch start and length stay saved but the lunch row is hidden.
          </p>

          <div className="settings-actions">
            <button type="submit" className="settings-save">
              Save timetable layout
            </button>
            <button type="button" className="settings-reset" onClick={handleResetTimetable}>
              Reset timetable to defaults
            </button>
          </div>
          {savedFlash ? <p className="settings-saved" role="status">Timetable layout saved.</p> : null}
        </form>
      </div>
    </main>
  );
}
