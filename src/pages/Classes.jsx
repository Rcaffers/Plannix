import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CLASS_CADENCE,
  loadClassesPlanFromStorage,
  normalizeClassesPlan,
  saveClassesPlanToStorage,
  setClassEntryCount,
} from '../utils/classesPlanner';
import './Classes.css';

export default function Classes() {
  const [draft, setDraft] = useState(() => loadClassesPlanFromStorage());
  const [savedFlash, setSavedFlash] = useState(false);

  function handleClassCountChange(nextCount) {
    setDraft((current) => setClassEntryCount(current, nextCount));
  }

  function updateEntry(index, patch) {
    setDraft((current) => {
      const entries = [...current.entries];
      entries[index] = { ...entries[index], ...patch };
      return { ...current, entries };
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const normalized = normalizeClassesPlan(draft);
    setDraft(normalized);
    saveClassesPlanToStorage(normalized);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2400);
  }

  return (
    <main className="classes-page">
      <div className="container classes-inner">
        <p className="classes-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          Classes
        </p>
        <h1 className="classes-title">Classes</h1>
        <p className="classes-lead">
          Set how many different classes you teach, then add each class name and how many times you teach it either per
          week or per two-week cycle.
        </p>

        <form className="classes-form" onSubmit={handleSubmit}>
          <div className="classes-overview-grid">
            <div className="classes-field">
              <label htmlFor="classes-count">Number of different classes</label>
              <input
                id="classes-count"
                type="number"
                min={0}
                max={60}
                value={draft.entries.length}
                onChange={(event) => handleClassCountChange(event.target.value)}
              />
            </div>
            <div className="classes-field">
              <label htmlFor="classes-cadence">Frequency period</label>
              <select
                id="classes-cadence"
                value={draft.cadence}
                onChange={(event) =>
                  setDraft((current) => normalizeClassesPlan({ ...current, cadence: event.target.value }))
                }
              >
                <option value={CLASS_CADENCE.ONE_WEEK}>Per week</option>
                <option value={CLASS_CADENCE.TWO_WEEK}>Over 2 weeks</option>
              </select>
            </div>
          </div>

          {draft.entries.map((entry, index) => (
            <section key={entry.id || index} className="classes-entry-card">
              <h2 className="classes-entry-title">Class {index + 1}</h2>
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
                    {draft.cadence === CLASS_CADENCE.TWO_WEEK ? 'Times taught over 2 weeks' : 'Times taught per week'}
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

          <div className="classes-actions">
            <button type="submit" className="classes-save">
              Save classes
            </button>
          </div>
          {savedFlash ? <p className="classes-saved">Classes saved.</p> : null}
        </form>
      </div>
    </main>
  );
}
