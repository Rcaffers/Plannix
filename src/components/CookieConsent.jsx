import { useEffect, useId, useState } from 'react';
import './CookieConsent.css';

export const OPEN_COOKIE_SETTINGS_EVENT = 'plannix:open-cookie-settings';

const CONSENT_STORAGE_KEY = 'plannix_cookie_consent_v1';

function readStoredConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'number') {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeConsent(choice) {
  const record = {
    version: 1,
    choice,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  window.dispatchEvent(new CustomEvent('plannix:cookie-consent', { detail: record }));
}

export default function CookieConsent() {
  const titleId = useId();
  const [open, setOpen] = useState(() =>
    typeof window === 'undefined' ? false : readStoredConsent() == null,
  );

  useEffect(() => {
    const onOpenSettings = () => setOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpenSettings);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpenSettings);
  }, []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const closeAcceptAll = () => {
    writeConsent('all');
    setOpen(false);
  };

  const closeNecessaryOnly = () => {
    writeConsent('necessary_only');
    setOpen(false);
  };

  if (!open) {
    return null;
  }

  return (
    <div className="cookie-consent-backdrop" role="presentation">
      <div
        className="cookie-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="cookie-consent-title">
          Cookies and similar technologies
        </h2>
        <div className="cookie-consent-body">
          <p>
            Under the EU <strong>General Data Protection Regulation (GDPR)</strong> and the{' '}
            <strong>Privacy and Electronic Communications Directive (ePrivacy)</strong>, we need to be transparent
            when we store or access information on your device (for example cookies or local storage).
          </p>
          <p>
            <strong>Strictly necessary:</strong> we use a small amount of data on your device so core features work,
            including an encrypted session cookie when you log in, without which sign-in cannot function. Where this
            involves personal data, we rely on{' '}
            <strong>legitimate interests</strong> and, where relevant, <strong>performance of a contract</strong>, as
            described in applicable EU and UK law.
          </p>
          <p>
            <strong>Optional:</strong> we do not enable non-essential cookies (such as analytics or marketing) unless
            you choose <strong>Accept all</strong> below. If we introduce optional cookies later, that choice will
            control whether they run.
          </p>
          <p>
            We record your decision in your browser (local storage) so we do not show this dialog on every visit. You
            can update your choice at any time using the <strong>Cookies</strong> link in the site footer, or by
            clearing site data for this domain in your browser settings.
          </p>
          <p className="cookie-consent-withdraw">
            Withdrawing consent or refusing non-essential cookies is as easy as giving consent: use{' '}
            <strong>Reject non-essential</strong> below, or the footer <strong>Cookies</strong> link, or clear stored
            data for this site in your browser settings.
          </p>
        </div>
        <div className="cookie-consent-actions">
          <button type="button" className="cookie-consent-reject" onClick={closeNecessaryOnly}>
            Reject non-essential
          </button>
          <button type="button" className="cookie-consent-accept" onClick={closeAcceptAll}>
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
