import { ApiError, deleteAccount } from './api.js';

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
} = {}) {
  let submitting = false;

  return {
    get isSubmitting() { return submitting; },

    async submit(password) {
      const validationMessage = validateDeletionPassword(password);
      if (validationMessage) throw new AccountDeletionError(validationMessage);
      if (submitting) throw new AccountDeletionError('Account deletion is already in progress.');
      submitting = true;
      try {
        let session;
        try { session = await getSession(); } catch { throw new AccountDeletionError(STATUS_MESSAGES[401]); }
        const accessToken = session?.access_token;
        if (!accessToken) {
          throw new AccountDeletionError(STATUS_MESSAGES[401]);
        }
        try {
          await requestDeletion({ password, accessToken });
        } catch (error) {
          if (error instanceof AccountDeletionError) throw error;
          if (error instanceof ApiError) {
            throw new AccountDeletionError(accountDeletionMessage(error), error.requestId);
          }
          throw new AccountDeletionError(accountDeletionMessage(error));
        }

        clearSensitiveState?.();
        clearAuthenticatedUser?.();
        clearUserCaches?.();
        try { await signOut?.(); } catch { /* Auth user is already deleted; local cleanup is best effort. */ }
        replaceLocation?.('/');
      } finally {
        submitting = false;
      }
    },
  };
}
