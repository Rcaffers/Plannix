import { useEffect, useRef, useState } from 'react';
import { activateWaitingPushWorker, observePushWorkerUpdates } from '../utils/pushWorkerUpdates.js';
import './PushWorkerUpdateNotice.css';

// The notice is route-scoped; keep a deferral through same-tab navigation.
let deferredWorker = null;

export default function PushWorkerUpdateNotice() {
  const [waiting, setWaiting] = useState(null);
  const [deferred, setDeferred] = useState(deferredWorker);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const activatedRef = useRef(null);
  const observedRef = useRef(null);
  useEffect(() => observePushWorkerUpdates({
    onWaiting(worker) {
      if (worker && worker !== observedRef.current) setMessage('');
      observedRef.current = worker;
      setWaiting(worker);
      if (!worker) { deferredWorker = null; setDeferred(null); setMessage(''); }
    },
    onActivated(worker) {
      const alreadyReported = activatedRef.current === worker;
      activatedRef.current = worker;
      setWaiting(null);
      deferredWorker = null;
      setDeferred(null);
      setMessage('');
      if (!alreadyReported) window.dispatchEvent(new Event('plannix-push-worker-activated'));
    },
  }), []);
  if (!waiting) return null;
  if (waiting === deferred) return null;
  const update = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      await activateWaitingPushWorker(waiting);
      setWaiting(null);
      deferredWorker = null;
      setDeferred(null);
      setMessage('');
      if (activatedRef.current !== waiting) {
        activatedRef.current = waiting;
        window.dispatchEvent(new Event('plannix-push-worker-activated'));
      }
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <aside className="push-update-notice" aria-label="Notification update">
    <p className="settings-hint"><strong>Notification update available.</strong> Update now or later. This page will stay open.</p>
    {busy && <p role="status">Installing notification update…</p>}
    {message && <p className="settings-error" role="alert">{message}</p>}
    <div className="push-update-actions">
      <button type="button" className="settings-save" onClick={update} disabled={busy}>{busy ? 'Updating…' : 'Update now'}</button>
      <button type="button" className="settings-reset" onClick={() => { deferredWorker = waiting; setDeferred(waiting); }} disabled={busy}>Later</button>
    </div>
  </aside>;
}
