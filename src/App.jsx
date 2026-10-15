import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import './App.css';
import Header from './components/Header';
import Hero from './components/Hero';
import HomeHighlights from './components/HomeHighlights';
import ProjectGrid from './components/ProjectGrid';
import CTASection from './components/CTASection';
import Footer from './components/Footer';
import CookieConsent from './modals/CookieConsent';
import AnalyticsTracker from './components/AnalyticsTracker';
import Features from './pages/Features';
import Contact from './pages/Contact';
import ResetPassword from './pages/ResetPassword';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import ProfileSessionGate from './components/ProfileSessionGate';
import OrganisationControls from './pages/OrganisationControls';
import AcademicYear from './pages/AcademicYear';
import Events from './pages/Events';
import Notifications from './pages/Notifications';
import { beginPushSignOut, disableCurrentDevice, reconcilePushAccount } from './utils/pushNotifications';
import Reports from './pages/Reports';
import Classes from './pages/Classes';
import Timetable from './pages/Timetable';
import TermsGate from './pages/TermsGate';
import PrivacyGate from './pages/PrivacyGate';
import TermsModal from './modals/TermsModal';
import PrivacyModal from './modals/PrivacyModal';
import ScrollToTop from './components/ScrollToTop';
import { createSupabaseAuthController, privateRouteState } from './utils/supabaseAuthController';
import { createServerAuthController } from './utils/serverAuthController';
import { serverManagedAuth, captureServerOperationContext,
  assertServerOperationContext } from './utils/serverAuthTransport';
import { TimetableLayoutProvider } from './context/TimetableLayoutContext';
import { AcademicYearProvider } from './context/AcademicYearContext';
import { ClassProvider } from './context/ClassContext';
import { TimetableSessionProvider } from './context/TimetableSessionContext';
import { loadOrganisationMemberships } from './utils/organisationMemberships';

const authController = serverManagedAuth ? createServerAuthController() : createSupabaseAuthController();
const PUSH_CLEANUP_DEADLINE_MS = 8000;

