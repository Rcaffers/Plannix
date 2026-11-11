import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SetupChecklist from './SetupChecklist.jsx';
import SetupGuide from '../components/SetupGuide.jsx';
import '../styles/base.css';
import '../styles/accessibility.css';

const account = 'fixture-account';
function Harness() {
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
  window.__setSetupFixture = setFixture;
  return <MemoryRouter initialEntries={['/setup']}>
    <Routes>
      <Route path="/setup" element={<SetupChecklist userId={account} />} />
      <Route path="/classes" element={<SetupGuide userId={account} stepId="classes">
        <main><h1>Classes</h1><label htmlFor="fixture-class">Class name</label>
          <input id="fixture-class" value={draft} onChange={event => setDraft(event.target.value)} />
          <button onClick={() => setError('Save failed. Your class name is still here.')}>Fail save</button>
          <button onClick={() => { setError(''); setFixture(value => ({ ...value,
            classes:{ ...value.classes, authoritativeEntries:[{ id:'class-a', name:draft }] } })); }}>Save classes</button>
          {error ? <p role="alert">{error}</p> : null}</main>
      </SetupGuide>} />
      <Route path="/classes/input" element={<SetupGuide userId={account} stepId="placements"><main><h1>Input classes</h1></main></SetupGuide>} />
    </Routes>
  </MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Harness />);
