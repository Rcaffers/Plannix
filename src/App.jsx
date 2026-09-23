import { useEffect, useState } from 'react';
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

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [memberships, setMemberships] = useState([]);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [membershipsError, setMembershipsError] = useState('');
  useEffect(() => {
    let isMounted = true;

    const cleanup = authController.subscribe({
      onUser: (nextUser) => { if (isMounted) { setUser(nextUser); setIsAuthLoading(false); } },
      onSignedOut: () => { if (isMounted) { setUser(null); setIsAuthLoading(false); } },
      onError: () => { if (isMounted) { setUser(null); setIsAuthLoading(false); } },
    });
    authController.restoreSession().then((nextUser) => {
      if (isMounted) setUser(nextUser);
    }).finally(() => {
      if (isMounted) setIsAuthLoading(false);
    });
    return () => {
      isMounted = false;
      cleanup();
    };
  }, []);

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
    setUser(loggedInUser);
    navigate('/timetable');
    return loggedInUser;
  };

  const handleLogout = async () => {
    if (window.__plannixConfirmSessionDiscard?.() === false) return;
    if (window.__plannixConfirmClassDiscard?.() === false) return;
    if (window.__plannixConfirmLayoutDiscard?.() === false) return;
    try {
      await authController.logout();
    } catch {
      // Local access is cleared even when the remote sign-out request fails.
    } finally {
      setUser(null);
    }
  };

  const clearAuthenticatedUser = () => {
    setUser(null);
  };

  const privateRoute = (element) => {
    const state = privateRouteState({ isAuthLoading, user });
    if (state === 'loading') {
      return <main aria-busy="true"><p role="status">Checking your session…</p></main>;
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
                      <ProjectGrid projectCardProps={{ enableEditing: false, weekMode: 'date' }} />
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
            <Route path="/settings/academic-year" element={privateRoute(<AcademicYear />)} />
            <Route path="/classes" element={privateRoute(<Classes />)} />
            <Route path="/classes/input" element={privateRoute(<Classes />)} />
            <Route
              path="/timetable"
              element={privateRoute(<Timetable />)}
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
