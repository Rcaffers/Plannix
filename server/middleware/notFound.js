import { sendPublicError } from './errorHandler.js';

const API_PREFIXES = ['/account', '/admin', '/api', '/auth', '/holidays'];
const REMOVED_API_PATHS = new Set([
  '/billing/portal-session',
  '/billing/subscription-summary',
  '/stripe/webhook',
]);

export function notFound(req, res, next) {
  const isApiRequest =
    REMOVED_API_PATHS.has(req.path) ||
    API_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`));
  if (!isApiRequest && req.accepts('html')) {
    next();
    return;
  }
  return sendPublicError(
    res,
    `No API route found for ${req.method} ${req.originalUrl}.`,
    404,
  );
}
