import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAcademicYear } from '../context/AcademicYearContext';
import { useClasses } from '../context/ClassContext';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { useTimetableSessions } from '../context/TimetableSessionContext';
import { SETUP_STEPS, setupCompletion, setupGuideKey } from '../utils/setupProgress';
import './SetupGuide.css';

export function useSetupCompletion() {
  const year = useAcademicYear();
  const layout = useTimetableLayout();
  const classes = useClasses();
  const timetable = useTimetableSessions();
  const completion = setupCompletion({
    yearSaved: year.academicYears.length > 0 && !year.isLoading,
    yearSelected: year.selectedAcademicYearId && year.academicYears.some(item => item.id === year.selectedAcademicYearId)
      && !year.isLoading,
    layoutSaved: layout.isPersisted && layout.loadedAcademicYearId === year.selectedAcademicYearId
      && !layout.isLoading,
    classesLoaded: classes.isLoaded && classes.loadedAcademicYearId === year.selectedAcademicYearId
      && !classes.isLoading,
    savedClasses: classes.authoritativeEntries,
    recurringReady: timetable.recurringReady && timetable.loadedRecurringScopeKey === timetable.recurringScopeKey,
    recurring: timetable.recurring,
    timetableUnsaved: timetable.unsaved || timetable.isSaving,
  });
  const loading = year.isLoading || layout.isLoading || classes.isLoading || timetable.isLoading;
  const unavailable = Boolean(year.error || layout.error || classes.error || timetable.error);
  return { completion, loading, unavailable,
    yearSelected: Boolean(year.selectedAcademicYearId && year.academicYears.some(item => item.id === year.selectedAcademicYearId)) };
}

function initiallyVisible(key) {
  try { return localStorage.getItem(key) !== 'hidden'; } catch { return true; }
}

export default function SetupGuide({ userId, stepId, children }) {
  const step = SETUP_STEPS.find(item => item.id === stepId);
  const key = setupGuideKey(userId, stepId);
  const [visibility, setVisibility] = useState(() => ({ key, visible: initiallyVisible(key) }));
  const visible = visibility.key === key ? visibility.visible : initiallyVisible(key);
  const { completion, loading, unavailable, yearSelected } = useSetupCompletion();
  function changeVisibility(next) {
    setVisibility({ key, visible: next });
    try { if (next) localStorage.removeItem(key); else localStorage.setItem(key, 'hidden'); } catch { /* preference only */ }
  }
  if (!step) return children;
  return <>
    <div className="container settings-inner settings-inner--wide setup-guide-wrap">
      {visible ? <aside className="setup-guide" aria-label="Setup guidance">
        <div className="setup-guide-heading">
          <p className="setup-guide-title">{step.title}{step.optional ? ' · Optional' : ''}</p>
          <button type="button" onClick={() => changeVisibility(false)}>Hide guidance</button>
        </div>
        <p>{step.explanation}</p>
        {step.example ? <p>{step.example}</p> : null}
        <p>{step.save}</p>
        {completion[stepId] ? <p className="setup-guide-done">Saved. {stepId === 'year' && !yearSelected
          ? 'Select a saved year on this page before continuing to your school day.'
          : <Link to={step.next}>Go to the next step</Link>}</p>
          : loading || unavailable ? <p>We’ll confirm this step after its saved settings load.</p> : null}
        {step.optional ? <p>After saving, <Link to={step.next}>return to your checklist</Link>.</p> : null}
        <Link to="/setup">View your setup checklist</Link>
      </aside> : <button type="button" className="setup-guide-reopen" onClick={() => changeVisibility(true)}>
        Show setup guidance
      </button>}
    </div>
    {children}
  </>;
}
