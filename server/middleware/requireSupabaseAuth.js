import { createServerSupabaseClient } from '../supabase/client.js';

const MAX_ACCESS_TOKEN_LENGTH = 8192;
const AUTH_REQUIRED = 'Authentication is required.';
const EMAIL_CONFIRMATION_REQUIRED = 'Email confirmation is required.';
const AUTH_SERVICE_UNAVAILABLE = 'Authentication service is temporarily unavailable.';

function publicError(statusCode, message) {
  return Object.assign(new Error(message), { expose: true, statusCode });
}

function authorizationValues(req) {
  const values = [];
  const raw = Array.isArray(req?.rawHeaders) ? req.rawHeaders : [];
  for (let index = 0; index < raw.length; index += 2) {
    if (String(raw[index] || '').toLowerCase() === 'authorization') {
      values.push(String(raw[index + 1] || ''));
    }
  }
  if (!raw.length && typeof req?.headers?.authorization === 'string') {
    values.push(req.headers.authorization);
  } else if (!raw.length && Array.isArray(req?.headers?.authorization)) {
    values.push(...req.headers.authorization.map(String));
  }
  return values;
}

export function readBearerToken(req) {
  const values = authorizationValues(req);
  if (values.length !== 1) return null;
  const header = values[0];
  const match = /^Bearer ([^\s,]+)$/i.exec(header);
  if (!match || !match[1] || match[1].length > MAX_ACCESS_TOKEN_LENGTH) return null;
  return match[1];
}

function isVerificationUnavailable(error) {
  if (error instanceof TypeError) return true;
  const status = Number(error?.status);
  if (Number.isFinite(status)) return status === 0 || status >= 500;
  return true;
}

export function createRequireSupabaseAuth({
  getClient = () => createServerSupabaseClient(),
} = {}) {
  return async function requireSupabaseAuth(req, res, next) {
    const accessToken = readBearerToken(req);
    if (!accessToken) {
      next(publicError(401, AUTH_REQUIRED));
      return;
    }

    let result;
    try {
      result = await getClient().auth.getUser(accessToken);
    } catch (error) {
      next(publicError(isVerificationUnavailable(error) ? 503 : 401,
        isVerificationUnavailable(error) ? AUTH_SERVICE_UNAVAILABLE : AUTH_REQUIRED));
      return;
    }

    if (result?.error) {
      const unavailable = isVerificationUnavailable(result.error);
      next(publicError(unavailable ? 503 : 401,
        unavailable ? AUTH_SERVICE_UNAVAILABLE : AUTH_REQUIRED));
      return;
    }

    const user = result?.data?.user;
    if (!user?.id) {
      next(publicError(401, AUTH_REQUIRED));
      return;
    }
    if (!user.email_confirmed_at) {
      next(publicError(403, EMAIL_CONFIRMATION_REQUIRED));
      return;
    }

    req.auth = {
      userId: String(user.id),
      email: typeof user.email === 'string' ? user.email : '',
      accessToken,
    };
    next();
  };
}

export const requireSupabaseAuth = createRequireSupabaseAuth();
