import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  getLoginValidationError,
  getSignupValidationError,
  loginSuccessMessage,
  signupSuccessMessage,
} from '../utils/authForms';
import { SIGNUP_PAYMENT_CANCELLED_MESSAGE } from '../utils/authMessages';
import { headerNavLinks } from '../utils/headerNav';
import './Header.css';

export default function Header({
  user,
  isAuthLoading,
  authConfig,
  openSignupAfterCancel,
  onOpenSignupAfterCancelHandled,
  onLogin,
  onLogout,
  onSignup,
}) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isSignupOpen, setIsSignupOpen] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [signupForm, setSignupForm] = useState({ name: '', email: '', password: '' });
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [isSignupSubmitting, setIsSignupSubmitting] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [signupError, setSignupError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState('');
  const [signupSuccess, setSignupSuccess] = useState('');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!isLoginOpen && !isSignupOpen && !isUserMenuOpen) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsLoginOpen(false);
        setIsSignupOpen(false);
        setIsUserMenuOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLoginOpen, isSignupOpen, isUserMenuOpen]);

  useEffect(() => {
    if (!isUserMenuOpen) {
      return undefined;
    }

    const onPointerDown = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (!user) {
      setIsUserMenuOpen(false);
    }
  }, [user]);

  useEffect(() => {
    if (!openSignupAfterCancel) {
      return undefined;
    }
    setIsLoginOpen(false);
    setLoginError('');
    setLoginSuccess('');
    setIsSignupOpen(true);
    setSignupError(SIGNUP_PAYMENT_CANCELLED_MESSAGE);
    setSignupSuccess('');
    onOpenSignupAfterCancelHandled?.();
  }, [openSignupAfterCancel, onOpenSignupAfterCancelHandled]);

  const closeLogin = () => {
    setIsLoginOpen(false);
    setLoginError('');
    setLoginSuccess('');
  };

  const closeSignup = () => {
    setIsSignupOpen(false);
    setSignupError('');
    setSignupSuccess('');
  };

  const openLogin = () => {
    setIsSignupOpen(false);
    setSignupError('');
    setSignupSuccess('');
    setIsLoginOpen(true);
  };

  const openSignup = () => {
    setIsLoginOpen(false);
    setLoginError('');
    setLoginSuccess('');
    setIsSignupOpen(true);
  };

  const stopModalCloseFromInnerClick = (event) => {
    event.stopPropagation();
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setLoginError('');
    setLoginSuccess('');

    const email = loginForm.email.trim();
    const password = loginForm.password;

    const loginValidationError = getLoginValidationError({ email, password });
    if (loginValidationError) {
      setLoginError(loginValidationError);
      return;
    }

    setIsLoginSubmitting(true);
    try {
      const loggedInUser = await onLogin({ email, password });
      setLoginSuccess(loginSuccessMessage(loggedInUser));
      setLoginForm((current) => ({ ...current, password: '' }));
      setTimeout(() => {
        closeLogin();
      }, 400);
    } catch (error) {
      setLoginError(error.message || 'Login failed. Please try again.');
    } finally {
      setIsLoginSubmitting(false);
    }
  };

  const handleSignupSubmit = async (event) => {
    event.preventDefault();
    setSignupError('');
    setSignupSuccess('');

    const name = signupForm.name.trim();
    const email = signupForm.email.trim();
    const password = signupForm.password;

    const signupValidationError = getSignupValidationError({ name, email, password });
    if (signupValidationError) {
      setSignupError(signupValidationError);
      return;
    }

    setIsSignupSubmitting(true);
    try {
      const result = await onSignup({ name, email, password });
      if (result?.redirecting) {
        return;
      }
      const createdUser = result;
      setSignupSuccess(signupSuccessMessage(createdUser));
      setSignupForm({ name: '', email: '', password: '' });
      setTimeout(() => {
        closeSignup();
      }, 500);
    } catch (error) {
      setSignupError(error.message || 'Sign up failed. Please try again.');
    } finally {
      setIsSignupSubmitting(false);
    }
  };

  return (
    <>
      <header className="site-header">
        <div className="container nav-shell">
          <div className="nav-left">
            <Link className="brand" to="/" aria-label="Plannix Home">
              <span className="brand-mark">
                <img className="brand-logo" src="/Plannix_logo.png" alt="Plannix" />
              </span>
            </Link>

            <nav className="main-nav" aria-label="Primary navigation">
              {headerNavLinks.map((item) =>
                item.href ? (
                  <a key={item.label} className="nav-link" href={item.href}>
                    {item.label}
                  </a>
                ) : (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  >
                    {item.label}
                  </NavLink>
                ),
              )}
            </nav>
          </div>

          <div className="nav-actions">
            {user ? (
              <div className="nav-user-menu" ref={userMenuRef}>
                <button
                  type="button"
                  className="nav-user-trigger"
                  id="nav-user-menu-button"
                  aria-expanded={isUserMenuOpen}
                  aria-haspopup="true"
                  aria-controls="nav-user-menu-dropdown"
                  onClick={() => setIsUserMenuOpen((open) => !open)}
                  disabled={isAuthLoading}
                >
                  <span className="nav-user-name">{user.name || user.email || 'Account'}</span>
                  <span className="nav-user-burger" aria-hidden>
                    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M0 1.25h18M0 7h18M0 12.75h18"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </button>
                {isUserMenuOpen ? (
                  <div
                    id="nav-user-menu-dropdown"
                    className="nav-user-dropdown"
                    role="menu"
                    aria-labelledby="nav-user-menu-button"
                  >
                    <Link
                      className="nav-user-dropdown-item"
                      role="menuitem"
                      to="/settings"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      Settings
                    </Link>
                    <button
                      type="button"
                      className="nav-user-dropdown-item nav-user-dropdown-item-button"
                      role="menuitem"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onLogout();
                      }}
                      disabled={isAuthLoading}
                    >
                      Log out
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="nav-signup"
                  onClick={openSignup}
                  disabled={isAuthLoading}
                >
                  Sign up
                </button>
                <button
                  type="button"
                  className="nav-login"
                  onClick={openLogin}
                  disabled={isAuthLoading}
                >
                  {isAuthLoading ? 'Checking...' : 'Login'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {isLoginOpen ? (
        <div className="login-modal-backdrop" onClick={closeLogin}>
          <div
            className="login-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-modal-title"
            onClick={stopModalCloseFromInnerClick}
          >
            <button
              type="button"
              className="login-close"
              aria-label="Close login"
              onClick={closeLogin}
            >
              ×
            </button>

            <p className="login-kicker">Welcome back</p>
            <h2 id="login-modal-title">Log in to your account</h2>

            <form className="login-form" onSubmit={handleLoginSubmit}>
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                name="email"
                placeholder="you@school.edu"
                value={loginForm.email}
                autoComplete="email"
                onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                disabled={isLoginSubmitting}
              />

              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                placeholder="Enter your password"
                value={loginForm.password}
                autoComplete="current-password"
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                disabled={isLoginSubmitting}
              />

              {loginError ? <p className="login-message error">{loginError}</p> : null}
              {loginSuccess ? <p className="login-message success">{loginSuccess}</p> : null}

              <button type="submit" className="login-submit" disabled={isLoginSubmitting}>
                {isLoginSubmitting ? 'Logging in...' : 'Login'}
              </button>

              <p className="login-switch">
                New to Plannix?{' '}
                <button type="button" className="login-switch-link" onClick={openSignup} disabled={isLoginSubmitting}>
                  Create an account
                </button>
              </p>
            </form>
          </div>
        </div>
      ) : null}

      {isSignupOpen ? (
        <div className="login-modal-backdrop" onClick={closeSignup}>
          <div
            className="login-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signup-modal-title"
            onClick={stopModalCloseFromInnerClick}
          >
            <button
              type="button"
              className="login-close"
              aria-label="Close sign up"
              onClick={closeSignup}
            >
              ×
            </button>

            <p className="login-kicker">New to Plannix</p>
            <h2 id="signup-modal-title">Create your individual account</h2>
            {authConfig?.signupRequiresPayment ? (
              <p className="signup-payment-note">
                After you submit this form, you will be redirected to Stripe to complete payment. Your account is
                created once payment succeeds.
              </p>
            ) : null}

            <form className="login-form" onSubmit={handleSignupSubmit}>
              <label htmlFor="signup-name">Full name</label>
              <input
                id="signup-name"
                type="text"
                name="name"
                placeholder="Jane Doe"
                value={signupForm.name}
                autoComplete="name"
                onChange={(event) => setSignupForm((current) => ({ ...current, name: event.target.value }))}
                disabled={isSignupSubmitting}
              />

              <label htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                type="email"
                name="email"
                placeholder="you@school.edu"
                value={signupForm.email}
                autoComplete="email"
                onChange={(event) => setSignupForm((current) => ({ ...current, email: event.target.value }))}
                disabled={isSignupSubmitting}
              />

              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                name="password"
                placeholder="At least 8 characters"
                value={signupForm.password}
                autoComplete="new-password"
                onChange={(event) => setSignupForm((current) => ({ ...current, password: event.target.value }))}
                disabled={isSignupSubmitting}
              />

              {signupError ? <p className="login-message error">{signupError}</p> : null}
              {signupSuccess ? <p className="login-message success">{signupSuccess}</p> : null}

              <button type="submit" className="login-submit" disabled={isSignupSubmitting}>
                {isSignupSubmitting ? 'Creating account...' : 'Create account'}
              </button>

              <p className="login-switch">
                Already have an account?{' '}
                <button type="button" className="login-switch-link" onClick={openLogin} disabled={isSignupSubmitting}>
                  Log in
                </button>
              </p>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
