import { useEffect, useRef, useState } from 'react';
import { activateWaitingPushWorker, observePushWorkerUpdates } from '../utils/pushWorkerUpdates.js';
import './PushWorkerUpdateNotice.css';

export default function PushWorkerUpdateNotice() {
  const [waiting, setWaiting] = useState(null);
  const [deferred, setDeferred] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const activatedRef = useRef(null);
  const observedRef = useRef(null);
  useEffect(() => observePushWorkerUpdates({
    onWaiting(worker) {
      if (worker && worker !== observedRef.current) setMessage('');
      observedRef.current = worker;
      setWaiting(worker);
      if (!worker) setDeferred(null);
    },
    onActivated(worker) {
      const alreadyReported = activatedRef.current === worker;
      activatedRef.current = worker;
      setWaiting(null);
      setDeferred(null);
      setMessage('Notification update installed. Your work has been kept.');
      if (!alreadyReported) window.dispatchEvent(new Event('plannix-push-worker-activated'));
    },
  }), []);
  if (!waiting) return message ? <p className="push-update-notice" role="status">{message}</p> : null;
  if (waiting === deferred) return null;
  const update = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      await activateWaitingPushWorker(waiting);
      setWaiting(null);
      setMessage('Notification update installed. Your work has been kept.');
      if (activatedRef.current !== waiting) {
        activatedRef.current = waiting;
        window.dispatchEvent(new Event('plannix-push-worker-activated'));
      }
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <aside className="push-update-notice" role="status" aria-label="Notification update" aria-live="polite">
    <p><strong>Notification update available.</strong> You can keep working and update later. Updating does not reload this page.</p>
    {message && <p>{message}</p>}
    <div className="push-update-actions">
      <button type="button" className="settings-save" onClick={update} disabled={busy}>{busy ? 'Updating…' : 'Update now'}</button>
      <button type="button" className="settings-reset" onClick={() => setDeferred(waiting)} disabled={busy}>Later</button>
    </div>
  </aside>;
}
