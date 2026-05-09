import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import {
  getLoginValidationError,
  getSignupValidationError,
  loginSuccessMessage,
  signupSuccessMessage,
} from '../utils/authForms';
import { SIGNUP_PAYMENT_CANCELLED_MESSAGE } from '../utils/authMessages';
import { loadStripe } from '@stripe/stripe-js';
import { applySignupPromotionCode } from '../utils/api';
import { headerNavLinks } from '../utils/headerNav';
import { PLANNIX_OPEN_LOGIN_EVENT, PLANNIX_OPEN_SIGNUP_EVENT } from '../utils/plannixEvents';
import { formatMoneyMinor, formatSubscriptionPriceSummary } from '../utils/stripePriceFormat';
import { buildSubscriptionSignupReturnUrl } from '../utils/stripeSignupUrl';
import './Header.css';

function SignupSubscriptionPaymentForm({
  subscriptionId,
  onBack,
  onError,
  promotionInput,
  onPromotionInputChange,
  promotionApplying,
  promotionAppliedCode,
  onApplyPromotion,
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || isSubmitting) return;
    setIsSubmitting(true);
    onError('');
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: buildSubscriptionSignupReturnUrl(subscriptionId),
        },
      });
      if (error) {
        onError(error.message || 'Payment failed. Please check your details and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="payment-element-form" onSubmit={handleSubmit}>
      <div className="payment-card-frame">
        <PaymentElement />
      </div>
      <div className="payment-promo payment-promo--below-card">
        <label htmlFor="signup-promotion-code">Promotion code</label>
        <div className="payment-promo-row">
          <input
            id="signup-promotion-code"
            type="text"
            name="promotion_code"
            autoComplete="off"
            spellCheck={false}
            placeholder="Enter code"
            value={promotionInput}
            onChange={(event) => onPromotionInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onApplyPromotion();
              }
            }}
            disabled={promotionApplying || Boolean(promotionAppliedCode)}
          />
          <button
            type="button"
            className="payment-promo-apply"
            onClick={onApplyPromotion}
            disabled={
              promotionApplying || Boolean(promotionAppliedCode) || !promotionInput.trim()
            }
          >
            {promotionApplying ? 'Applying…' : 'Apply'}
          </button>
        </div>
        {promotionAppliedCode ? (
          <p className="payment-promo-applied">Applied: {promotionAppliedCode}</p>
        ) : null}
      </div>
      <p className="payment-card-footnote">
        You may be asked to complete bank verification, then you will return to Plannix automatically.
      </p>
      <div className="payment-element-actions">
        <button type="submit" className="login-submit" disabled={!stripe || isSubmitting}>
          {isSubmitting ? 'Processing payment...' : 'Activate membership'}
        </button>
        <button type="button" className="payment-card-back" onClick={onBack} disabled={isSubmitting}>
          ← Back to account details
        </button>
      </div>
    </form>
  );
}

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
  const [paymentClientSecret, setPaymentClientSecret] = useState('');
  const [pendingSubscriptionId, setPendingSubscriptionId] = useState('');
  const [signupSubscriptionPrice, setSignupSubscriptionPrice] = useState(null);
  const [signupDueToday, setSignupDueToday] = useState(null);
  const [signupPromotionInput, setSignupPromotionInput] = useState('');
  const [signupPromotionApplying, setSignupPromotionApplying] = useState(false);
  const [signupPromotionAppliedCode, setSignupPromotionAppliedCode] = useState('');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const userMenuRef = useRef(null);
  const mobileNavRef = useRef(null);
  const stripePromise = useMemo(() => {
    if (!authConfig?.stripePublishableKey) return null;
    return loadStripe(authConfig.stripePublishableKey);
  }, [authConfig?.stripePublishableKey]);

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
    setPaymentClientSecret('');
    setPendingSubscriptionId('');
    setSignupSubscriptionPrice(null);
    setSignupDueToday(null);
    setSignupPromotionInput('');
    setSignupPromotionApplying(false);
    setSignupPromotionAppliedCode('');
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
    setPaymentClientSecret('');
    setPendingSubscriptionId('');
    setSignupSubscriptionPrice(null);
    setSignupDueToday(null);
    setSignupPromotionInput('');
    setSignupPromotionApplying(false);
    setSignupPromotionAppliedCode('');
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
        if (result.clientSecret && result.subscriptionId) {
          if (!authConfig?.stripePublishableKey) {
            setSignupError(
              'Payment UI is not configured. Set STRIPE_PUBLISHABLE_KEY in the server .env and restart.',
            );
            return;
          }
          setPaymentClientSecret(result.clientSecret);
          setPendingSubscriptionId(result.subscriptionId);
          setSignupSubscriptionPrice(result.subscriptionPrice ?? null);
          setSignupDueToday(result.dueToday ?? null);
          setSignupPromotionInput('');
          setSignupPromotionAppliedCode('');
          setSignupError('');
          setSignupSuccess('Complete secure payment below to activate your subscription.');
          return;
        }
        if (result.checkoutUrl) {
          window.location.assign(result.checkoutUrl);
          return;
        }
        setSignupError('Could not start payment. Please try again.');
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

  const handleApplyPromotion = async () => {
    if (!pendingSubscriptionId || signupPromotionApplying || signupPromotionAppliedCode) {
      return;
    }
    const code = signupPromotionInput.trim();
    if (!code) {
      setSignupError('Enter a promotion code.');
      return;
    }
    setSignupPromotionApplying(true);
    setSignupError('');
    try {
      const next = await applySignupPromotionCode({
        subscriptionId: pendingSubscriptionId,
        promotionCode: code,
      });
      setPaymentClientSecret(next.clientSecret);
      if (next.subscriptionPrice) {
        setSignupSubscriptionPrice(next.subscriptionPrice);
      }
      setSignupDueToday(next.dueToday ?? null);
      setSignupPromotionAppliedCode(code);
      setSignupPromotionInput('');
      setSignupSuccess('Promotion applied. Your payment total has been updated.');
    } catch (error) {
      setSignupError(error.message || 'Could not apply that promotion code.');
    } finally {
      setSignupPromotionApplying(false);
    }
  };

  const signupPriceLine = formatSubscriptionPriceSummary(signupSubscriptionPrice);
  const signupDueTodayFormatted =
    signupDueToday && typeof signupDueToday.amount === 'number'
      ? formatMoneyMinor(signupDueToday.amount, signupDueToday.currency)
      : '';

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
                    <Link
                      className="nav-user-dropdown-item"
                      role="menuitem"
                      to="/settings/subscription"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      Subscription
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
                <Link className="mobile-nav-link mobile-nav-link--sub" to="/settings" onClick={closeMobileNav}>
                  Settings
                </Link>
                <Link
                  className="mobile-nav-link mobile-nav-link--sub"
                  to="/settings/subscription"
                  onClick={closeMobileNav}
                >
                  Subscription
                </Link>
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
            className={`login-modal${paymentClientSecret ? ' login-modal--embedded-checkout' : ''}`}
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

            <p className="login-kicker">{paymentClientSecret ? 'Secure payment' : 'New to Plannix'}</p>
            <h2 id="signup-modal-title">
              {paymentClientSecret ? 'Complete your payment' : 'Create your individual account'}
            </h2>
            {authConfig?.signupRequiresPayment && !paymentClientSecret ? (
              <p className="signup-payment-note">
                After you submit this form, complete payment in the secure form below. Your account is created once
                payment succeeds.
              </p>
            ) : null}

            {paymentClientSecret ? (
              <div className="payment-card payment-card--plannix">
                <div className="payment-card-accent" aria-hidden />
                <header className="payment-card-brand">
                  <span className="payment-card-badge">Secure checkout</span>
                  <h3 className="payment-card-title">
                    {signupSubscriptionPrice?.productName || 'Individual membership'}
                  </h3>
                  {signupPriceLine ? (
                    <p className="payment-card-price" aria-live="polite">
                      {signupPriceLine}
                    </p>
                  ) : null}
                  {signupDueTodayFormatted ? (
                    <p className="payment-card-due" aria-live="polite">
                      Due now: {signupDueTodayFormatted}
                    </p>
                  ) : null}
                  <p className="payment-card-lead">
                    Your account details are saved. Add payment details below to activate your recurring subscription.
                  </p>
                </header>
                {signupError ? <p className="login-message error payment-card-flash">{signupError}</p> : null}
                {signupSuccess ? <p className="login-message success payment-card-flash">{signupSuccess}</p> : null}
                {stripePromise ? (
                  <div className="payment-card-stripe">
                    <Elements
                      key={paymentClientSecret}
                      stripe={stripePromise}
                      options={{
                        clientSecret: paymentClientSecret,
                        paymentMethodOrder: ['apple_pay', 'google_pay', 'link', 'card'],
                        appearance: {
                          theme: 'stripe',
                          variables: {
                            colorPrimary: '#3f7f78',
                            borderRadius: '10px',
                          },
                        },
                      }}
                    >
                      <SignupSubscriptionPaymentForm
                        subscriptionId={pendingSubscriptionId}
                        promotionInput={signupPromotionInput}
                        onPromotionInputChange={setSignupPromotionInput}
                        promotionApplying={signupPromotionApplying}
                        promotionAppliedCode={signupPromotionAppliedCode}
                        onApplyPromotion={handleApplyPromotion}
                        onBack={() => {
                          setPaymentClientSecret('');
                          setPendingSubscriptionId('');
                          setSignupSubscriptionPrice(null);
                          setSignupDueToday(null);
                          setSignupPromotionInput('');
                          setSignupPromotionApplying(false);
                          setSignupPromotionAppliedCode('');
                        }}
                        onError={setSignupError}
                      />
                    </Elements>
                  </div>
                ) : (
                  <p className="login-message error">
                    Payment configuration is missing. Please contact support.
                  </p>
                )}
              </div>
            ) : (
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
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
