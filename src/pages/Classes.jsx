import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SettingsSubnav from '../components/SettingsSubnav';
import ProjectCard from '../components/ProjectCard';
import { timetableProject } from '../utils/projectsData';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import {
  addClassEntry,
  cadenceFromTimetableCycle,
  loadClassesPlanFromStorage,
  normalizeClassesPlan,
  removeClassEntry,
  saveClassesPlanToStorage,
} from '../utils/classesPlanner';
import { TIMETABLE_CYCLE } from '../utils/timetableLayout';
import './Classes.css';

export default function Classes() {
  const location = useLocation();
  const isInputPage = location.pathname === '/classes/input';
  const { layout } = useTimetableLayout();
  const [draft, setDraft] = useState(() => loadClassesPlanFromStorage());
  const [savedFlash, setSavedFlash] = useState(false);
  const [inputWeek, setInputWeek] = useState(1);

  function updateEntry(index, patch) {
    setDraft((current) => {
      const entries = [...current.entries];
      entries[index] = { ...entries[index], ...patch };
      return { ...current, entries };
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const normalized = normalizeClassesPlan({
      ...draft,
      cadence: cadenceFromTimetableCycle(layout.cycle),
    });
    setDraft(normalized);
    saveClassesPlanToStorage(normalized);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2400);
  }

  function handleClearClasses() {
    if (!draft.entries.length) {
      return;
    }
    const confirmed = window.confirm('Clear all classes from this form?');
    if (!confirmed) {
      return;
    }
    setDraft((current) =>
      normalizeClassesPlan({
        ...current,
        cadence: cadenceFromTimetableCycle(layout.cycle),
        entries: [],
      }),
    );
  }

  return (
    <main className="classes-page">
      <div className="container classes-inner">
        <p className="classes-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          <Link to="/settings">Settings</Link>
          <span aria-hidden> / </span>
          {isInputPage ? 'Input classes' : 'Classes'}
        </p>
        <h1 className="classes-title">Classes</h1>
        <SettingsSubnav />

        {isInputPage ? (
          <>
            <p className="classes-lead">
              Place classes into timetable slots here. Use Edit classes to change class positions, then save them.
            </p>
            {layout.cycle === TIMETABLE_CYCLE.TWO_WEEK ? (
              <div className="classes-week-switch" role="group" aria-label="Input week A or week B selector">
                <button
                  type="button"
                  className={`classes-week-switch-btn${inputWeek === 1 ? ' is-active' : ''}`}
                  onClick={() => setInputWeek(1)}
                >
                  Week A
                </button>
                <button
                  type="button"
                  className={`classes-week-switch-btn${inputWeek === 2 ? ' is-active' : ''}`}
                  onClick={() => setInputWeek(2)}
                >
                  Week B
                </button>
              </div>
            ) : null}
            <section className="classes-input-timetable">
              <ProjectCard
                project={timetableProject}
                enableEditing
                weekMode="fixed"
                fixedWeekKey={layout.cycle === TIMETABLE_CYCLE.TWO_WEEK && inputWeek === 2 ? 'cycle-2' : 'cycle-1'}
                fixedWeekLabel={
                  layout.cycle === TIMETABLE_CYCLE.TWO_WEEK
                    ? `Input classes timetable (${inputWeek === 2 ? 'Week B' : 'Week A'})`
                    : 'Input classes timetable (Weekly)'
                }
              />
            </section>
          </>
        ) : (
          <>
            <p className="classes-lead">
              Add each class you teach and set how often you teach it. That frequency follows your{' '}
              <Link to="/settings">timetable cycle</Link>
              {layout.cycle === TIMETABLE_CYCLE.TWO_WEEK
                ? ' (two-week: counts are over weeks A and B combined).'
                : ' (one-week: counts are per calendar week).'}
            </p>

            <form className="classes-form" onSubmit={handleSubmit}>
              <p className="classes-hint classes-hint--standalone">
                You can add up to 60 classes. Change weekly vs two-week cycle under Timetable settings.
              </p>

              {draft.entries.length === 0 ? (
                <p className="classes-hint classes-hint--standalone">No classes yet. Use &quot;Add class&quot; below.</p>
              ) : null}

              {draft.entries.map((entry, index) => (
                <section key={entry.id || index} className="classes-entry-card">
                  <div className="classes-entry-card-head">
                    <h2 className="classes-entry-title">Class {index + 1}</h2>
                    <button
                      type="button"
                      className="classes-entry-remove"
                      onClick={() => setDraft((current) => removeClassEntry(current, index))}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="classes-entry-grid">
                    <div className="classes-field classes-field--inline">
                      <label htmlFor={`class-name-${index}`}>Class name</label>
                      <input
                        id={`class-name-${index}`}
                        type="text"
                        value={entry.name}
                        placeholder="e.g. 9A Maths"
                        onChange={(event) => updateEntry(index, { name: event.target.value })}
                      />
                    </div>
                    <div className="classes-field classes-field--inline">
                      <label htmlFor={`class-frequency-${index}`}>
                        {layout.cycle === TIMETABLE_CYCLE.TWO_WEEK
                          ? 'Times per 2-week cycle'
                          : 'Times per week'}
                      </label>
                      <input
                        id={`class-frequency-${index}`}
                        type="number"
                        min={0}
                        max={50}
                        value={entry.frequency}
                        onChange={(event) => updateEntry(index, { frequency: event.target.value })}
                      />
                    </div>
                  </div>
                </section>
              ))}

              <div className="classes-actions classes-actions--add">
                <button
                  type="button"
                  className="add-row-button"
                  onClick={() => setDraft((current) => addClassEntry(current))}
                  disabled={draft.entries.length >= 60}
                >
                  + Add class
                </button>
                <button
                  type="button"
                  className="add-row-button add-row-button--danger"
                  onClick={handleClearClasses}
                  disabled={draft.entries.length === 0}
                >
                  Clear classes
                </button>
              </div>

              <div className="classes-actions">
                <button type="submit" className="classes-save">
                  Save classes
                </button>
              </div>
              {savedFlash ? <p className="classes-saved">Classes saved.</p> : null}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
