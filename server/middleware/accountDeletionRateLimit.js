import crypto from 'node:crypto';

const RATE_LIMIT_MESSAGE = 'Too many account deletion attempts. Please try again later.';

function publicError(retryAfterSeconds) {
  return Object.assign(new Error(RATE_LIMIT_MESSAGE), {
    expose: true,
    statusCode: 429,
    retryAfterSeconds,
  });
}

function defaultKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function createAccountDeletionRateLimit({
  limit = 3,
  windowMs = 15 * 60 * 1000,
  maxEntries = 10000,
  now = () => Date.now(),
  hash = defaultKey,
} = {}) {
  const entries = new Map();

  function prune(currentTime) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  function consume(key, currentTime) {
    const existing = entries.get(key);
    const entry = !existing || existing.expiresAt <= currentTime
      ? { count: 0, expiresAt: currentTime + windowMs }
      : existing;
    entry.count += 1;
    entries.delete(key);
    entries.set(key, entry);
    return entry;
  }

  const middleware = function accountDeletionRateLimit(req, res, next) {
    const currentTime = now();
    prune(currentTime);
    const userEntry = consume(`user:${hash(req.auth.userId)}`, currentTime);
    const ipEntry = consume(`ip:${hash(req.ip || req.socket?.remoteAddress || '')}`, currentTime);
    prune(currentTime);
    if (userEntry.count > limit || ipEntry.count > limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((Math.max(userEntry.expiresAt, ipEntry.expiresAt) - currentTime) / 1000),
      );
      res.set('Retry-After', String(retryAfterSeconds));
      next(publicError(retryAfterSeconds));
      return;
    }
    next();
  };

  middleware.entryCount = () => entries.size;
  return middleware;
}

// This limiter is intentionally per process. A shared store is required before
// horizontally scaling account deletion across multiple server instances.
export const accountDeletionRateLimit = createAccountDeletionRateLimit();
