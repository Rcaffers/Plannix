import { useEffect, useRef, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import './App.css';
import Header from './components/Header';
import Hero from './components/Hero';
import HomeHighlights from './components/HomeHighlights';
import ProjectGrid from './components/ProjectGrid';
import CTASection from './components/CTASection';
import Footer from './components/Footer';
import CookieConsent from './modals/CookieConsent';
import Features from './pages/Features';
import Contact from './pages/Contact';
import ResetPassword from './pages/ResetPassword';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
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
import { TimetableLayoutProvider } from './context/TimetableLayoutContext';
import { AcademicYearProvider } from './context/AcademicYearContext';
import { ClassProvider } from './context/ClassContext';
import { TimetableSessionProvider } from './context/TimetableSessionContext';
import { loadOrganisationMemberships } from './utils/organisationMemberships';

const authController = createSupabaseAuthController();
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
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [memberships, setMemberships] = useState([]);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [membershipsError, setMembershipsError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [logoutCanSkipCleanup, setLogoutCanSkipCleanup] = useState(false);
  const logoutBusyRef = useRef(false);
  const logoutFailedAccountRef = useRef(null);
  const userIdRef = useRef(null);
  useEffect(() => {
    let isMounted = true;

    const cleanup = authController.subscribe({
      onUser: (nextUser) => { if (isMounted) { if (userIdRef.current !== nextUser?.id) { logoutFailedAccountRef.current = null; setLogoutError(''); setLogoutCanSkipCleanup(false); } userIdRef.current = nextUser?.id || null; setUser(nextUser); setIsAuthLoading(false); } },
      onSignedOut: () => { if (isMounted) { logoutFailedAccountRef.current = null; setLogoutCanSkipCleanup(false); userIdRef.current = null; setUser(null); setIsAuthLoading(false); } },
      onError: () => { if (isMounted) { userIdRef.current = null; setUser(null); setIsAuthLoading(false); } },
    });
    authController.restoreSession().then((nextUser) => {
      if (isMounted) { userIdRef.current = nextUser?.id || null; setUser(nextUser); }
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
    if (!user?.id) {
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
  }, [user?.id]);

  const handleLogin = async ({ email, password }) => {
    const loggedInUser = await authController.login({ email, password });
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
    logoutBusyRef.current = true;
    const deadline = Date.now() + PUSH_CLEANUP_DEADLINE_MS;
    setLogoutBusy(true);
    setLogoutError('');
    setLogoutCanSkipCleanup(false);
    logoutFailedAccountRef.current = null;
    let gate;
    try {
      gate = beginPushSignOut();
      await beforeDeadline(() => gate.waitForRegistrations(Math.max(1, deadline - Date.now())), deadline);
      await beforeDeadline(() => disableCurrentDevice({ expectedUserId: accountId,
        isCurrent: () => userIdRef.current === accountId }), deadline);
    } catch {
      if (userIdRef.current === accountId) {
        setLogoutError('Notification cleanup could not be confirmed.');
        setLogoutCanSkipCleanup(true);
        logoutFailedAccountRef.current = accountId;
      } else {
        setLogoutError('Your account changed during notification cleanup. Sign out again from the current account.');
        setLogoutCanSkipCleanup(false);
        logoutFailedAccountRef.current = null;
      }
      gate?.release();
      logoutBusyRef.current = false;
      setLogoutBusy(false);
      return;
    }
    if (userIdRef.current !== accountId) {
      setLogoutError('Your account changed during notification cleanup. Sign out again from the current account.');
      setLogoutCanSkipCleanup(false);
      logoutFailedAccountRef.current = null;
      gate?.release();
      logoutBusyRef.current = false;
      setLogoutBusy(false);
      return;
    }
    try { await authController.logout(); }
    catch { /* Committed baseline clears local access even when remote logout fails. */ }
    finally { gate?.release(); logoutFailedAccountRef.current = null; setLogoutCanSkipCleanup(false); userIdRef.current = null; setUser(null); logoutBusyRef.current = false; setLogoutBusy(false); }
  };

  const handleLogoutAnyway = async () => {
    if (logoutBusyRef.current || !logoutCanSkipCleanup || logoutFailedAccountRef.current !== user?.id) return;
    if (confirmDraftDiscard() !== true) return;
    if (window.confirm('Notification cleanup could not be confirmed. Notifications may remain enabled on this device. Sign out anyway?') !== true) return;
    if (logoutFailedAccountRef.current !== userIdRef.current) return;
    logoutBusyRef.current = true;
    setLogoutBusy(true);
    try { await authController.logout(); }
    catch { /* Preserve committed local sign-out behaviour. */ }
    finally { logoutFailedAccountRef.current = null; setLogoutCanSkipCleanup(false); userIdRef.current = null; setUser(null); logoutBusyRef.current = false; setLogoutBusy(false); }
  };

  const clearAuthenticatedUser = () => {
    userIdRef.current = null;
    setUser(null);
  };

  const handleProfileNameUpdate = async (details) => {
    const updatedUser = await authController.updateProfileName(details);
    setUser(updatedUser);
    return updatedUser;
  };

  const handleEmailUpdate = async (email) => {
    const result = await authController.updateEmail(email);
    setUser(result.user);
    return result;
  };

  const privateRoute = (element) => {
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
    if (result.authenticated) setUser(result.user);
    return result;
  };

  return (
    <AcademicYearProvider key={`${user?.id || 'signed-out'}:${user?.organisationId || 'none'}`} user={user}>
      <TimetableLayoutProvider user={user}>
        <ClassProvider user={user}>
          <TimetableSessionProvider user={user}>
          <div className="page-shell">
          <ScrollToTop />
          <Header
            user={user}
            memberships={memberships}
            isAuthLoading={isAuthLoading}
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
              element={privateRoute(
                <Profile
                  user={user}
                  memberships={memberships}
                  membershipsLoading={membershipsLoading}
                  membershipsError={membershipsError}
                  updateProfileName={handleProfileNameUpdate}
                  updateEmail={handleEmailUpdate}
                  updatePassword={(details) => authController.updatePassword(details)}
                  clearAuthenticatedUser={clearAuthenticatedUser}
                  getAccountDeletionSession={() => authController.getCurrentSession()}
                  signOutAfterAccountDeletion={() => authController.clearAfterAccountDeletion()}
                />,
              )}
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
            <Route path="/settings/notifications" element={privateRoute(<Notifications userId={user?.id} />)} />
            <Route path="/reports" element={privateRoute(<Reports user={user} />)} />
            <Route path="/classes" element={privateRoute(<Classes />)} />
            <Route path="/classes/input" element={privateRoute(<Classes />)} />
            <Route
              path="/timetable"
              element={privateRoute(<Timetable userId={user?.id} />)}
            />
          </Routes>
          <Footer user={user} />
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
