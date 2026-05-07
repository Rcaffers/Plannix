import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createBillingPortalSession } from '../utils/api';
import './Settings.css';

export default function SubscriptionGate() {
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [error, setError] = useState('');

  async function handleRestartSubscription() {
    const confirmed = window.confirm(
      'Restart your subscription and resume billing for this account?',
    );
    if (!confirmed) {
      return;
    }
    setError('');
    setIsOpeningPortal(true);
    try {
      const { url } = await createBillingPortalSession({ mode: 'upgrade' });
      if (!url) {
        throw new Error('Could not open billing portal.');
      }
      window.location.assign(url);
    } catch (portalError) {
      setError(portalError.message || 'Could not open billing portal.');
      setIsOpeningPortal(false);
    }
  }

  return (
    <main className="settings-page">
      <div className="container settings-inner settings-inner--wide">
        <p className="settings-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          Subscription required
        </p>
        <h1 className="settings-title">Subscription paused</h1>
        <section className="settings-timetable-form">
          <p className="settings-lead settings-lead--tight">
            Your account is signed in, but your subscription is not currently active. Reactivate to continue using your
            timetable and settings.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-save"
              onClick={handleRestartSubscription}
              disabled={isOpeningPortal}
            >
              {isOpeningPortal ? 'Opening portal…' : 'Restart subscription'}
            </button>
            <Link to="/settings/subscription" className="settings-reset settings-reset-link">
              View subscription details
            </Link>
          </div>
          {error ? <p className="settings-hint settings-hint--error">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
