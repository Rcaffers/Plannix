import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
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
import Settings from './pages/Settings';
import AcademicYear from './pages/AcademicYear';
import Classes from './pages/Classes';
import Timetable from './pages/Timetable';
import Subscription from './pages/Subscription';
import SubscriptionGate from './pages/SubscriptionGate';
import TermsGate from './pages/TermsGate';
import PrivacyGate from './pages/PrivacyGate';
import TermsModal from './modals/TermsModal';
import PrivacyModal from './modals/PrivacyModal';
import ScrollToTop from './components/ScrollToTop';
import {
  completePaidSignupSubscription,
  completePaidSignupSession,
  fetchAuthConfig,
  fetchAuthMe,
  fetchSubscriptionSummary,
  loginWithCredentials,
  logoutSession,
  signupAccount,
} from './utils/api';
import { TimetableLayoutProvider } from './context/TimetableLayoutContext';
import { AcademicYearProvider } from './context/AcademicYearContext';
import { shouldOpenSignupAfterCancel, stripQueryFromLocation } from './utils/authUrl';
import {
  tryCompletePaidCheckoutSignup,
  tryCompletePaidSubscriptionSignup,
} from './utils/paidSignupCompletion';

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState({
    signupRequiresPayment: false,
    stripePublishableKey: '',
  });
  const [openSignupAfterCancel, setOpenSignupAfterCancel] = useState(false);
  const [isSubscriptionCheckLoading, setIsSubscriptionCheckLoading] = useState(false);
  const [isSubscriptionRequired, setIsSubscriptionRequired] = useState(false);
  const isDemoUser = String(user?.email || '').toLowerCase() === 'teacher@plannix.test';

  const requiresPaidSubscription = Boolean(authConfig.signupRequiresPayment);

  const checkSubscriptionAccess = async () => {
    if (!requiresPaidSubscription || isDemoUser) {
      setIsSubscriptionRequired(false);
      return true;
    }
    setIsSubscriptionCheckLoading(true);
    try {
      const summary = await fetchSubscriptionSummary();
      const status = String(summary?.subscription?.status || '');
      const hasAccess = status === 'active' || status === 'trialing';
      setIsSubscriptionRequired(!hasAccess);
      return hasAccess;
    } catch {
      setIsSubscriptionRequired(true);
      return false;
    } finally {
      setIsSubscriptionCheckLoading(false);
    }
  };

  useEffect(() => {
    if (shouldOpenSignupAfterCancel()) {
      setOpenSignupAfterCancel(true);
      stripQueryFromLocation();
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setIsSubscriptionRequired(false);
      setIsSubscriptionCheckLoading(false);
      return;
    }
    checkSubscriptionAccess();
  }, [user, requiresPaidSubscription, isDemoUser]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const { user: completedUser } = await tryCompletePaidSubscriptionSignup(completePaidSignupSubscription);
      if (cancelled || !completedUser) {
        return;
      }
      setUser(completedUser);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const { user: completedUser } = await tryCompletePaidCheckoutSignup(completePaidSignupSession);
      if (cancelled || !completedUser) {
        return;
      }
      setUser(completedUser);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadConfig = async () => {
      try {
        const config = await fetchAuthConfig();
        if (!isMounted || !config) {
          return;
        }
        setAuthConfig(config);
      } catch {
        /* ignore */
      }
    };

    loadConfig();
    return () => {
      isMounted = false;
    };
  }, []);

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
    const hasAccess = await checkSubscriptionAccess();
    navigate(hasAccess ? '/timetable' : '/subscription-required');
    return loggedInUser;
  };

  const handleLogout = async () => {
    try {
      await logoutSession();
    } finally {
      setUser(null);
      setIsSubscriptionRequired(false);
    }
  };

  const hasSubscriptionAccess =
    !requiresPaidSubscription || (!isSubscriptionRequired && !isSubscriptionCheckLoading);

  const privateOrSubscriptionGate = (element) => {
    if (!user) {
      return (
        <main>
          <Hero user={null} />
          <HomeHighlights />
          <CTASection user={null} />
        </main>
      );
    }
    if (!hasSubscriptionAccess) {
      return <Navigate to="/subscription-required" replace />;
    }
    return element;
  };

  const handleSignup = async ({ name, email, password }) => {
    const result = await signupAccount({ name, email, password });
    if (result?.redirecting) {
      return result;
    }
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
            authConfig={authConfig}
            openSignupAfterCancel={openSignupAfterCancel}
            onOpenSignupAfterCancelHandled={() => setOpenSignupAfterCancel(false)}
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
            <Route path="/terms" element={<TermsGate />} />
            <Route path="/privacy" element={<PrivacyGate />} />
            <Route path="/settings" element={privateOrSubscriptionGate(<Settings />)} />
            <Route
              path="/subscription-required"
              element={
                user ? (
                  <SubscriptionGate />
                ) : (
                  <main>
                    <Hero user={null} />
                    <HomeHighlights />
                    <CTASection user={null} />
                  </main>
                )
              }
            />
            <Route
              path="/settings/subscription"
              element={
                user ? (
                  <Subscription />
                ) : (
                  <main>
                    <Hero user={null} />
                    <HomeHighlights />
                    <CTASection user={null} />
                  </main>
                )
              }
            />
            <Route path="/settings/academic-year" element={privateOrSubscriptionGate(<AcademicYear />)} />
            <Route path="/classes" element={privateOrSubscriptionGate(<Classes />)} />
            <Route path="/classes/input" element={privateOrSubscriptionGate(<Classes />)} />
            <Route
              path="/timetable"
              element={privateOrSubscriptionGate(<Timetable />)}
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
