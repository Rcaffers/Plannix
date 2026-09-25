import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SettingsSubnav from '../components/SettingsSubnav';
import ProjectCard from '../components/ProjectCard';
import { timetableProject } from '../utils/projectsData';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { useClasses } from '../context/ClassContext';
import { TIMETABLE_CYCLE } from '../utils/timetableLayout';
import './Classes.css';

export default function Classes() {
  const location = useLocation();
  const isInputPage = location.pathname === '/classes/input';
  const { layout } = useTimetableLayout();
  const {
    entries,
    isLoaded,
    isLoading,
    isSaving,
    dirty,
    error,
    requestReference,
    saved,
    updateEntries,
    addClass,
    removeClass,
    save,
    reload,
  } = useClasses();
  const [inputWeek, setInputWeek] = useState(1);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    const protectNavigation = (event) => {
      const link = event.target.closest?.('a[href]');
      if (link && !window.confirm('Discard unsaved class changes and leave this page?')) {
        event.preventDefault();
      }
    };
    document.addEventListener('click', protectNavigation);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', protectNavigation);
    };
  }, [dirty]);

  function updateEntry(index, patch) {
    updateEntries((current) => {
      const next = [...current];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await save();
  }

  function handleClearClasses() {
    if (!entries.length) {
      return;
    }
    const confirmed = window.confirm(
      'Remove all classes from this draft? Timetable placements are not deleted. The change is applied only when you save.',
    );
    if (confirmed) updateEntries([]);
  }

  function selectInputWeek(week) {
    if (week === inputWeek || window.__plannixConfirmSessionDiscard?.() !== false) setInputWeek(week);
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
              Place classes into timetable slots here. Use Edit classes to change class positions. Changes save automatically; choose Finish editing when you are done.
            </p>
            {isLoading ? <p className="classes-hint" role="status">Loading classes…</p> : null}
            {error ? <p className="classes-hint classes-hint--error" role="alert">{error}</p> : null}
            {!isLoading && !isLoaded && !error ? <p className="classes-hint">Select an academic year to load classes.</p> : null}
            {layout.cycle === TIMETABLE_CYCLE.TWO_WEEK ? (
              <div className="classes-week-switch" role="group" aria-label="Input week A or week B selector">
                <button
                  type="button"
                  className={`classes-week-switch-btn${inputWeek === 1 ? ' is-active' : ''}`}
                  onClick={() => selectInputWeek(1)}
                >
                  Week A
                </button>
                <button
                  type="button"
                  className={`classes-week-switch-btn${inputWeek === 2 ? ' is-active' : ''}`}
                  onClick={() => selectInputWeek(2)}
                >
                  Week B
                </button>
              </div>
            ) : null}
            <section className="classes-input-timetable">
              <ProjectCard
                project={timetableProject}
                enableEditing
                enableClassPlacement
                enableFixedPhoneSingleDay
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

              {isLoading ? <p role="status">Loading classes…</p> : null}
              {error ? <p className="classes-hint classes-hint--error" role="alert">{error}</p> : null}
              {error && requestReference ? <p className="classes-hint">Support reference: <code>{requestReference}</code></p> : null}
              {error ? <button type="button" className="add-row-button" onClick={reload}>Reload classes</button> : null}
              {!isLoading && !isLoaded && !error ? <p className="classes-hint">Select an academic year before editing classes.</p> : null}

              {isLoaded && entries.length === 0 ? (
                <p className="classes-hint classes-hint--standalone">No classes yet. Use &quot;Add class&quot; below.</p>
              ) : null}

              {entries.map((entry, index) => (
                <section key={entry.clientKey} className="classes-entry-card">
                  <div className="classes-entry-card-head">
                    <h2 className="classes-entry-title">Class {index + 1}</h2>
                    <button
                      type="button"
                      className="classes-entry-remove"
                      onClick={() => removeClass(index)}
                      disabled={isSaving}
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
                        disabled={isSaving}
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
                        min={1}
                        max={50}
                        value={entry.frequency}
                        onChange={(event) => updateEntry(index, { frequency: event.target.value })}
                        disabled={isSaving}
                      />
                    </div>
                  </div>
                </section>
              ))}

              <div className="classes-actions classes-actions--add">
                <button
                  type="button"
                  className="add-row-button"
                  onClick={addClass}
                  disabled={!isLoaded || isSaving || entries.length >= 60}
                >
                  + Add class
                </button>
                <button
                  type="button"
                  className="add-row-button add-row-button--danger"
                  onClick={handleClearClasses}
                  disabled={!isLoaded || isSaving || entries.length === 0}
                >
                  Clear classes
                </button>
              </div>

              <div className="classes-actions">
                <button type="submit" className="classes-save" disabled={!isLoaded || isLoading || isSaving || !dirty}>
                  {isSaving ? 'Saving…' : 'Save classes'}
                </button>
              </div>
              {saved ? <p className="classes-saved" role="status">Classes saved.</p> : null}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
