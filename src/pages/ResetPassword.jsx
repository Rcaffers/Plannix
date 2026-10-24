import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { dispatchOpenLoginModal } from '../utils/plannixEvents';
import { INVALID_RECOVERY_MESSAGE, MAX_PASSWORD_LENGTH, supabaseRecovery, validateRecoveryPasswords } from '../utils/supabaseRecovery';
import { authTestOperationId, observeAuthTestOperation } from '../utils/serverAuthTestObserver';
import './ResetPassword.css';

export default function ResetPassword() {
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const verificationRef = useRef(null);
  const submissionPendingRef = useRef(false);
  const submissionContextChangedRef = useRef(false);
  const testViewId = useRef(null);
  if (!testViewId.current) testViewId.current = authTestOperationId();

  const isSubmitting = status === 'submitting';
  const isReady = status === 'ready';

  useEffect(() => {
    if (testViewId.current) observeAuthTestOperation({kind:'recovery-view-mount',id:testViewId.current});
    const cleanup = supabaseRecovery.subscribe({
      onReady: () => { if (submissionPendingRef.current) {
        submissionContextChangedRef.current = true; return;
      }
        setStatus('ready'); setError(''); },
      onInvalid: (message) => { if (submissionPendingRef.current) {
        submissionContextChangedRef.current = true; return;
      }
        setStatus('invalid'); setError(message);
        setPassword(''); setConfirm(''); },
      onUnavailable: () => { if (submissionPendingRef.current) {
        submissionContextChangedRef.current = true; return;
      }
        setStatus('verification-unavailable'); setError('');
        setPassword(''); setConfirm(''); },
    });
    verificationRef.current = cleanup;
    return () => { verificationRef.current = null; cleanup?.();
      if (testViewId.current) observeAuthTestOperation({kind:'recovery-view-unmount',id:testViewId.current}); };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submissionPendingRef.current || isSubmitting) return;
    const testSubmitId = authTestOperationId();
    setError('');
    const validation = validateRecoveryPasswords(password, confirm);
    if (!isReady || validation) {
      setError(validation || INVALID_RECOVERY_MESSAGE);
      return;
    }

    submissionContextChangedRef.current = false;
    submissionPendingRef.current = true;
    setStatus('submitting');
    let outcome;
    try {
      outcome = await supabaseRecovery.update(password, confirm);
    } catch (err) {
      submissionPendingRef.current = false;
      if (err.code === 'recovery_invalid' || err.code === 'recovery_unconfirmed') {
        setStatus(err.code === 'recovery_invalid' ? 'invalid' : 'uncertain');
        setPassword(''); setConfirm('');
      } else if (submissionContextChangedRef.current) {
        setStatus('uncertain'); setPassword(''); setConfirm('');
      } else setStatus('ready');
      setError(submissionContextChangedRef.current && err.code !== 'recovery_invalid'
        ? 'We could not confirm whether your password changed. Try signing in with the new password before requesting another reset link.'
        : err.message || 'Your password could not be updated. Please request a new reset link and try again.');
      return;
    }
    submissionPendingRef.current = false;
    setPassword('');
    setConfirm('');
    setStatus('done');
    if (outcome?.sessionChanged) {
      if (testSubmitId) observeAuthTestOperation({kind:'recovery-submit-terminal',
        id:testSubmitId,viewId:testViewId.current,outcome:'confirmed-session-changed'});
      return;
    }
    navigate('/', { replace: true });
    dispatchOpenLoginModal();
    if (testSubmitId) observeAuthTestOperation({kind:'recovery-submit-terminal',
      id:testSubmitId,viewId:testViewId.current,outcome:'confirmed'});
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
          <div className="reset-password-card reset-password-card--success">
            <p className="visually-hidden" role="status">Password updated</p>
            <h1 className="reset-password-title">Password reset</h1>
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
              <p className="reset-password-lead visually-hidden" role="status">Checking your password reset link…</p>
            ) : status === 'verification-unavailable' ? (
              <p className="reset-password-lead reset-password-lead--warn" role="alert">
                We could not verify this reset link right now. Your password has not been submitted. Retry verification to check this link again.
              </p>
            ) : status === 'uncertain' ? (
              <p className="reset-password-lead reset-password-lead--warn" role="alert">
                We could not confirm whether your password changed. Try signing in with the new password before requesting another reset link.
              </p>
            ) : isSubmitting ? (
              <p className="reset-password-lead" role="status">Saving your new password…</p>
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
                Save new password
              </button>
            </form>

            {status === 'verification-unavailable' && (
              <div className="reset-password-actions">
                <button type="button" className="reset-password-primary" onClick={() => {
                  setStatus('checking');
                  verificationRef.current?.retry?.();
                }}>
                  Retry verification
                </button>
              </div>
            )}

            {(status === 'invalid' || status === 'uncertain') && (
              <div className="reset-password-actions">
                <button type="button" className="reset-password-primary" onClick={() => {
                  navigate('/', { replace: true }); dispatchOpenLoginModal();
                }}>
                  {status === 'invalid' ? 'Request a new reset link' : 'Go to log in'}
                </button>
              </div>
            )}

            <p className="reset-password-foot">
              <Link to="/">Return to home</Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
