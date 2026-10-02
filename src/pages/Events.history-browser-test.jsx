import React from 'react';
import { createRoot } from 'react-dom/client';
import { Link, RouterProvider } from 'react-router-dom';
import { createPlannixRouter } from '../appRouter.jsx';
import '../styles/base.css';
import '../styles/accessibility.css';
export { importSourceError } from '../utils/importPreviewApi.js';
export const aiConnectionApi = { load: async () => ({ active: true, providerLabel: 'OpenAI' }) };
export const extractImportPreview = async () => ({ destination: 'events', entries: [] });

const YEAR = '10000000-0000-4000-8000-000000000001';
const mockUser = { id: '20000000-0000-4000-8000-000000000001', organisationId: '30000000-0000-4000-8000-000000000001', name: 'Test user' };
let yearGuard = () => true;
let setYear;

export function createSupabaseAuthController() {
  return {
    subscribe: () => () => {}, restoreSession: () => new Promise(resolve => { window.releaseMockAuth = () => resolve(mockUser); }),
    logout: async () => {}, login: async () => mockUser, signup: async () => ({ authenticated: true, user: mockUser }),
  };
}
export function privateRouteState({ isAuthLoading, user }) {
  return isAuthLoading ? 'loading' : user ? 'private' : 'public';
}
export async function loadOrganisationMemberships() { return []; }

export function AcademicYearProvider({ children }) {
  const [year, updateYear] = React.useState(YEAR);
  setYear = updateYear;
  return <YearContext.Provider value={{ year }}>{children}</YearContext.Provider>;
}
const YearContext = React.createContext(null);
export function useAcademicYear() {
  const { year } = React.useContext(YearContext);
  return { selectedAcademicYearId: year,
    academicYear: { id: year, label: '2026/27', startDate: '2026-09-01', endDate: '2027-08-31' },
    isLoading: false, registerAcademicYearChangeGuard: guard => { yearGuard = guard; return () => { yearGuard = () => true; }; } };
}
export function TimetableLayoutProvider({ children }) { return children; }
export function ClassProvider({ children }) { return children; }
export function TimetableSessionProvider({ children }) { return children; }

export const eventApi = {
  async list() { return { events: [] }; },
  async create() { throw Error('Network disabled in history fixture'); },
  async update() { throw Error('Network disabled in history fixture'); },
  async remove() { throw Error('Network disabled in history fixture'); },
};

export default function Stub({ onLogout }) {
  if (onLogout) return <header><Link to="/settings/events">Events route</Link>{' '}
    <Link to="/settings">Settings route</Link>{' '}
    <Link to="/profile">Profile route</Link>{' '}
    <button type="button" onClick={onLogout}>Sign out</button>{' '}
    <button type="button" onClick={() => { if (yearGuard()) setYear(null); }}>Change year</button>
  </header>;
  return <div data-testid="stub">Public or other route</div>;
}

const router = createPlannixRouter();
window.historyFixtureRouter = router;
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
