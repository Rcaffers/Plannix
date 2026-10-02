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
const otherUser = { ...mockUser, id: '20000000-0000-4000-8000-000000000002', name: 'Second user' };
let currentAuthUser = mockUser;
let authCallbacks;
let yearGuard = () => true;
let setYear;

export function createSupabaseAuthController() {
  return {
    subscribe: callbacks => { authCallbacks = callbacks; return () => { authCallbacks = null; }; },
    restoreSession: () => new Promise(resolve => { window.releaseMockAuth = () => resolve(currentAuthUser); }),
    getCurrentSession: async () => currentAuthUser ? { user: { id: currentAuthUser.id } } : null,
    logout: async () => {
      const startedUserId = currentAuthUser?.id;
      window.authLogoutCalls = (window.authLogoutCalls || 0) + 1;
      if (window.deferAuthLogout) await new Promise(resolve => { window.releaseAuthLogout = resolve; });
      if (currentAuthUser?.id === startedUserId) currentAuthUser = null;
      authCallbacks?.onSignedOut?.();
    },
    login: async () => mockUser, signup: async () => ({ authenticated: true, user: mockUser }),
  };
}
window.switchMockAccount = () => {
  currentAuthUser = currentAuthUser?.id === otherUser.id ? mockUser : otherUser;
  window.newDeviceBrowserSubscribed = true;
  window.newDeviceServerRegistered = true;
  authCallbacks?.onUser?.(currentAuthUser);
};
window.emitOldSignedOut = () => { authCallbacks?.onSignedOut?.(); };
window.mockCurrentAuthUser = () => currentAuthUser?.id || null;
export function privateRouteState({ isAuthLoading, user }) {
  return isAuthLoading ? 'loading' : user ? 'private' : 'public';
}
export async function loadOrganisationMemberships() { return []; }
export function beginPushSignOut() {
  window.pushGateCalls = (window.pushGateCalls || 0) + 1;
  window.pushGateHeld = true;
  return { waitForRegistrations: async () => {}, release: () => { window.pushGateHeld = false; } };
}
export async function disableCurrentDevice({ isCurrent } = {}) {
  window.pushCleanupCalls = (window.pushCleanupCalls || 0) + 1;
  if (window.deferPushCleanup) await new Promise(resolve => { window.releasePushCleanup = resolve; });
  if (!isCurrent?.()) throw Error('Notification account changed.');
  if (window.failPushCleanup) throw Error('Synthetic cleanup failure');
  if (window.newDeviceBrowserSubscribed) window.newDeviceBrowserSubscribed = false;
  if (window.newDeviceServerRegistered) window.newDeviceServerRegistered = false;
  return { state: 'removed' };
}
export async function currentPushSubscription() {
  return window.newDeviceBrowserSubscribed ? { endpoint: 'https://example.test/new-device' } : null;
}
export async function reconcilePushAccount() { return false; }
export async function waitForPushAccountReconciliation() {}

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

export default function Stub({ onLogout, onLogoutAnyway, logoutError, logoutBusy, logoutCanSkipCleanup }) {
  if (onLogout) return <header><Link to="/settings/events">Events route</Link>{' '}
    <Link to="/settings">Settings route</Link>{' '}
    <Link to="/profile">Profile route</Link>{' '}
    <button type="button" onClick={onLogout} disabled={logoutBusy}>Sign out</button>{' '}
    {logoutError ? <div className="header-logout-error" role="alert">{logoutError}
      <button type="button" onClick={onLogout} disabled={logoutBusy}>Retry sign out</button>
      {logoutCanSkipCleanup ? <><span>Notifications may remain enabled on this device.</span>
        <button type="button" onClick={onLogoutAnyway} disabled={logoutBusy}>Sign out anyway</button></> : null}</div> : null}
    <button type="button" onClick={() => { if (yearGuard()) setYear(null); }}>Change year</button>
  </header>;
  return <div data-testid="stub">Public or other route</div>;
}

const router = createPlannixRouter();
window.historyFixtureRouter = router;
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
