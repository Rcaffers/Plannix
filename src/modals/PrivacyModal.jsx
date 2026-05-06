import { useEffect, useId, useLayoutEffect, useState } from 'react';
import { PLANNIX_OPEN_PRIVACY_EVENT } from '../utils/plannixEvents';
import PrivacyLegalContent from './PrivacyLegalContent';
import './TermsModal.css';

const LAST_UPDATED = '6 May 2026';

export default function PrivacyModal() {
  const titleId = useId();
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(PLANNIX_OPEN_PRIVACY_EVENT, onOpen);
    return () => window.removeEventListener(PLANNIX_OPEN_PRIVACY_EVENT, onOpen);
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

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const close = () => setOpen(false);

  if (!open) {
    return null;
  }

  return (
    <div className="terms-modal-backdrop" role="presentation" onClick={close}>
      <div
        className="terms-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="terms-modal-toolbar">
          <h2 id={titleId} className="terms-modal-title">
            Privacy notice
          </h2>
          <button type="button" className="terms-modal-dismiss" onClick={close} aria-label="Close privacy notice">
            ×
          </button>
        </div>
        <p className="terms-modal-meta">Last updated: {LAST_UPDATED}</p>
        <p className="terms-modal-lead">
          This notice explains how Plannix processes personal data in line with the EU General Data Protection Regulation
          (GDPR) and, where applicable, the UK GDPR. It should be read alongside our terms of use and cookie controls. Have
          it reviewed by a qualified adviser for your situation.
        </p>
        <div className="terms-modal-body">
          <PrivacyLegalContent />
        </div>
        <div className="terms-modal-actions">
          <button type="button" className="terms-modal-close-btn" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
