import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import SetupChecklist from './SetupChecklist.jsx';
import SetupGuide from '../components/SetupGuide.jsx';
import { beginSetupGuidanceSave, finishSetupGuidanceSave } from '../utils/setupGuidance.js';
import '../styles/base.css';
import '../styles/accessibility.css';

function Harness() {
  const [account, setAccount] = useState('fixture-account');
  const [fixture, setFixture] = useState({
    year:{ selectedAcademicYearId:'year', academicYears:[{ id:'year' }], isLoading:false, error:'' },
    layout:{ isPersisted:true, loadedAcademicYearId:'year', isLoading:false, error:'' },
    classes:{ isLoaded:true, loadedAcademicYearId:'year', isLoading:false, error:'', authoritativeEntries:[] },
    timetable:{ recurringReady:true, recurringScopeKey:'fixture:year', loadedRecurringScopeKey:'fixture:year',
      recurring:[], isLoading:false, error:'', unsaved:false, isSaving:false },
  });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  window.__setupFixture = fixture;
  window.__setupAccount = account;
  window.__setSetupFixture = setFixture;
  window.__switchSetupAccount = setAccount;
  return <MemoryRouter initialEntries={['/setup']}>
    <Routes>
      <Route path="/setup" element={<SetupChecklist userId={account} />} />
      <Route path="/settings/academic-year" element={<SetupGuide userId={account} stepId="year"><main><h1>Academic year</h1></main></SetupGuide>} />
      <Route path="/profile" element={<SetupGuide userId={account} stepId="ai"><main><h1>Profile</h1><Link to="/setup">Checklist</Link></main></SetupGuide>} />
      <Route path="/settings/notifications" element={<SetupGuide userId={account} stepId="notifications"><main><h1>Notifications</h1><Link to="/setup">Checklist</Link></main></SetupGuide>} />
      <Route path="/classes" element={<SetupGuide userId={account} stepId="classes">
        <main><h1>Classes</h1><Link to="/setup">Checklist</Link><label htmlFor="fixture-class">Class name</label>
          <input id="fixture-class" value={draft} onChange={event => setDraft(event.target.value)} />
          <button onClick={() => setError('Save failed. Your class name is still here.')}>Fail save</button>
          <button onClick={async () => {
            const ticket = beginSetupGuidanceSave(account, 'classes');
            const savedDraft = draft;
            const savedAccount = account;
            const saved = await new Promise(resolve => { window.__finishClassSave = resolve; });
            if (!saved || savedAccount !== window.__setupAccount) { setError('Save failed.'); return; }
            setError(''); setFixture(value => ({ ...value,
              classes:{ ...value.classes, authoritativeEntries:[{ id:'class-a', name:savedDraft }] } }));
            finishSetupGuidanceSave(ticket);
          }}>Save classes</button>
          {error ? <p role="alert">{error}</p> : null}</main>
      </SetupGuide>} />
      <Route path="/classes/input" element={<SetupGuide userId={account} stepId="placements"><main><h1>Input classes</h1></main></SetupGuide>} />
    </Routes>
  </MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Harness />);
