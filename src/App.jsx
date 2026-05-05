import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import './App.css';
import Header from './components/Header';
import Hero from './components/Hero';
import ProjectGrid from './components/ProjectGrid';
import CTASection from './components/CTASection';
import Footer from './components/Footer';
import CookieConsent from './components/CookieConsent';
import Features from './pages/Features';
import Settings from './pages/Settings';
import Classes from './pages/Classes';
import {
  completePaidSignupSession,
  fetchAuthConfig,
  fetchAuthMe,
  loginWithCredentials,
  logoutSession,
  signupAccount,
} from './utils/api';
import { TimetableLayoutProvider } from './context/TimetableLayoutContext';
import { readPaidSignupSessionId, shouldOpenSignupAfterCancel, stripQueryFromLocation } from './utils/authUrl';

export default function App() {
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState({ signupRequiresPayment: false });
  const [openSignupAfterCancel, setOpenSignupAfterCancel] = useState(false);

  useEffect(() => {
    if (shouldOpenSignupAfterCancel()) {
      setOpenSignupAfterCancel(true);
      stripQueryFromLocation();
    }
  }, []);

  useEffect(() => {
    const sessionId = readPaidSignupSessionId();
    if (!sessionId) {
      return undefined;
    }

    let cancelled = false;

    const finishPaidSignup = async () => {
      try {
        const { user: completedUser } = await completePaidSignupSession(sessionId);
        if (cancelled) {
          return;
        }
        if (completedUser) {
          setUser(completedUser);
        }
      } finally {
        if (!cancelled) {
          stripQueryFromLocation();
        }
      }
    };

    finishPaidSignup();
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
    return loggedInUser;
  };

  const handleLogout = async () => {
    try {
      await logoutSession();
    } finally {
      setUser(null);
    }
  };

  const handleSignup = async ({ name, email, password }) => {
    const { redirecting, user: createdUser } = await signupAccount({ name, email, password });
    if (redirecting) {
      return { redirecting: true };
    }
    setUser(createdUser);
    return createdUser;
  };

  return (
    <TimetableLayoutProvider>
      <div className="page-shell">
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
                <Hero />
                <section className="section content-section" id="work">
                  <ProjectGrid />
                </section>
                <CTASection />
              </main>
            }
          />
          <Route path="/features" element={<Features />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/classes" element={<Classes />} />
        </Routes>
        <Footer />
        <CookieConsent />
      </div>
    </TimetableLayoutProvider>
  );
}
