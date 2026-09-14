import crypto from 'node:crypto';
import { accountDeletionRateLimit } from '../middleware/accountDeletionRateLimit.js';
import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createAccountDeletionAdmin } from '../supabase/adminClient.js';
import { verifySupabasePassword } from '../supabase/passwordVerifier.js';

const MAX_PASSWORD_LENGTH = 1024;
const inProgress = new Set();

function publicError(statusCode, message) {
  return Object.assign(new Error(message), { expose: true, statusCode });
}

function deletionKey(userId) {
  return crypto.createHash('sha256').update(String(userId)).digest('hex');
}

function classifyAdminError(error) {
  const approvedConflicts = new Set([
    'PLANNIX_ACCOUNT_DELETE_LAST_SCHOOL_ADMIN',
    'PLANNIX_ACCOUNT_DELETE_PERSONAL_MARKER_MISSING',
  ]);
  if (approvedConflicts.has(error?.code)) {
    return publicError(409, 'Account deletion is blocked until the account issue is resolved.');
  }
  const status = Number(error?.status);
  if (error instanceof TypeError || status === 0 || status === 502 || status === 503 || status === 504) {
    return publicError(503, 'Account deletion service is temporarily unavailable.');
  }
  return publicError(500, 'Could not delete the account.');
}

export function registerAccountRoutes({
  app,
  requireAuth = requireSupabaseAuth,
  rateLimit = accountDeletionRateLimit,
  verifyPassword = verifySupabasePassword,
  getAdmin = () => createAccountDeletionAdmin(),
  activeDeletions = inProgress,
} = {}) {
  app.delete('/account', requireAuth, rateLimit, async (req, res, next) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      next(publicError(400, 'A valid password is required.'));
      return;
    }

    const key = deletionKey(req.auth.userId);
    if (activeDeletions.has(key)) {
      next(publicError(409, 'Account deletion is already in progress.'));
      return;
    }
    activeDeletions.add(key);

    try {
      await verifyPassword({
        userId: req.auth.userId,
        email: req.auth.email,
        password,
      });
      const result = await getAdmin().deleteUser(req.auth.userId);
      if (result?.error) throw result.error;
      res.status(204).send();
    } catch (error) {
      if (error?.expose === true) {
        next(error);
      } else {
        next(classifyAdminError(error));
      }
    } finally {
      activeDeletions.delete(key);
    }
  });
}
