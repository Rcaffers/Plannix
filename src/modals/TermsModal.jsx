import { useEffect, useId, useLayoutEffect, useState } from 'react';
import { PLANNIX_OPEN_TERMS_EVENT } from '../utils/plannixEvents';
import TermsLegalContent from './TermsLegalContent';
import './TermsModal.css';

const LAST_UPDATED = '5 May 2026';

export default function TermsModal() {
  const titleId = useId();
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(PLANNIX_OPEN_TERMS_EVENT, onOpen);
    return () => window.removeEventListener(PLANNIX_OPEN_TERMS_EVENT, onOpen);
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
            Terms &amp; conditions
          </h2>
          <button type="button" className="terms-modal-dismiss" onClick={close} aria-label="Close terms">
            ×
          </button>
        </div>
        <p className="terms-modal-meta">Last updated: {LAST_UPDATED}</p>
        <p className="terms-modal-lead">
          These terms govern your use of Plannix. They are written to reflect common obligations under EU and UK consumer
          and data-protection rules. They do not replace legal advice; have them reviewed for your entity and
          jurisdiction.
        </p>
        <div className="terms-modal-body">
          <TermsLegalContent />
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
