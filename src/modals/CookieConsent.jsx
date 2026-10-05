import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { OPEN_COOKIE_SETTINGS_EVENT, readStoredConsent, subscribeConsent, writeConsent } from '../utils/cookieConsent';
import './CookieConsent.css';

export default function CookieConsent() {
  const titleId = useId();
  const rejectButton = useRef(null);
  const dialogRef = useRef(null);
  const backdropRef = useRef(null);
  const [open, setOpen] = useState(() =>
    typeof window === 'undefined' ? false : readStoredConsent() == null,
  );

  useEffect(() => {
    const onOpenSettings = () => setOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpenSettings);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpenSettings);
  }, []);

  useEffect(() => subscribeConsent(choice => {
    if (choice) setOpen(false);
    else setOpen(true);
  }), []);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    const previousFocus = document.activeElement;
    const backdrop = backdropRef.current;
    const siblings = backdrop ? [...backdrop.parentElement.children].filter(node => node !== backdrop)
      .map(node => ({ node, inert: node.inert })) : [];
    siblings.forEach(({ node }) => { node.inert = true; });
    rejectButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const containFocus = event => {
      if (event.key !== 'Tab') return;
      const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    const returnFocus = event => {
      if (backdrop?.isConnected && !backdrop.contains(event.target)) rejectButton.current?.focus();
    };
    document.addEventListener('keydown', containFocus, true);
    document.addEventListener('focusin', returnFocus, true);
    return () => {
      document.removeEventListener('keydown', containFocus, true);
      document.removeEventListener('focusin', returnFocus, true);
      siblings.forEach(({ node, inert }) => { node.inert = inert; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
    };
  }, [open]);

  const closeAcceptAnalytics = () => {
    writeConsent('analytics');
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
    <div ref={backdropRef} className="cookie-consent-backdrop" role="presentation">
      <div
        ref={dialogRef}
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
            <strong>Necessary storage:</strong> Plannix uses browser storage for sign-in and core settings.
          </p>
          <p>
            <strong>Optional analytics:</strong> if you choose <strong>Accept analytics</strong>, Google Analytics 4
            measures visits to public pages such as Home, Features and Contact. It may set analytics cookies and
            receive your IP address and browser information. Plannix sends only these public page names and URLs,
            without query strings. We do not use advertising tracking.
          </p>
          <p>
            We store your choice in this browser. Change it at any time using <strong>Cookie settings</strong> in the
            footer. Rejecting or withdrawing analytics prevents further Plannix page views and clears analytics
            cookies for this site where the browser permits it.
          </p>
          <p className="cookie-consent-withdraw">
            Choose <strong>Reject analytics</strong> to use Plannix without optional analytics.
          </p>
        </div>
        <div className="cookie-consent-actions">
          <button ref={rejectButton} type="button" className="cookie-consent-reject" onClick={closeNecessaryOnly}>
            Reject analytics
          </button>
          <button type="button" className="cookie-consent-accept" onClick={closeAcceptAnalytics}>
            Accept analytics
          </button>
        </div>
      </div>
    </div>
  );
}
