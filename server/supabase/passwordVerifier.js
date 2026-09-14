import { createServerSupabaseClient } from './client.js';

const INVALID_PASSWORD = 'Password verification failed.';
const AUTH_UNAVAILABLE = 'Authentication service is temporarily unavailable.';

function publicError(statusCode, message) {
  return Object.assign(new Error(message), { expose: true, statusCode });
}

function unavailable(error) {
  if (error instanceof TypeError) return true;
  const status = Number(error?.status);
  return Number.isFinite(status) ? status === 0 || status >= 500 : true;
}

export function createPasswordVerifier({
  getClient = () => createServerSupabaseClient(),
} = {}) {
  return async function verifyPassword({ userId, email, password }) {
    let result;
    try {
      result = await getClient().auth.signInWithPassword({ email, password });
    } catch (error) {
      throw publicError(unavailable(error) ? 503 : 403,
        unavailable(error) ? AUTH_UNAVAILABLE : INVALID_PASSWORD);
    }

    if (result?.error) {
      const isUnavailable = unavailable(result.error);
      throw publicError(isUnavailable ? 503 : 403,
        isUnavailable ? AUTH_UNAVAILABLE : INVALID_PASSWORD);
    }
    if (!result?.data?.user?.id || String(result.data.user.id) !== String(userId)) {
      throw publicError(403, INVALID_PASSWORD);
    }
  };
}

export const verifySupabasePassword = createPasswordVerifier();
