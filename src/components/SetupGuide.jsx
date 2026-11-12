import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAcademicYear } from '../context/AcademicYearContext';
import { useClasses } from '../context/ClassContext';
import { useTimetableLayout } from '../context/TimetableLayoutContext';
import { useTimetableSessions } from '../context/TimetableSessionContext';
import { SETUP_STEPS, setupCompletion, setupGuideKey } from '../utils/setupProgress';
import { SETUP_GUIDANCE_CHANGED, setSetupGuidanceVisible, setupGuidancePreference } from '../utils/setupGuidance';
import { aiConnectionApi } from '../utils/aiConnectionApi';
import { morningSummaryApi } from '../utils/morningSummaryApi';
import { serverManagedAuth, captureServerOperationContext, assertServerOperationContext } from '../utils/serverAuthTransport';
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

export default function SetupGuide({ userId, stepId, children }) {
  const step = SETUP_STEPS.find(item => item.id === stepId);
  const key = setupGuideKey(userId, stepId);
  const [, refreshPreference] = useState(0);
  const [sessionTick, setSessionTick] = useState(0);
  const [optional, setOptional] = useState({ key: null, saved: 'loading' });
  const { completion, loading, unavailable, yearSelected } = useSetupCompletion();
  useEffect(() => {
    const changed = event => { if (!event.detail || event.detail.userId === userId) refreshPreference(value => value + 1); };
    const stored = event => { if (event.key === null || event.key?.startsWith(`plannix-setup-guide:${userId}:`))
      refreshPreference(value => value + 1); };
    window.addEventListener(SETUP_GUIDANCE_CHANGED, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(SETUP_GUIDANCE_CHANGED, changed); window.removeEventListener('storage', stored); };
  }, [userId, key]);
  useEffect(() => {
    if (!serverManagedAuth) return undefined;
    const changed = () => setSessionTick(value => value + 1);
    window.addEventListener('plannix-server-session-change', changed);
    window.addEventListener('plannix-server-session-mismatch', changed);
    return () => { window.removeEventListener('plannix-server-session-change', changed);
      window.removeEventListener('plannix-server-session-mismatch', changed); };
  }, []);
  useEffect(() => {
    if (!step?.optional || !userId) return undefined;
    let current = true;
    let context;
    try { context = serverManagedAuth ? captureServerOperationContext(userId) : null; }
    catch { setOptional({ key, saved: 'error' }); return () => { current = false; }; }
    const valid = () => {
      if (!current) return false;
      try { if (context) assertServerOperationContext(context); return true; } catch { return false; }
    };
    setOptional({ key, saved: 'loading' });
    const request = stepId === 'ai' ? aiConnectionApi.load() : morningSummaryApi.load(userId);
    request.then(value => { if (valid()) setOptional({ key, saved: stepId === 'ai'
      ? value?.active === true : value?.enabled === true }); })
      .catch(() => { if (valid()) setOptional({ key, saved: 'error' }); });
    return () => { current = false; };
  }, [userId, stepId, key, step?.optional, sessionTick]);
  const preference = setupGuidancePreference(userId, stepId);
  const completed = step?.optional ? optional.key === key && optional.saved === true : completion[stepId];
  const checkingOptional = Boolean(step?.optional && (optional.key !== key || optional.saved === 'loading'));
  const visible = preference === 'shown' || (!checkingOptional && !completed && preference === null);
  const reopen = preference === 'dismissed' || (!checkingOptional && !completed && preference === 'hidden');
  const changeVisibility = next => setSetupGuidanceVisible(userId, stepId, next);
  if (!step || (!visible && !reopen)) return children;
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
        {completed ? <p className="setup-guide-done">Saved. {stepId === 'year' && !yearSelected
          ? 'Select a saved year on this page before continuing to your school day.' : null}</p>
          : loading || unavailable ? <p>We’ll confirm this step after its saved settings load.</p> : null}
        {step.optional ? <p>After saving, return to your checklist.</p> : null}
        <footer className="setup-guide-footer" aria-label="Setup navigation">
          {completed && (stepId !== 'year' || yearSelected)
            ? <Link className="settings-save setup-guide-action setup-guide-action--primary" to={step.next}>Next steps</Link> : null}
          <Link className="settings-reset setup-guide-action setup-guide-action--secondary" to="/setup">Setup checklist</Link>
        </footer>
      </aside> : <button type="button" className="setup-guide-reopen" onClick={() => changeVisibility(true)}>
        Show setup guidance
      </button>}
    </div>
    {children}
  </>;
}
