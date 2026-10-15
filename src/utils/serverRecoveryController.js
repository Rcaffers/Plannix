import { bootstrapServerSession, notifyServerSessionChange,
  serverAuthFetch, serverSessionStatus } from './serverAuthTransport.js';
import { INVALID_RECOVERY_MESSAGE, RECOVERY_ACKNOWLEDGEMENT,
  RECOVERY_UPDATE_ERROR, validateRecoveryPasswords } from './supabaseRecovery.js';

export function createServerRecoveryController() {
  let ready = false;
  let submitting = false;
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
    subscribe({ onReady, onInvalid }) {
      let active = true;
      void serverSessionStatus().then(status => {
        if (!active) return;
        ready = status.recovery === true && status.authenticated === false;
        if (ready) onReady?.(); else onInvalid?.(INVALID_RECOVERY_MESSAGE);
      }, () => { if (active) onInvalid?.(INVALID_RECOVERY_MESSAGE); });
      return () => { active = false; };
    },
    async update(password, confirmation) {
      const error = validateRecoveryPasswords(password, confirmation);
      if (error) throw new Error(error);
      if (!ready || submitting) throw new Error(INVALID_RECOVERY_MESSAGE);
      submitting = true;
      try {
        const response = await serverAuthFetch('/__stage3/auth/recovery/password', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ password }),
        });
        if (!response.ok) throw new Error(RECOVERY_UPDATE_ERROR);
        ready = false;
        notifyServerSessionChange();
      } catch { throw new Error(RECOVERY_UPDATE_ERROR); }
      finally { submitting = false; }
    },
  };
}
