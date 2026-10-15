import { useEffect, useRef, useState } from 'react';
import { authTestOperationId, observeAuthTestOperation } from '../utils/serverAuthTestObserver';

const CHECK_DEADLINE_MS = 5000;
const UNKNOWN_MESSAGE = 'Your current session could not be confirmed. Retry the session check.';

// The Profile route withholds account details until this visit's status is confirmed.
export default function ProfileSessionGate({ verify, onVerified, children,
  deadlineMs = CHECK_DEADLINE_MS }) {
  const [state, setState] = useState('checking');
  const callbacks = useRef({ verify, onVerified });
  callbacks.current = { verify, onVerified };
  const active = useRef(null);

  function check() {
    if (active.current) return;
    const request = new AbortController();
    let settleDisposal;
    const disposed = new Promise(resolve => { settleDisposal = resolve; });
    const operation = { request, settleDisposal, id:authTestOperationId() };
    active.current = operation;
    observeAuthTestOperation({ kind:'profile-gate-start', id:operation.id });
    setState('checking');
    let outcome = 'unknown';
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('deadline')), deadlineMs);
    });
    void Promise.race([callbacks.current.verify({ signal: request.signal,
      testOperationId:operation.id }), deadline, disposed])
      .then(result => {
        if (active.current !== operation || request.signal.aborted) { outcome='disposed'; return; }
        if (result?.state === 'authenticated' || result?.state === 'signed-out') {
          const accepted = callbacks.current.onVerified(result);
          outcome = result.state === 'signed-out' ? 'signed-out' : accepted ? 'ready' : 'rejected';
          if (result.state === 'authenticated') setState(accepted ? 'ready' : 'error');
          return;
        }
        outcome = 'unknown';
        setState('error');
      }, () => {
        if (active.current === operation && !request.signal.aborted) {
          outcome='error'; setState('error');
        } else outcome='disposed';
      }).finally(() => {
        clearTimeout(timer);
        request.abort();
        if (active.current === operation) active.current = null;
        observeAuthTestOperation({ kind:'profile-gate-terminal', id:operation.id, outcome });
      });
  }

  useEffect(() => {
    check();
    return () => {
      const operation = active.current;
      active.current = null;
      operation?.request.abort();
      operation?.settleDisposal();
    };
  }, []);

  if (state === 'ready') return children;
  return <main>
    {state === 'checking'
      ? <p role="status">Checking your current session…</p>
      : <div role="alert"><p>{UNKNOWN_MESSAGE}</p>
        <button type="button" onClick={check}>Retry session check</button></div>}
  </main>;
}
