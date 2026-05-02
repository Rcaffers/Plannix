import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import './Header.css';

const navLinks = [
  { label: 'Home', to: '/' },
  { label: 'Features', to: '/features' },
  { label: 'News', href: '#news' },
  { label: 'About', href: '#about' },
  { label: 'Join', href: '#join' },
  { label: 'Contact', href: '#contact' },
];

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

  useEffect(() => {
    if (!isLoginOpen && !isSignupOpen) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsLoginOpen(false);
        setIsSignupOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLoginOpen, isSignupOpen]);

  useEffect(() => {
    if (!openSignupAfterCancel) {
      return undefined;
    }
    setIsLoginOpen(false);
    setLoginError('');
    setLoginSuccess('');
    setIsSignupOpen(true);
    setSignupError('Payment was cancelled. You can try again when you are ready.');
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

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setLoginError('');
    setLoginSuccess('');

    const email = loginForm.email.trim();
    const password = loginForm.password;

    if (!email || !password.trim()) {
      setLoginError('Please enter both email and password.');
      return;
    }

    setIsLoginSubmitting(true);
    try {
      const loggedInUser = await onLogin({ email, password });
      setLoginSuccess(`Welcome${loggedInUser?.name ? `, ${loggedInUser.name}` : ''}.`);
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

    if (!name || !email || !password) {
      setSignupError('Please fill in name, email, and password.');
      return;
    }

    setIsSignupSubmitting(true);
    try {
      const result = await onSignup({ name, email, password });
      if (result?.redirecting) {
        return;
      }
      const createdUser = result;
      setSignupSuccess(`Account created${createdUser?.name ? ` for ${createdUser.name}` : ''}.`);
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

          <div className="nav-actions">
            <button
              type="button"
              className="nav-signup"
              onClick={openSignup}
              disabled={isAuthLoading}
            >
              Sign up
            </button>
          {user ? (
            <button type="button" className="nav-login nav-logout" onClick={onLogout} disabled={isAuthLoading}>
              Logout
            </button>
          ) : (
            <button
              type="button"
              className="nav-login"
              onClick={openLogin}
              disabled={isAuthLoading}
            >
              {isAuthLoading ? 'Checking...' : 'Login'}
            </button>
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
            onClick={(event) => event.stopPropagation()}
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
            onClick={(event) => event.stopPropagation()}
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
