import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { dispatchOpenLoginModal } from '../utils/plannixEvents';
import { INVALID_RECOVERY_MESSAGE, MAX_PASSWORD_LENGTH, supabaseRecovery, validateRecoveryPasswords } from '../utils/supabaseRecovery';
import './ResetPassword.css';

export default function ResetPassword() {
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');

  const isSubmitting = status === 'submitting';
  const isReady = status === 'ready';

  useEffect(() => supabaseRecovery.subscribe({
    onReady: () => { setStatus('ready'); setError(''); },
    onInvalid: (message) => { setStatus('invalid'); setError(message); },
  }), []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    const validation = validateRecoveryPasswords(password, confirm);
    if (!isReady || validation) {
      setError(validation || INVALID_RECOVERY_MESSAGE);
      return;
    }

    setStatus('submitting');
    try {
      await supabaseRecovery.update(password, confirm);
      setStatus('done');
    } catch (err) {
      setStatus('ready');
      setError(err.message || 'Your password could not be updated. Please request a new reset link and try again.');
    }
  }

  return (
    <main className="reset-password-page">
      <div className="container reset-password-inner">
        <p className="reset-password-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          Reset password
        </p>

        {status === 'done' ? (
          <div className="reset-password-card reset-password-card--success" role="status">
            <p className="reset-password-kicker">All set</p>
            <h1 className="reset-password-title">Password updated</h1>
            <p className="reset-password-lead">
              You can log in with your new password. For security, other sessions were signed out.
            </p>
            <div className="reset-password-actions">
              <button
                type="button"
                className="reset-password-primary"
                onClick={() => {
                  navigate('/', { replace: true });
                  dispatchOpenLoginModal();
                }}
              >
                Log in
              </button>
              <Link to="/" className="reset-password-secondary">
                Back to home
              </Link>
            </div>
          </div>
        ) : (
          <div className="reset-password-card">
            <p className="reset-password-kicker">Account</p>
            <h1 className="reset-password-title">Choose a new password</h1>
            {status === 'checking' ? (
              <p className="reset-password-lead" role="status">Checking your password reset link…</p>
            ) : !isReady ? (
              <p className="reset-password-lead reset-password-lead--warn" role="alert">
                This reset link is missing or invalid. Request a new link from the log in screen.
              </p>
            ) : (
              <p className="reset-password-lead">Enter a new password for your Plannix account.</p>
            )}

            <form className="reset-password-form" onSubmit={handleSubmit}>
              <div className="reset-password-field">
                <label htmlFor="reset-password-new">New password</label>
                <input
                  id="reset-password-new"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting || !isReady}
                  minLength={8}
                  maxLength={MAX_PASSWORD_LENGTH}
                  required
                />
              </div>
              <div className="reset-password-field">
                <label htmlFor="reset-password-confirm">Confirm password</label>
                <input
                  id="reset-password-confirm"
                  type="password"
                  name="confirm"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={isSubmitting || !isReady}
                  minLength={8}
                  maxLength={MAX_PASSWORD_LENGTH}
                  required
                />
              </div>

              {error ? (
                <p className="reset-password-message reset-password-message--error" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="reset-password-primary"
                disabled={isSubmitting || !isReady}
              >
                {isSubmitting ? 'Saving…' : 'Save new password'}
              </button>
            </form>

            <p className="reset-password-foot">
              <Link to="/">Return to home</Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
