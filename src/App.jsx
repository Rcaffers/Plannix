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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState({ signupRequiresPayment: false });
  const [openSignupAfterCancel, setOpenSignupAfterCancel] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('signup_cancel') === '1') {
      setOpenSignupAfterCancel(true);
      window.history.replaceState({}, '', window.location.pathname || '/');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (params.get('signup_complete') !== '1' || !sessionId) {
      return undefined;
    }

    let cancelled = false;

    const finishPaidSignup = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/signup/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ session_id: sessionId }),
        });

        const payload = await parseJsonSafe(response);
        if (cancelled) {
          return;
        }

        if (response.ok && payload?.user) {
          setUser(payload.user);
        }
      } finally {
        if (!cancelled) {
          window.history.replaceState({}, '', window.location.pathname || '/');
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
        const response = await fetch(`${API_BASE_URL}/auth/config`, {
          method: 'GET',
          credentials: 'include',
        });
        if (!isMounted || !response.ok) {
          return;
        }
        const data = await parseJsonSafe(response);
        if (data && typeof data.signupRequiresPayment === 'boolean') {
          setAuthConfig({ signupRequiresPayment: data.signupRequiresPayment });
        }
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
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          method: 'GET',
          credentials: 'include',
        });

        if (!isMounted) {
          return;
        }

        if (!response.ok) {
          setUser(null);
          return;
        }

        const data = await parseJsonSafe(response);
        setUser(data?.user ?? data ?? null);
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
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to log in with those details.');
    }

    const loggedInUser = payload?.user ?? payload;
    if (loggedInUser) {
      setUser(loggedInUser);
      return loggedInUser;
    }

    const meResponse = await fetch(`${API_BASE_URL}/auth/me`, {
      method: 'GET',
      credentials: 'include',
    });

    const mePayload = await parseJsonSafe(meResponse);
    const meUser = mePayload?.user ?? mePayload ?? null;
    setUser(meUser);
    return meUser;
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setUser(null);
    }
  };

  const handleSignup = async ({ name, email, password }) => {
    const response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ name, email, password }),
    });

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.message || 'Unable to create your account right now.');
    }

    if (payload?.checkoutUrl) {
      window.location.assign(payload.checkoutUrl);
      return { redirecting: true };
    }

    const createdUser = payload?.user ?? payload ?? null;
    setUser(createdUser);
    return createdUser;
  };

  return (
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
      </Routes>
      <Footer />
      <CookieConsent />
    </div>
  );
}
