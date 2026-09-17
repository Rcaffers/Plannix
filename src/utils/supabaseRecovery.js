import { createSupabaseAuthAdapter } from './supabaseAuth.js';

export const RECOVERY_ACKNOWLEDGEMENT =
  'If an account exists for that email, you will receive a password reset link shortly.';
export const INVALID_RECOVERY_MESSAGE =
  'This password reset link is invalid or has expired. Request a new link from the log in screen.';
export const RECOVERY_UPDATE_ERROR =
  'Your password could not be updated. Please request a new reset link and try again.';
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export function validateRecoveryPasswords(password, confirmation) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be no more than ${MAX_PASSWORD_LENGTH} characters.`;
  if (password !== confirmation) return 'Passwords do not match.';
  return null;
}

export function createSupabaseRecoveryController({
  auth = createSupabaseAuthAdapter(),
  schedule = (task) => queueMicrotask(task),
  deferInvalid = (task) => setTimeout(task, 0),
  history = globalThis.history,
  location = globalThis.location,
} = {}) {
  let recoveryToken = null;
  let updatePromise = null;

  function clearSensitiveUrl() {
    if (typeof history?.replaceState !== 'function' || !location?.pathname) return;
    history.replaceState(history.state ?? null, '', location.pathname);
  }

  return {
    async request(email) {
      try { await auth.sendPasswordRecovery(email); } catch { /* acknowledgement remains generic */ }
      return RECOVERY_ACKNOWLEDGEMENT;
    },

    subscribe({ onReady, onInvalid }) {
      let active = true;
      let settled = false;
      const cleanup = auth.subscribeToAuthChanges(({ event, session }) => {
        schedule(async () => {
          if (!active || settled) return;
          if (event !== 'PASSWORD_RECOVERY') {
            if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
              deferInvalid(() => {
                if (!active || settled) return;
                settled = true;
                onInvalid?.(INVALID_RECOVERY_MESSAGE);
              });
            }
            return;
          }
          try {
            const current = await auth.getCurrentSession();
            if (!session?.access_token || current?.access_token !== session.access_token) throw new Error('invalid');
            const validated = await auth.validateRecoverySession(session.access_token);
            if (!validated?.userId) throw new Error('invalid');
            recoveryToken = session.access_token;
            settled = true;
            clearSensitiveUrl();
            if (active) onReady?.();
          } catch {
            recoveryToken = null;
            settled = true;
            if (active) onInvalid?.(INVALID_RECOVERY_MESSAGE);
          }
        });
      });
      return () => { active = false; cleanup?.(); };
    },

    async update(password, confirmation) {
      const validation = validateRecoveryPasswords(password, confirmation);
      if (validation) throw new Error(validation);
      if (!recoveryToken) throw new Error(INVALID_RECOVERY_MESSAGE);
      if (updatePromise) return updatePromise;
      updatePromise = (async () => {
        try {
          await auth.updatePasswordDuringRecovery(password);
        } catch {
          throw new Error(RECOVERY_UPDATE_ERROR);
        }
        recoveryToken = null;
        try {
          if (typeof auth.logoutLocal === 'function') await auth.logoutLocal();
          else await auth.logout();
        } catch { /* local recovery access is still cleared */ }
      })();
      try {
        return await updatePromise;
      } finally {
        updatePromise = null;
      }
    },
  };
}

let defaultController;
function getDefaultController() {
  defaultController ||= createSupabaseRecoveryController();
  return defaultController;
}

export const supabaseRecovery = {
  request: (...args) => getDefaultController().request(...args),
  subscribe: (...args) => getDefaultController().subscribe(...args),
  update: (...args) => getDefaultController().update(...args),
};
