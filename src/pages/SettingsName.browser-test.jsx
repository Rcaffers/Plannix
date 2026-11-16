import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { TimetableLayoutProvider } from '../context/TimetableLayoutContext.jsx';
import Settings from './Settings.jsx';
import { restoreSetupGuidance, setupGuidancePreference } from '../utils/setupGuidance.js';
import { selectMockAcademicYear } from './SettingsName.browser-mocks.js';
import '../styles/base.css';

window.__storedLayout = null;
window.__layoutSaveCalls = 0;
window.__layoutFetchCalls = 0;
window.__layoutSaveFailure = false;
window.__holdLayoutSave = false;
window.__holdYearTwoFetch = false;
window.__restoreLayoutGuidance = () => restoreSetupGuidance('user-1');
window.__layoutGuidancePreference = () => setupGuidancePreference('user-1','layout');

function Fixture() {
  const [, rerender] = useState(0);
  window.__selectMockAcademicYear = id => { selectMockAcademicYear(id); rerender(value => value + 1); };
  return (
    <MemoryRouter initialEntries={['/settings']}>
      <TimetableLayoutProvider user={{ id: 'user-1', organisationId: 'organisation-1' }}>
        <Settings userId="user-1" />
      </TimetableLayoutProvider>
    </MemoryRouter>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
