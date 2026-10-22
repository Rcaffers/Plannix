import { bootstrapServerSession, notifyServerSessionChange,
  serverAuthFetch, serverSessionStatus, captureServerRecoveryContext } from './serverAuthTransport.js';
import { INVALID_RECOVERY_MESSAGE, RECOVERY_ACKNOWLEDGEMENT,
  validateRecoveryPasswords } from './supabaseRecovery.js';
import { authTestOperationId, observeAuthTestOperation } from './serverAuthTestObserver.js';

const UNCONFIRMED_RECOVERY_MESSAGE =
  'We could not confirm whether your password changed. Try signing in with the new password. If that does not work, request a new reset link.';
function recoveryError(code, message) { return Object.assign(new Error(message), { code }); }

export function createServerRecoveryController({
  readStatus = options => serverSessionStatus(fetch,options),
  statusTimeoutMs = 8000,
} = {}) {
  let ready = false;
  let submitting = false;
  let selected = null;
  let subscription = null;
  return {
    async request(email) {
      try {
        await bootstrapServerSession();
        await serverAuthFetch('/__stage3/auth/recover', { method:'POST',
          headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email }) },
        { unauthenticated:true });
      } catch { /* Recovery acknowledgement stays generic. */ }
      return RECOVERY_ACKNOWLEDGEMENT;
    },
    subscribe({ onReady, onInvalid, onUnavailable }) {
      const current = { active:true, attempt:0, state:'checking', cancel:null };
      subscription = current;
      const invalidate = () => {
        if (!current.active || subscription !== current || !ready) return;
        current.attempt += 1;
        current.cancel?.();
        current.state = 'invalid';
        ready = false;
        selected = null;
        onInvalid?.(INVALID_RECOVERY_MESSAGE);
      };
      const verify = () => {
        if (!current.active || subscription !== current) return;
        current.cancel?.();
        const attempt = ++current.attempt;
        const testOperationId = authTestOperationId();
        current.testOperationId = testOperationId;
        let outcome = 'ignored';
        current.state = 'checking';
        ready = false;
        selected = null;
        const controller = new AbortController();
        let cancel;
        const cancelled = new Promise((_, reject) => {
          cancel = () => reject(new DOMException('Verification cancelled.','AbortError'));
        });
        const timeout = new Promise((_, reject) => {
          const timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Verification timed out.'));
          },statusTimeoutMs);
          current.cancel = () => { clearTimeout(timer); controller.abort(); cancel(); };
        });
        const statusWork = Promise.resolve().then(() => readStatus({signal:controller.signal,
          verificationPurpose:'recovery-entry',testOperationId}));
        let statusSettled = false;
        if (testOperationId) void statusWork.then(() => { statusSettled = true; },
          () => { statusSettled = true; });
        void Promise.race([statusWork,timeout,cancelled]).then(status => {
          if (!current.active || subscription !== current || attempt !== current.attempt) return;
          if (status.recovery !== true || status.authenticated !== false) {
            current.state = 'invalid';
            outcome = 'invalid';
            onInvalid?.(INVALID_RECOVERY_MESSAGE);
            return;
          }
          selected = captureServerRecoveryContext(status.sessionName);
          ready = true;
          current.state = 'ready';
          outcome = 'ready';
          onReady?.();
        }).catch(error => {
          if (!current.active || subscription !== current || attempt !== current.attempt) return;
          ready = false;
          selected = null;
          if (error?.status === 401) {
            current.state = 'invalid';
            outcome = 'invalid';
            onInvalid?.(INVALID_RECOVERY_MESSAGE);
          } else {
            current.state = 'unavailable';
            outcome = 'unavailable';
            onUnavailable?.();
          }
        }).finally(() => {
          if (subscription === current && attempt === current.attempt) current.cancel?.();
          if (testOperationId) {
            const acknowledge = () => observeAuthTestOperation({
              kind:'recovery-verification-terminal',id:testOperationId,outcome });
            // Cancellation settles the controller before an abort-ignoring status read.
            // Its terminal test marker waits for that read to settle as well.
            if (outcome === 'ignored' && !statusSettled) void statusWork.then(acknowledge,acknowledge);
            else acknowledge();
          }
        });
      };
      globalThis.addEventListener?.('plannix-recovery-session-invalidated',invalidate);
      verify();
      const cleanup = () => {
        current.active = false;
        current.attempt += 1;
        current.cancel?.();
        if (subscription === current) { subscription = null; ready = false; selected = null; }
        globalThis.removeEventListener?.('plannix-recovery-session-invalidated',invalidate);
        if (current.testOperationId) observeAuthTestOperation({
          kind:'recovery-verification-disposed',id:current.testOperationId });
      };
      cleanup.retry = () => { if (current.state === 'unavailable') verify(); };
      return cleanup;
    },
    async update(password, confirmation) {
      const error = validateRecoveryPasswords(password, confirmation);
      if (error) throw new Error(error);
      if (!ready || submitting) throw recoveryError('recovery_invalid',INVALID_RECOVERY_MESSAGE);
      let operationContext;
      try { operationContext = captureServerRecoveryContext(selected?.sessionName); }
      catch { ready = false; selected = null;
        throw recoveryError('recovery_invalid',INVALID_RECOVERY_MESSAGE); }
      if (operationContext !== selected) { ready = false; selected = null;
        throw recoveryError('recovery_invalid',INVALID_RECOVERY_MESSAGE); }
      submitting = true;
      let response;
      try {
        response = await serverAuthFetch('/__stage3/auth/recovery/password', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ password }),
        }, { recoveryOperationContext:operationContext });
      } catch { if (selected === operationContext) { ready = false; selected = null; }
        throw recoveryError('recovery_unconfirmed',UNCONFIRMED_RECOVERY_MESSAGE); }
      finally { submitting = false; }
      if (response.headers.get('X-Plannix-Recovery-Outcome') === 'invalid-session') {
        if (selected === operationContext) { ready = false; selected = null; }
        throw recoveryError('recovery_invalid',INVALID_RECOVERY_MESSAGE);
      }
      if (response.status !== 204) { if (selected === operationContext) { ready = false; selected = null; }
        throw recoveryError('recovery_unconfirmed',UNCONFIRMED_RECOVERY_MESSAGE); }
      const wasCurrent = selected === operationContext;
      if (wasCurrent) { ready = false; selected = null; }
      if (!wasCurrent) return { sessionChanged:true };
      try {
        if (captureServerRecoveryContext(operationContext.sessionName) !== operationContext)
          return { sessionChanged:true };
      } catch { return { sessionChanged:true }; }
      try { notifyServerSessionChange(); } catch { /* A confirmed password update stays successful. */ }
      return { sessionChanged:false };
    },
  };
}
