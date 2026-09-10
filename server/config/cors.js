import { env } from './env.js';

export function inferredPublicOrigin(req) {
  const host = String(req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim();
  if (!host) return '';

  let protocol = String(req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http'))
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (protocol !== 'https' && protocol !== 'http') protocol = 'https';
  if (host.endsWith('.ondigitalocean.app') && protocol === 'http') protocol = 'https';
  return `${protocol}://${host}`;
}

export function corsDelegate(req, callback) {
  const requestOrigin = req.headers.origin;
  const inferredOrigin = inferredPublicOrigin(req);
  const allowed =
    !requestOrigin ||
    env.frontendOrigins.includes(requestOrigin) ||
    Boolean(inferredOrigin && requestOrigin === inferredOrigin);

  if (!allowed && env.corsDebug) {
    // eslint-disable-next-line no-console
    console.error('[cors] blocked', {
      requestOrigin,
      allowedOrigins: env.frontendOrigins,
      inferredOrigin,
      host: req.get('host'),
    });
  }
  callback(null, { origin: allowed, credentials: true });
}