function beforeDeadline(work, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new Error('Notification cleanup timed out.'));
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Notification cleanup timed out.')), remaining); }),
  ]).finally(() => clearTimeout(timer));
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [sessionVerificationError, setSessionVerificationError] = useState(false);
  const [verifiedProfileKey, setVerifiedProfileKey] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [membershipsError, setMembershipsError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [logoutCanSkipCleanup, setLogoutCanSkipCleanup] = useState(false);
  const logoutBusyRef = useRef(false);
  const logoutFailedAccountRef = useRef(null);
  const logoutFailedContextRef = useRef(null);
  const userIdRef = useRef(null);
  const profileVisit = useRef({ path: null, index: 0 });
  useLayoutEffect(() => {
    if (serverManagedAuth && !isAuthLoading && user?.id) {
      authController.activateDisplayedSession(user.id);
    }
  }, [isAuthLoading,user]);
  if (profileVisit.current.path !== location.pathname) {
    profileVisit.current = { path: location.pathname, index: profileVisit.current.index + 1 };
  }
  useEffect(() => {
    let isMounted = true;

    const cleanup = authController.subscribe({
      onPending: () => { if (isMounted) { userIdRef.current = null; setUser(null);
        setVerifiedProfileKey(null); setIsAuthLoading(true); } },
      onUser: (nextUser) => { if (isMounted) { if (userIdRef.current !== nextUser?.id) { logoutFailedAccountRef.current = null; logoutFailedContextRef.current = null; setLogoutError(''); setLogoutCanSkipCleanup(false); } userIdRef.current = nextUser?.id || null; setUser(nextUser); setSessionVerificationError(false); setIsAuthLoading(false); } },
      onSignedOut: () => { if (isMounted) { logoutFailedAccountRef.current = null; logoutFailedContextRef.current = null; setLogoutCanSkipCleanup(false); userIdRef.current = null; setUser(null); setSessionVerificationError(false); setIsAuthLoading(false); } },
      onError: () => { if (isMounted) { userIdRef.current = null; setUser(null); setSessionVerificationError(true); setIsAuthLoading(false); } },
    });
    authController.restoreSession().then((result) => {
      if (!isMounted) return;
      if (serverManagedAuth) {
        if (result.state === 'stale') return;
        if (result.state === 'verification-failure') {
          if (!userIdRef.current) { setUser(null); setSessionVerificationError(true); }
          return;
        }
        const nextUser = result.state === 'authenticated' ? result.user : null;
        userIdRef.current = nextUser?.id || null;
        setUser(nextUser);
        return;
      }
      userIdRef.current = result?.id || null;
      setUser(result);
    }).finally(() => {
      if (isMounted) setIsAuthLoading(false);
    });
    return () => {
      isMounted = false;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;
    if (user?.id) void reconcilePushAccount().catch(() => {});
  }, [isAuthLoading, user?.id]);

  useEffect(() => {
    let active = true;
    if (isAuthLoading || !user?.id) {
      setMemberships([]);
      setMembershipsLoading(false);
      setMembershipsError('');
      return () => { active = false; };
    }

    setMembershipsLoading(true);
    setMembershipsError('');
    loadOrganisationMemberships({ userId: user.id }).then(
      (nextMemberships) => {
        if (!active) return;
        setMemberships(nextMemberships);
        setMembershipsLoading(false);
      },
      () => {
        if (!active) return;
        setMemberships([]);
        setMembershipsError('We could not load your organisation memberships. Please refresh and try again.');
        setMembershipsLoading(false);
      },
    );

    return () => { active = false; };
  }, [isAuthLoading, user?.id]);

  const handleLogin = async ({ email, password }) => {
    const loggedInUser = await authController.login({ email, password });
    if (serverManagedAuth && !authController.isCurrentUser(loggedInUser))
      throw new DOMException('Account changed.', 'AbortError');
    setLogoutError('');
    setLogoutCanSkipCleanup(false);
    logoutFailedAccountRef.current = null;
    userIdRef.current = loggedInUser?.id || null;
    setUser(loggedInUser);
    navigate('/timetable');
    return loggedInUser;
  };

  const confirmDraftDiscard = () => {
    if (window.__plannixConfirmSessionDiscard?.() === false) return;
    if (window.__plannixConfirmClassDiscard?.() === false) return;
    if (window.__plannixConfirmLayoutDiscard?.() === false) return;
    if (window.__plannixConfirmEventDiscard?.() === false) return;
    if (window.__plannixConfirmAcademicYearDiscard?.() === false) return;
    if (window.__plannixConfirmImportPreviewDiscard?.() === false) return;
    return true;
  };

  const handleLogout = async () => {
    if (logoutBusyRef.current || confirmDraftDiscard() !== true) return;
    const accountId = user?.id;
    if (!accountId) return;
    let operationContext;
    try { operationContext = serverManagedAuth
      ? captureServerOperationContext(accountId) : null; }
    catch { setLogoutError('Your account changed. Reload your session before signing out.'); return; }
    const stillCurrent = () => {
      if (userIdRef.current !== accountId) return false;
      try { if (operationContext) assertServerOperationContext(operationContext); return true; }
      catch { return false; }
    };
    logoutBusyRef.current = true;
    const deadline = Date.now() + PUSH_CLEANUP_DEADLINE_MS;
    setLogoutBusy(true);
    setLogoutError('');
    setLogoutCanSkipCleanup(false);
    logoutFailedAccountRef.current = null;
    logoutFailedContextRef.current = null;
    let gate;
    try {
      gate = beginPushSignOut();
      await beforeDeadline(() => gate.waitForRegistrations(Math.max(1, deadline - Date.now())), deadline);
      await beforeDeadline(() => disableCurrentDevice({ expectedUserId: accountId,
        operationContext, isCurrent: stillCurrent }), deadline);
    } catch {
      if (stillCurrent()) {
        setLogoutError('Notification cleanup could not be confirmed.');
        setLogoutCanSkipCleanup(true);
        logoutFailedAccountRef.current = accountId;
        logoutFailedContextRef.current = operationContext;
      } else {
        setLogoutError('Your account changed during notification cleanup. Sign out again from the current account.');
        setLogoutCanSkipCleanup(false);
        logoutFailedAccountRef.current = null;
        logoutFailedContextRef.current = null;
      }
      gate?.release();
      logoutBusyRef.current = false;
      setLogoutBusy(false);
      return;
    }
    if (!stillCurrent()) {
      setLogoutError('Your account changed during notification cleanup. Sign out again from the current account.');
      setLogoutCanSkipCleanup(false);
      logoutFailedAccountRef.current = null;
      logoutFailedContextRef.current = null;
      gate?.release();
      logoutBusyRef.current = false;
      setLogoutBusy(false);
      return;
    }
    let cleared = true;
    try { cleared = await authController.logout({ expectedUserId: accountId,
      operationContext }); }
    catch {
      if (serverManagedAuth) {
        setLogoutError('Sign out could not be confirmed. Please retry.');
        gate?.release(); logoutBusyRef.current = false; setLogoutBusy(false);
        return;
      }
      /* Committed browser-SDK baseline clears local access on failure. */
    }
    gate?.release();
    if (serverManagedAuth && cleared === false) {
      logoutBusyRef.current = false; setLogoutBusy(false);
      return;
    }
    logoutFailedAccountRef.current = null; logoutFailedContextRef.current = null;
    setLogoutCanSkipCleanup(false);
    userIdRef.current = null; setUser(null); logoutBusyRef.current = false; setLogoutBusy(false);
  };

  const handleLogoutAnyway = async () => {
    if (logoutBusyRef.current || !logoutCanSkipCleanup || logoutFailedAccountRef.current !== user?.id) return;
    if (confirmDraftDiscard() !== true) return;
    if (window.confirm('Notification cleanup could not be confirmed. Notifications may remain enabled on this device. Sign out anyway?') !== true) return;
    if (logoutFailedAccountRef.current !== userIdRef.current) return;
    const operationContext=logoutFailedContextRef.current;
    try { if (operationContext) assertServerOperationContext(operationContext); }
    catch { setLogoutError('Your account changed. Reload your session before signing out.');
      setLogoutCanSkipCleanup(false); return; }
    logoutBusyRef.current = true;
    setLogoutBusy(true);
    let cleared = true;
    try { cleared = await authController.logout({ expectedUserId: logoutFailedAccountRef.current,
      operationContext }); }
    catch {
      if (serverManagedAuth) {
        setLogoutError('Sign out could not be confirmed. Please retry.');
        logoutBusyRef.current = false; setLogoutBusy(false);
        return;
      }
      /* Preserve committed browser-SDK sign-out behaviour. */
    }
    if (serverManagedAuth && cleared === false) {
      logoutBusyRef.current = false; setLogoutBusy(false);
      return;
    }
    logoutFailedAccountRef.current = null; logoutFailedContextRef.current = null;
    setLogoutCanSkipCleanup(false);
    userIdRef.current = null; setUser(null); logoutBusyRef.current = false; setLogoutBusy(false);
  };

  const clearAuthenticatedUser = () => {
    userIdRef.current = null;
    setUser(null);
  };

  const handleProfileNameUpdate = async (details) => {
    const updatedUser = await authController.updateProfileName(details);
    if (userIdRef.current === updatedUser.id) setUser(updatedUser);
    return updatedUser;
  };

  const handleEmailUpdate = async (email) => {
    const result = await authController.updateEmail(email);
    if (serverManagedAuth && result.user && !authController.isCurrentUser(result.user))
      throw new DOMException('Account changed.', 'AbortError');
    if (userIdRef.current === result.user?.id
      && (!serverManagedAuth || authController.isCurrentUser(result.user))) setUser(result.user);
    return result;
  };

  const privateRoute = (element) => {
    if (serverManagedAuth && sessionVerificationError) {
      return <main role="alert">
        <p>Your current session could not be confirmed. Retry the session check.</p>
        <button type="button" onClick={() => {
          setSessionVerificationError(false);
          setIsAuthLoading(true);
          window.dispatchEvent(new Event('plannix-server-session-change'));
        }}>Retry session check</button>
      </main>;
    }
    const state = privateRouteState({ isAuthLoading, user });
    if (state === 'loading') {
      return <main aria-busy="true"><p role="status" className="visually-hidden">Checking your session…</p></main>;
    }
    if (state === 'public') {
      return (
        <main>
          <Hero user={null} />
          <HomeHighlights />
          <CTASection user={null} />
        </main>
      );
    }
    return element;
  };

  const handleSignup = async (details) => {
    const result = await authController.signup(details);
    if (serverManagedAuth && result.authenticated && !authController.isCurrentUser(result.user))
      throw new DOMException('Account changed.', 'AbortError');
    if (result.authenticated && (!serverManagedAuth || authController.isCurrentUser(result.user)))
      setUser(result.user);
    return result;
  };

  const profileKey = serverManagedAuth && location.pathname === '/profile' && user
    ? `${profileVisit.current.index}:${user.id}:${authController.currentSessionName() || 'unverified'}` : null;
  const profilePending = !!profileKey && verifiedProfileKey !== profileKey;
  const handleProfileVerification = (result) => {
    if (result.state === 'authenticated') {
      if (!authController.isCurrentUser(result.user)) return false;
      userIdRef.current = result.user.id;
      setUser(result.user);
      setVerifiedProfileKey(`${profileVisit.current.index}:${result.user.id}:${authController.currentSessionName()}`);
      return true;
    } else if (result.state === 'signed-out' && authController.isSignedOut()) {
      userIdRef.current = null;
      setUser(null);
      setVerifiedProfileKey(null);
      return true;
    }
    return false;
  };
  const profilePage = <Profile
    user={user}
    memberships={memberships}
    membershipsLoading={membershipsLoading}
    membershipsError={membershipsError}
    updateProfileName={handleProfileNameUpdate}
    updateEmail={handleEmailUpdate}
    updatePassword={(details) => authController.updatePassword(details)}
    clearAuthenticatedUser={clearAuthenticatedUser}
    getAccountDeletionSession={(options) => authController.getCurrentSession(options)}
    signOutAfterAccountDeletion={(name) => authController.clearAfterAccountDeletion(name)}
    isAccountDeletionSessionCurrent={(name, id, generation) => !serverManagedAuth
      || authController.isCurrentSessionVersion(name, id, generation)}
  />;

  return (
    <AcademicYearProvider key={`${user?.id || 'signed-out'}:${user?.organisationId || 'none'}`} user={user}>
      <TimetableLayoutProvider user={user}>
        <ClassProvider user={user}>
          <TimetableSessionProvider user={user}>
          <div className="page-shell">
          <ScrollToTop />
          <AnalyticsTracker user={user} isAuthLoading={isAuthLoading} />
          <Header
            user={profilePending ? null : user}
            memberships={memberships}
            isAuthLoading={isAuthLoading || profilePending}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onLogoutAnyway={handleLogoutAnyway}
            logoutBusy={logoutBusy}
            logoutError={logoutError}
            logoutCanSkipCleanup={logoutCanSkipCleanup}
            onSignup={handleSignup}
          />
          <Routes>
            <Route
              path="/"
              element={
                <main>
                  <Hero user={user} />
                  {user ? (
                    <section className="section content-section" id="work">
                      <ProjectGrid projectCardProps={{ enableEditing: false, weekMode: 'date', weekendEventsUserId: user.id }} />
                    </section>
                  ) : (
                    <HomeHighlights />
                  )}
                  <CTASection user={user} />
                </main>
              }
            />
            <Route path="/features" element={<Features user={user} />} />
            <Route path="/contact" element={<Contact user={user} />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/terms" element={<TermsGate />} />
            <Route path="/privacy" element={<PrivacyGate />} />
            <Route
              path="/settings"
              element={privateRoute(<Settings />)}
            />
            <Route
              path="/profile"
              element={privateRoute(serverManagedAuth ? <ProfileSessionGate
                key={profileKey} verify={(options) => authController.verifyProfileEntry(options)}
                onVerified={handleProfileVerification}>
                {profilePage}
              </ProfileSessionGate> : profilePage)}
            />
            <Route
              path="/organisation-controls"
              element={privateRoute(
                <OrganisationControls
                  memberships={memberships}
                  membershipsLoading={membershipsLoading}
                  membershipsError={membershipsError}
                />,
              )}
            />
            <Route path="/settings/academic-year" element={privateRoute(<AcademicYear userId={user?.id} />)} />
            <Route path="/settings/events" element={privateRoute(<Events userId={user?.id} />)} />
            <Route path="/settings/notifications" element={privateRoute(<Notifications userId={user?.id} organisationId={user?.organisationId} />)} />
            <Route path="/reports" element={privateRoute(<Reports user={user} />)} />
            <Route path="/classes" element={privateRoute(<Classes />)} />
            <Route path="/classes/input" element={privateRoute(<Classes />)} />
            <Route
              path="/timetable"
              element={privateRoute(<Timetable userId={user?.id} />)}
            />
          </Routes>
          <Footer user={profilePending ? null : user} />
          <TermsModal />
          <PrivacyModal />
          <CookieConsent />
          </div>
          </TimetableSessionProvider>
        </ClassProvider>
      </TimetableLayoutProvider>
    </AcademicYearProvider>
  );
}
