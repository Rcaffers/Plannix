import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SettingsSubnav from '../components/SettingsSubnav';
import { createBillingPortalSession, deleteAccount, fetchSubscriptionSummary } from '../utils/api';
import { formatSubscriptionPriceSummary } from '../utils/stripePriceFormat';
import './Settings.css';

function formatDateFromUnixSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value * 1000));
}

export default function Subscription() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ enabled: false, subscription: null });
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [openingMode, setOpeningMode] = useState('');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const next = await fetchSubscriptionSummary();
        if (!cancelled) {
          setSummary(next);
          setError('');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Could not load subscription details.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscription = summary.subscription;
  const priceLine = useMemo(
    () => formatSubscriptionPriceSummary(subscription?.price ?? null),
    [subscription?.price],
  );
  const renewalDate = formatDateFromUnixSeconds(subscription?.currentPeriodEnd);
  const cancelledDate = formatDateFromUnixSeconds(subscription?.canceledAt);

  async function openBillingPortal(mode) {
    if (!subscription?.id && mode === 'cancel') {
      return;
    }
    setActionError('');
    setOpeningMode(mode);
    try {
      const { url } = await createBillingPortalSession({
        mode,
        subscriptionId: subscription?.id || '',
      });
      if (!url) {
        throw new Error('Billing portal did not return a valid URL.');
      }
      window.location.assign(url);
    } catch (portalError) {
      setActionError(portalError.message || 'Could not open billing portal.');
      setOpeningMode('');
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      'Delete your account and remove all timetable/class data? This cannot be undone.',
    );
    if (!confirmed) {
      return;
    }
    const secondConfirm = window.confirm(
      'Final confirmation: this permanently deletes your account data. Continue?',
    );
    if (!secondConfirm) {
      return;
    }
    setActionError('');
    setOpeningMode('delete');
    try {
      await deleteAccount();
      window.location.assign('/');
    } catch (deleteError) {
      setActionError(deleteError.message || 'Could not delete account.');
      setOpeningMode('');
    }
  }

  return (
    <main className="settings-page">
      <div className="container settings-inner settings-inner--wide">
        <p className="settings-breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden> / </span>
          <Link to="/settings">Settings</Link>
          <span aria-hidden> / </span>
          Subscription
        </p>
        <h1 className="settings-title">Subscription</h1>
        <SettingsSubnav />
        <p className="settings-lead">
          View your current plan and manage billing. Upgrade and cancellation are handled securely in Stripe&apos;s portal.
        </p>

        <section className="settings-timetable-form">
          <h2 className="settings-section-title">Current plan</h2>
          {loading ? <p className="settings-hint">Loading subscription details…</p> : null}
          {!loading && error ? <p className="settings-hint settings-hint--error">{error}</p> : null}
          {!loading && !error && !summary.enabled ? (
            <p className="settings-hint">Subscriptions are not enabled in this environment.</p>
          ) : null}
          {!loading && !error && summary.enabled && !subscription ? (
            <p className="settings-hint">No active subscription was found for this account.</p>
          ) : null}
          {!loading && !error && summary.warning ? (
            <p className="settings-hint settings-hint--error">{summary.warning}</p>
          ) : null}
          {!loading && !error && subscription ? (
            <div className="settings-subscription-card">
              <p className="settings-subscription-plan">
                {subscription.price?.productName || 'Individual membership'}
              </p>
              <p className="settings-subscription-meta">Status: {subscription.status || 'unknown'}</p>
              {priceLine ? <p className="settings-subscription-meta">Price: {priceLine}</p> : null}
              {subscription.cancelAtPeriodEnd && renewalDate ? (
                <p className="settings-subscription-meta">Cancels at period end: {renewalDate}</p>
              ) : null}
              {!subscription.cancelAtPeriodEnd && renewalDate ? (
                <p className="settings-subscription-meta">Renews on: {renewalDate}</p>
              ) : null}
              {cancelledDate ? <p className="settings-subscription-meta">Cancelled on: {cancelledDate}</p> : null}
            </div>
          ) : null}

          <div className="settings-actions">
            <button
              type="button"
              className="settings-save"
              onClick={() => openBillingPortal('upgrade')}
              disabled={!summary.enabled || !subscription || openingMode === 'upgrade' || loading}
            >
              {openingMode === 'upgrade' ? 'Opening portal…' : 'Upgrade plan'}
            </button>
            <button
              type="button"
              className="settings-reset"
              onClick={() => openBillingPortal('cancel')}
              disabled={!summary.enabled || !subscription || openingMode === 'cancel' || loading}
            >
              {openingMode === 'cancel' ? 'Opening portal…' : 'Cancel subscription'}
            </button>
            <button
              type="button"
              className="settings-reset settings-reset--danger"
              onClick={handleDeleteAccount}
              disabled={openingMode === 'delete' || loading}
            >
              {openingMode === 'delete' ? 'Deleting account…' : 'Delete account'}
            </button>
          </div>
          {actionError ? <p className="settings-hint settings-hint--error">{actionError}</p> : null}
        </section>
      </div>
    </main>
  );
}
