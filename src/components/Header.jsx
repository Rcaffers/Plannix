import { useEffect, useState } from 'react';
import './Header.css';

const navItems = ['Home', 'Features', 'News', 'About', 'Join', 'Contact'];

export default function Header({ user, isAuthLoading, onLogin, onLogout }) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState('');

  useEffect(() => {
    if (!isLoginOpen) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsLoginOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLoginOpen]);

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setLoginError('');
    setLoginSuccess('');

    if (!email.trim() || !password.trim()) {
      setLoginError('Please enter both email and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const loggedInUser = await onLogin({ email: email.trim(), password });
      setLoginSuccess(`Welcome${loggedInUser?.name ? `, ${loggedInUser.name}` : ''}.`);
      setPassword('');
      setTimeout(() => {
        setIsLoginOpen(false);
        setLoginSuccess('');
      }, 400);
    } catch (error) {
      setLoginError(error.message || 'Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <header className="site-header">
        <div className="container nav-shell">
          <div className="nav-left">
            <a className="brand" href="#top" aria-label="New Genre Home">
              <span className="brand-mark">
                <img className="brand-logo" src="/Plannix_logo.png" alt="Plannix" />
              </span>
            </a>

            <nav className="main-nav" aria-label="Primary navigation">
              {navItems.map((item) => (
                <a
                  key={item}
                  href={item === 'Work' ? '#work' : '#'}
                  className={item === 'Work' ? 'nav-link active' : 'nav-link'}
                >
                  {item}
                </a>
              ))}
            </nav>
          </div>

          <div className="nav-actions">
            <a href="#signup" className="nav-signup">
              Sign up
            </a>
          {user ? (
            <button type="button" className="nav-login nav-logout" onClick={onLogout} disabled={isAuthLoading}>
              Logout
            </button>
          ) : (
            <button type="button" className="nav-login" onClick={() => setIsLoginOpen(true)} disabled={isAuthLoading}>
              {isAuthLoading ? 'Checking...' : 'Login'}
            </button>
          )}
          </div>
        </div>
      </header>

      {isLoginOpen ? (
        <div className="login-modal-backdrop" onClick={() => setIsLoginOpen(false)}>
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
              onClick={() => setIsLoginOpen(false)}
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
                value={email}
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
              />

              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                placeholder="Enter your password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
              />

              {loginError ? <p className="login-message error">{loginError}</p> : null}
              {loginSuccess ? <p className="login-message success">{loginSuccess}</p> : null}

              <button type="submit" className="login-submit" disabled={isSubmitting}>
                {isSubmitting ? 'Logging in...' : 'Login'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
