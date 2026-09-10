import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  getLoginValidationError,
  getSignupValidationError,
  loginSuccessMessage,
  signupSuccessMessage,
} from '../utils/authForms';
import { requestPasswordReset } from '../utils/api';
import { headerNavLinks } from '../utils/headerNav';
import { SETTINGS_SUBNAV_ITEMS } from './SettingsSubnav';
import { PLANNIX_OPEN_LOGIN_EVENT, PLANNIX_OPEN_SIGNUP_EVENT } from '../utils/plannixEvents';
import './Header.css';

export default function Header({
  user,
  isAuthLoading,
  onLogin,
  onLogout,
  onSignup,
}) {
  const location = useLocation();
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
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [mobileSettingsExpanded, setMobileSettingsExpanded] = useState(false);
  const [loginModalPane, setLoginModalPane] = useState('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);
  const userMenuRef = useRef(null);
  const mobileNavRef = useRef(null);

  const navLinks = user
    ? [
        { label: 'Timetable', to: '/timetable' },
        { label: 'Contact', to: '/contact' },
      ]
    : headerNavLinks;

  const closeMobileNav = () => setIsMobileNavOpen(false);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!isMobileNavOpen) {
      return;
    }
    const onSettings =
      location.pathname.startsWith('/settings') || location.pathname.startsWith('/classes');
    setMobileSettingsExpanded(onSettings);
  }, [isMobileNavOpen, location.pathname]);

  useEffect(() => {
    if (isLoginOpen || isSignupOpen) {
      setIsMobileNavOpen(false);
    }
  }, [isLoginOpen, isSignupOpen]);

  useEffect(() => {
    if (!isMobileNavOpen) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileNavOpen]);

  useEffect(() => {
    if (!isMobileNavOpen) {
      return undefined;
    }

    const onPointerDown = (event) => {
      if (mobileNavRef.current && !mobileNavRef.current.contains(event.target)) {
        setIsMobileNavOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isMobileNavOpen]);

  useEffect(() => {
    if (!isLoginOpen && !isSignupOpen && !isUserMenuOpen && !isMobileNavOpen) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsLoginOpen(false);
        setIsSignupOpen(false);
        setIsUserMenuOpen(false);
        setIsMobileNavOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLoginOpen, isSignupOpen, isUserMenuOpen, isMobileNavOpen]);

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

  const closeLogin = () => {
    setIsLoginOpen(false);
    setLoginError('');
    setLoginSuccess('');
    setLoginModalPane('login');
    setForgotEmail('');
    setForgotError('');
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
    setLoginModalPane('login');
    setForgotError('');
    setIsLoginOpen(true);
  };

  const openSignup = () => {
    setIsLoginOpen(false);
    setLoginError('');
    setLoginSuccess('');
    setLoginModalPane('login');
    setForgotEmail('');
    setForgotError('');
    setIsSignupOpen(true);
  };

  const openSignupRef = useRef(openSignup);
  openSignupRef.current = openSignup;

  const openLoginRef = useRef(openLogin);
  openLoginRef.current = openLogin;

  useEffect(() => {
    const onGlobalOpenSignup = () => {
      openSignupRef.current();
    };
    window.addEventListener(PLANNIX_OPEN_SIGNUP_EVENT, onGlobalOpenSignup);
    return () => window.removeEventListener(PLANNIX_OPEN_SIGNUP_EVENT, onGlobalOpenSignup);
  }, []);

  useEffect(() => {
    const onGlobalOpenLogin = () => {
      openLoginRef.current();
    };
    window.addEventListener(PLANNIX_OPEN_LOGIN_EVENT, onGlobalOpenLogin);
    return () => window.removeEventListener(PLANNIX_OPEN_LOGIN_EVENT, onGlobalOpenLogin);
  }, []);

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

  const handleForgotPasswordSubmit = async (event) => {
    event.preventDefault();
    setForgotError('');
    const email = forgotEmail.trim();
    if (!email || !email.includes('@')) {
      setForgotError('Please enter a valid email address.');
      return;
    }
    setIsForgotSubmitting(true);
    try {
      await requestPasswordReset({ email });
      setLoginModalPane('forgot-sent');
    } catch (err) {
      setForgotError(err.message || 'Could not send reset email. Please try again.');
    } finally {
      setIsForgotSubmitting(false);
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
      <header className={`site-header${isMobileNavOpen ? ' site-header--mobile-open' : ''}`}>
        <div className="container nav-shell" ref={mobileNavRef}>
          <div className="nav-left">
            <Link className="brand" to="/" aria-label="Plannix Home">
              <span className="brand-mark">
                <img className="brand-logo" src="/Plannix_logo.png" alt="Plannix" />
              </span>
            </Link>

            <nav className="main-nav main-nav--wide" aria-label="Primary navigation">
              {navLinks.map((item) =>
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

          <div className="nav-actions nav-actions--wide">
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

          <button
            type="button"
            className={`nav-mobile-burger${isMobileNavOpen ? ' nav-mobile-burger--open' : ''}`}
            aria-expanded={isMobileNavOpen}
            aria-controls="mobile-nav-panel"
            id="mobile-nav-burger"
            onClick={() => setIsMobileNavOpen((open) => !open)}
            aria-label={isMobileNavOpen ? 'Close menu' : 'Open menu'}
          >
            <span className="nav-mobile-burger-box" aria-hidden>
              <span className="nav-mobile-burger-line" />
              <span className="nav-mobile-burger-line" />
              <span className="nav-mobile-burger-line" />
            </span>
          </button>

          <div
            id="mobile-nav-panel"
            className="mobile-nav-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
          >
            <nav className="mobile-nav" aria-label="Site menu">
              {navLinks.map((item) =>
                item.href ? (
                  <a key={item.label} className="mobile-nav-link" href={item.href} onClick={closeMobileNav}>
                    {item.label}
                  </a>
                ) : (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `mobile-nav-link${isActive ? ' mobile-nav-link--active' : ''}`}
                    onClick={closeMobileNav}
                  >
                    {item.label}
                  </NavLink>
                ),
              )}
            </nav>
            {user ? (
              <div className="mobile-nav-account">
                <p className="mobile-nav-account-label">{user.name || user.email || 'Account'}</p>
                <div className="mobile-nav-settings-block">
                  <button
                    type="button"
                    className="mobile-nav-settings-trigger"
                    aria-expanded={mobileSettingsExpanded}
                    aria-controls="mobile-nav-settings-sections"
                    id="mobile-nav-settings-toggle"
                    onClick={() => setMobileSettingsExpanded((open) => !open)}
                  >
                    <span>Settings</span>
                    <span className="mobile-nav-settings-chevron" aria-hidden />
                  </button>
                  {mobileSettingsExpanded ? (
                    <div
                      id="mobile-nav-settings-sections"
                      className="mobile-nav-settings-nested"
                      role="group"
                      aria-labelledby="mobile-nav-settings-toggle"
                    >
                      {SETTINGS_SUBNAV_ITEMS.map((item) => (
                        <NavLink
                          key={`${item.to}${item.end ? '-end' : ''}`}
                          to={item.to}
                          end={Boolean(item.end)}
                          className={({ isActive }) =>
                            `mobile-nav-link mobile-nav-link--sub${isActive ? ' mobile-nav-link--active' : ''}`
                          }
                          onClick={closeMobileNav}
                        >
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="mobile-nav-link mobile-nav-link--sub mobile-nav-link--button"
                  onClick={() => {
                    closeMobileNav();
                    onLogout();
                  }}
                  disabled={isAuthLoading}
                >
                  Log out
                </button>
              </div>
            ) : (
              <div className="mobile-nav-auth">
                <button
                  type="button"
                  className="mobile-nav-signup"
                  onClick={() => {
                    openSignup();
                    closeMobileNav();
                  }}
                  disabled={isAuthLoading}
                >
                  Sign up
                </button>
                <button
                  type="button"
                  className="mobile-nav-login"
                  onClick={() => {
                    openLogin();
                    closeMobileNav();
                  }}
                  disabled={isAuthLoading}
                >
                  {isAuthLoading ? 'Checking...' : 'Login'}
                </button>
              </div>
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
            aria-labelledby={
              loginModalPane === 'login'
                ? 'login-modal-title'
                : loginModalPane === 'forgot-email'
                  ? 'forgot-modal-title'
                  : 'forgot-sent-modal-title'
            }
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

            {loginModalPane === 'login' ? (
              <>
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
                    onChange={(event) =>
                      setLoginForm((current) => ({ ...current, email: event.target.value }))
                    }
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
                    onChange={(event) =>
                      setLoginForm((current) => ({ ...current, password: event.target.value }))
                    }
                    disabled={isLoginSubmitting}
                  />

                  <div className="login-forgot-row">
                    <button
                      type="button"
                      className="login-forgot-link"
                      onClick={() => {
                        setForgotEmail(loginForm.email);
                        setForgotError('');
                        setLoginModalPane('forgot-email');
                      }}
                      disabled={isLoginSubmitting}
                    >
                      Forgot password?
                    </button>
                  </div>

                  {loginError ? <p className="login-message error">{loginError}</p> : null}
                  {loginSuccess ? <p className="login-message success">{loginSuccess}</p> : null}

                  <button type="submit" className="login-submit" disabled={isLoginSubmitting}>
                    {isLoginSubmitting ? 'Logging in...' : 'Login'}
                  </button>

                  <p className="login-switch">
                    New to Plannix?{' '}
                    <button
                      type="button"
                      className="login-switch-link"
                      onClick={openSignup}
                      disabled={isLoginSubmitting}
                    >
                      Create an account
                    </button>
                  </p>
                </form>
              </>
            ) : null}

            {loginModalPane === 'forgot-email' ? (
              <>
                <p className="login-kicker">Password</p>
                <h2 id="forgot-modal-title">Reset your password</h2>
                <p className="login-forgot-lead">
                  Enter your email and we will send you a link to choose a new password.
                </p>
                <form className="login-form" onSubmit={handleForgotPasswordSubmit}>
                  <label htmlFor="forgot-email">Email</label>
                  <input
                    id="forgot-email"
                    type="email"
                    name="email"
                    placeholder="you@school.edu"
                    value={forgotEmail}
                    autoComplete="email"
                    onChange={(event) => setForgotEmail(event.target.value)}
                    disabled={isForgotSubmitting}
                  />
                  {forgotError ? <p className="login-message error">{forgotError}</p> : null}
                  <button type="submit" className="login-submit" disabled={isForgotSubmitting}>
                    {isForgotSubmitting ? 'Sending…' : 'Send reset link'}
                  </button>
                  <p className="login-switch">
                    <button
                      type="button"
                      className="login-switch-link"
                      onClick={() => {
                        setForgotError('');
                        setLoginModalPane('login');
                      }}
                      disabled={isForgotSubmitting}
                    >
                      Back to log in
                    </button>
                  </p>
                </form>
              </>
            ) : null}

            {loginModalPane === 'forgot-sent' ? (
              <>
                <p className="login-kicker">Check your inbox</p>
                <h2 id="forgot-sent-modal-title">Email sent</h2>
                <p className="login-forgot-lead">
                  If an account exists for that email, you will receive a link to reset your password shortly.
                </p>
                <button
                  type="button"
                  className="login-submit"
                  onClick={() => {
                    setLoginModalPane('login');
                    setForgotError('');
                  }}
                >
                  Back to log in
                </button>
              </>
            ) : null}
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
