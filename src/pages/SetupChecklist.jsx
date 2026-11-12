import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSetupCompletion } from '../components/SetupGuide';
import { SETUP_STEPS } from '../utils/setupProgress';
import { restoreSetupGuidance } from '../utils/setupGuidance';
import { aiConnectionApi } from '../utils/aiConnectionApi';
import { morningSummaryApi } from '../utils/morningSummaryApi';
import { serverManagedAuth, serverSessionGeneration, captureServerOperationContext,
  assertServerOperationContext } from '../utils/serverAuthTransport';
import './Settings.css';
import '../components/SetupGuide.css';

export default function SetupChecklist({ userId }) {
  const { completion, loading, unavailable, yearSelected } = useSetupCompletion();
  const [sessionTick, setSessionTick] = useState(0);
  const [guidanceRestored, setGuidanceRestored] = useState({ userId:null, restored:false });
  useEffect(() => {
    if (!serverManagedAuth) return undefined;
    const changed = () => setSessionTick(value => value + 1);
    window.addEventListener('plannix-server-session-change', changed);
    window.addEventListener('plannix-server-session-mismatch', changed);
    return () => {
      window.removeEventListener('plannix-server-session-change', changed);
      window.removeEventListener('plannix-server-session-mismatch', changed);
    };
  }, []);
  const sessionGeneration = serverManagedAuth ? serverSessionGeneration() : null;
  const optionalScope = `${userId || ''}:${sessionGeneration ?? 'bearer'}:${sessionTick}`;
  const [optional, setOptional] = useState({ scope: null, ai: 'loading', notifications: 'loading' });
  useEffect(() => {
    let current = true;
    setOptional({ scope: optionalScope, ai: 'loading', notifications: 'loading' });
    if (!userId) return () => { current = false; };
    let context;
    try { context = serverManagedAuth ? captureServerOperationContext(userId) : null; }
    catch { return () => { current = false; }; }
    const stillCurrent = () => {
      if (!current) return false;
      if (!context) return true;
      try { assertServerOperationContext(context); return true; } catch { return false; }
    };
    aiConnectionApi.load().then(result => {
      if (stillCurrent()) setOptional(value => value.scope === optionalScope ? { ...value, ai: result?.active === true } : value);
    }).catch(() => { if (stillCurrent()) setOptional(value => value.scope === optionalScope ? { ...value, ai: 'error' } : value); });
    morningSummaryApi.load(userId).then(result => {
      if (stillCurrent()) setOptional(value => value.scope === optionalScope ? { ...value, notifications: result?.enabled === true } : value);
    }).catch(() => { if (stillCurrent()) setOptional(value => value.scope === optionalScope ? { ...value, notifications: 'error' } : value); });
    return () => { current = false; };
  }, [userId, optionalScope]);
  const required = SETUP_STEPS.filter(step => !step.optional);
  const done = required.filter(step => completion[step.id]).length;
  const needsYearSelection = completion.year && !yearSelected;
  const firstRemaining = needsYearSelection ? required[0] : required.find(step => !completion[step.id]);
  return <main className="settings-page">
    <div className="container settings-inner settings-inner--wide">
      <p className="settings-breadcrumb"><Link to="/">Home</Link><span aria-hidden> / </span>Set up your planner</p>
      <h1 className="settings-title">Set up your planner</h1>
      <p className="settings-lead setup-checklist-lead">Work through these steps in order, or leave and come back whenever you like. We check your saved settings; opening a page does not complete a step.</p>
      <section className="setup-progress" aria-label="Planner setup progress">
        <p role="status">{loading && done < required.length ? 'Checking saved settings…' : `${done} of ${required.length} main steps complete`}</p>
        <progress aria-label="Main setup steps completed" max={required.length} value={done}>{done} of {required.length}</progress>
        {unavailable ? <p>Some settings could not be loaded. Progress may be incomplete; retry the affected page.</p> : null}
      </section>
      <ol className="setup-checklist">
        {SETUP_STEPS.map(step => {
          const status = step.optional ? optional.scope === optionalScope ? optional[step.id] : 'loading' : completion[step.id];
          return <li key={step.id} className="setup-checklist-item">
            <div>
              <h2>{step.title}</h2>
              <p>{step.explanation}</p>
              <span className="setup-step-status">{step.optional ? 'Optional · ' : ''}{status === true
                ? step.id === 'notifications' ? 'Preferences on · check this device'
                  : step.id === 'year' && !yearSelected ? 'Saved · select a year to continue' : 'Saved'
                : status === 'loading' || (loading && !step.optional) ? 'Checking'
                  : status === 'error' ? 'Could not confirm'
                  : unavailable && !step.optional ? 'Could not confirm' : 'To do'}</span>
            </div>
            <Link to={step.to}>{status === true ? 'Review' : 'Open step'}<span className="visually-hidden">: {step.title}</span></Link>
          </li>;
        })}
      </ol>
      {firstRemaining ? <p className="setup-checklist-next"><Link to={firstRemaining.to}>{needsYearSelection
        ? 'Select a saved academic year' : `Continue with ${firstRemaining.title.toLowerCase()}`}</Link></p>
        : <p className="setup-checklist-next">Your main planner setup is saved. Optional steps are there whenever you need them.</p>}
      <p><Link to="/timetable">Pause setup and view your timetable</Link></p>
      <section className="setup-progress" aria-label="Setup guidance">
        <h2>Need the instructions again?</h2>
        <p>Show the setup guidance on every setup page again. Your saved settings and checklist progress stay as they are. Each page’s guidance will hide after you save that page again.</p>
        <button type="button" className="settings-reset" onClick={() => setGuidanceRestored({ userId,
          restored:restoreSetupGuidance(userId) })}>
          Show setup guidance again
        </button>
        {guidanceRestored.userId === userId && guidanceRestored.restored
          ? <p role="status">Guidance is ready on each setup page.</p> : null}
        {guidanceRestored.userId === userId && !guidanceRestored.restored
          ? <p role="alert">This browser could not save your guidance preference. Instructions are visible now, but may not stay restored after a reload.</p> : null}
      </section>
      <p className="settings-hint">You can pause by leaving this page. Your saved work is here when you return; save any open form before navigating away. Notification delivery also needs an enabled device.</p>
    </div>
  </main>;
}
