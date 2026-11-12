import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { TimetableLayoutProvider } from '../context/TimetableLayoutContext.jsx';
import Settings from './Settings.jsx';
import '../styles/base.css';

window.__storedLayout = null;
window.__layoutSaveCalls = 0;
window.__layoutFetchCalls = 0;

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/settings']}>
    <TimetableLayoutProvider user={{ id: 'user-1', organisationId: 'organisation-1' }}>
      <Settings />
    </TimetableLayoutProvider>
  </MemoryRouter>,
);
