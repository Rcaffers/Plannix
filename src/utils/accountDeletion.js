import { ApiError, deleteAccount } from './api.js';
import { serverManagedAuth, captureServerOperationContext,
  assertServerOperationContext } from './serverAuthTransport.js';
import { authTestOperationId, observeAuthTestOperation } from './serverAuthTestObserver.js';

export const ACCOUNT_PASSWORD_MIN = 8;
export const ACCOUNT_PASSWORD_MAX = 128;

const STATUS_MESSAGES = Object.freeze({
  400: 'Enter a valid password between 8 and 128 characters.',
  401: 'Your session has expired. Please sign in again.',
  403: 'Password verification failed.',
  409: 'Account deletion is blocked. If you administer a school, assign another Organisation Admin before trying again.',
  429: 'Too many deletion attempts. Please wait before trying again.',
  503: 'Account deletion is temporarily unavailable. Please try again later.',
});

export class AccountDeletionError extends Error {
  constructor(message, requestId = null) {
    super(message);
    this.name = 'AccountDeletionError';
    this.requestId = requestId;
  }
}

export function validateDeletionPassword(password) {
  if (typeof password !== 'string' || password.length < ACCOUNT_PASSWORD_MIN || password.length > ACCOUNT_PASSWORD_MAX) {
    return STATUS_MESSAGES[400];
  }
  return null;
}

export function accountDeletionMessage(error) {
  return STATUS_MESSAGES[error?.status] || 'Could not delete your account. Please try again.';
}

export function createAccountDeletionController({
  getSession,
  requestDeletion = deleteAccount,
  clearSensitiveState,
  clearAuthenticatedUser,
  clearUserCaches,
  signOut,
  replaceLocation,
  isCapturedSessionCurrent = () => true,
  reconciliationDeadlineMs = 5000,
  initialVerificationDeadlineMs = 5000,
} = {}) {
  let submitting = false;
  let confirmedDeletion = null;
  let disposed = false;
  let activeStatusRequest = null;
  let finishDisposal;
  const disposal = new Promise(resolve => { finishDisposal = resolve; });

  async function reconcileConfirmedDeletion() {
    const captured = confirmedDeletion;
    if (!captured || disposed) return;
    const observedId = authTestOperationId();
    observeAuthTestOperation({ kind:'deletion-reconcile-start', id:observedId });
    let observedOutcome = 'unknown';
    try {
    let timer;
    let after;
    const statusRequest = new AbortController();
    activeStatusRequest = statusRequest;
    try {
      after = await Promise.race([
        getSession({ verifyLocal:false, signal:statusRequest.signal,
          testOperationId:observedId }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), reconciliationDeadlineMs); }),
        disposal,
      ]);
    } catch {
      if (disposed) return;
      throw new AccountDeletionError('Your account was deleted, but the current session could not be confirmed. Retry the session check.');
    } finally {
      clearTimeout(timer);
      statusRequest.abort();
      if (activeStatusRequest === statusRequest) activeStatusRequest = null;
    }
    if (disposed) return;
    // A newer local account may have appeared while the status request was pending.
    if (!isCapturedSessionCurrent(captured.sessionName,captured.userId,captured.generation)
      || (after?.serverManaged && after.sessionName !== captured.sessionName)) {
      confirmedDeletion = null;
      clearSensitiveState?.();
      observedOutcome = 'superseded';
      return;
    }
    if (after) {
      throw new AccountDeletionError('Your account was deleted, but the current session could not be confirmed. Retry the session check.');
    }
    confirmedDeletion = null;
    observedOutcome = 'signed-out';
    clearSensitiveState?.();
    clearAuthenticatedUser?.();
    clearUserCaches?.();
    try { await signOut?.(captured.sessionName); } catch { /* Already deleted; local cleanup is best effort. */ }
    if (disposed) return;
    replaceLocation?.('/');
    } finally {
      observeAuthTestOperation({ kind:'deletion-reconcile-terminal', id:observedId,
        outcome:disposed ? 'disposed' : observedOutcome });
    }
  }

  return {
    get isSubmitting() { return submitting; },
    get needsReconciliation() { return !!confirmedDeletion; },
    get isDisposed() { return disposed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      confirmedDeletion = null;
      activeStatusRequest?.abort();
      finishDisposal();
    },
    async retryReconciliation() {
      if (disposed || !confirmedDeletion) return;
      if (submitting) throw new AccountDeletionError('Account deletion is already in progress.');
      submitting = true;
      try { await reconcileConfirmedDeletion(); }
      finally { submitting = false; }
    },

    async submit(password) {
      if (disposed) return;
      if (confirmedDeletion) return this.retryReconciliation();
      const operationContext = serverManagedAuth ? captureServerOperationContext() : null;
      const validationMessage = validateDeletionPassword(password);
      if (validationMessage) throw new AccountDeletionError(validationMessage);
      if (submitting) throw new AccountDeletionError('Account deletion is already in progress.');
      submitting = true;
      try {
        let session;
        let timer;
        const initialRequest = new AbortController();
        activeStatusRequest = initialRequest;
        try {
          session = await Promise.race([
            getSession({ verifyLocal:true, signal:initialRequest.signal }),
            new Promise((_,reject) => { timer=setTimeout(() => reject(new Error('deadline')),
              initialVerificationDeadlineMs); }),
            disposal,
          ]);
        } catch {
          if (disposed) return;
          throw new AccountDeletionError('Your current session could not be confirmed. Please try again.');
        } finally {
          clearTimeout(timer);
          initialRequest.abort();
          if (activeStatusRequest === initialRequest) activeStatusRequest = null;
        }
        if (disposed) return;
        if (operationContext) {
          assertServerOperationContext(operationContext);
          if (session?.sessionName !== operationContext.sessionName
            || session?.userId !== operationContext.userId
            || session?.generation !== operationContext.generation)
            throw new AccountDeletionError('Your account changed. Reload before deleting it.');
        }
        const accessToken = session?.access_token;
        if (!accessToken && !session?.serverManaged) {
          throw new AccountDeletionError(STATUS_MESSAGES[401]);
        }
        try {
          await requestDeletion({ password, accessToken,
            ...(session?.serverManaged ? { expectedSessionName:session.sessionName,
              ...(operationContext ? { operationContext } : {}) } : {}) });
        } catch (error) {
          if (disposed) return;
          if (error instanceof AccountDeletionError) throw error;
          if (error instanceof ApiError) {
            throw new AccountDeletionError(accountDeletionMessage(error), error.requestId);
          }
          throw new AccountDeletionError(accountDeletionMessage(error));
        }
        if (disposed) return;

        if (session?.serverManaged) {
          confirmedDeletion = { sessionName:session.sessionName,
            userId:session.userId, generation:session.generation };
          await reconcileConfirmedDeletion();
          return;
        }

        clearSensitiveState?.();
        clearAuthenticatedUser?.();
        clearUserCaches?.();
        try { await signOut?.(); } catch { /* Auth user is already deleted; local cleanup is best effort. */ }
        if (disposed) return;
        replaceLocation?.('/');
      } finally {
        submitting = false;
      }
    },
  };
}
