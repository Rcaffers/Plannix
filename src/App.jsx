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
import AcademicYear from './pages/AcademicYear';
import Classes from './pages/Classes';
import Timetable from './pages/Timetable';
import TermsGate from './pages/TermsGate';
import PrivacyGate from './pages/PrivacyGate';
import TermsModal from './modals/TermsModal';
import PrivacyModal from './modals/PrivacyModal';
import ScrollToTop from './components/ScrollToTop';
import { fetchAuthMe, loginWithCredentials, logoutSession, signupAccount } from './utils/api';
import { TimetableLayoutProvider } from './context/TimetableLayoutContext';
import { AcademicYearProvider } from './context/AcademicYearContext';

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      try {
        const { ok, user: nextUser } = await fetchAuthMe();
        if (!isMounted) {
          return;
        }
        if (!ok) {
          setUser(null);
          return;
        }
        setUser(nextUser);
      } catch {
        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsAuthLoading(false);
        }
      }
    };

    loadSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = async ({ email, password }) => {
    const loggedInUser = await loginWithCredentials({ email, password });
    setUser(loggedInUser);
    navigate('/timetable');
    return loggedInUser;
  };

  const handleLogout = async () => {
    try {
      await logoutSession();
    } finally {
      setUser(null);
    }
  };

  const privateRoute = (element) => {
    if (!user) {
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

  const handleSignup = async ({ name, email, password }) => {
    const result = await signupAccount({ name, email, password });
    const { user: createdUser } = result;
    setUser(createdUser);
    return createdUser;
  };

  return (
    <TimetableLayoutProvider user={user}>
      <AcademicYearProvider user={user}>
        <div className="page-shell">
          <ScrollToTop />
          <Header
            user={user}
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
            <Route path="/settings" element={privateRoute(<Settings />)} />
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
      </AcademicYearProvider>
    </TimetableLayoutProvider>
  );
}
