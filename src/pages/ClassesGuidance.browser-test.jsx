import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { ClassProvider } from '../context/ClassContext.jsx';
import SetupGuide from '../components/SetupGuide.jsx';
import Classes from './Classes.jsx';
import { restoreSetupGuidance, setupGuidancePreference } from '../utils/setupGuidance.js';
import '../styles/base.css';

window.__storedClasses = [{ id:'ca000000-0000-4000-8000-000000000001', name:'Existing class', frequency:2 }];
window.__classRevision = 1;
window.__classSaveCalls = 0;

function Fixture() {
  const [userId] = useState('fixture-class-user');
  window.__restoreClassGuidance = () => restoreSetupGuidance(userId);
  return <MemoryRouter initialEntries={['/classes']}>
    <NavigationProbe />
    <ClassProvider user={{ id:userId, organisationId:'organisation-1' }}>
      <Routes>
        <Route path="/classes" element={<SetupGuide userId={userId} stepId="classes"><Classes /></SetupGuide>} />
        <Route path="/setup" element={<main><Link to="/classes">Return to classes</Link></main>} />
      </Routes>
    </ClassProvider>
  </MemoryRouter>;
}
function NavigationProbe() { window.__navigate = useNavigate(); return null; }
if (!setupGuidancePreference('fixture-class-user','classes')) restoreSetupGuidance('fixture-class-user');
createRoot(document.getElementById('root')).render(<Fixture />);
