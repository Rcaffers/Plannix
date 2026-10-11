// Shared by the isolated auth router and the future cookie-authenticated API guard.
import { createHmac, timingSafeEqual } from 'node:crypto';

const safeMethod = new Set(['GET', 'HEAD', 'OPTIONS']);
const csrfHeader = 'x-plannix-csrf';
const error = (status, message) => Object.assign(new Error(message), { status });

function values(req, name) {
  const found = [];
  for (let index = 0; index < (req.rawHeaders?.length || 0); index += 2) {
    if (String(req.rawHeaders[index]).toLowerCase() === name) {
      found.push(String(req.rawHeaders[index + 1]));
    }
  }
  return found;
}

export function createSessionRequestSecurity({ origin, csrfKey }) {
  let trusted;
  try { trusted = new URL(origin); } catch { throw new Error('Exact application origin required.'); }
  if (!['https:', 'http:'].includes(trusted.protocol) || trusted.username || trusted.password
    || trusted.pathname !== '/' || trusted.search || trusted.hash
    || (trusted.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(trusted.hostname))
    || !Buffer.isBuffer(csrfKey) || csrfKey.length < 32) {
    throw new Error('Session request security is not configured.');
  }

  function guard(req) {
    const hosts = values(req, 'host');
    const cookies = values(req, 'cookie');
    const origins = values(req, 'origin');
    if (hosts.length !== 1 || hosts[0] !== trusted.host || cookies.length > 1
      || origins.length > 1 || String(req.originalUrl || '').split('?')[0].includes('%')) {
      throw error(400, 'Authentication request is invalid.');
    }
    if (origins.length && origins[0] !== trusted.origin
      || !safeMethod.has(req.method) && origins.length !== 1) {
      throw error(403, 'Request origin is invalid.');
    }
    return cookies[0] || '';
  }

  function csrfFor(header) {
    const parts = header.split(';').map(item => item.trim());
    const marker = parts.find(item => item.startsWith('__Host-plannix-b-'));
    const session = parts.find(item => item.startsWith('__Host-plannix-s-')
      || item.startsWith('__Host-plannix-r-')) || '';
    if (!marker) throw error(401, 'Authentication is required.');
    return createHmac('sha256', csrfKey).update(`plannix-stage3:${marker}:${session}`)
      .digest('base64url');
  }

  function verifyCsrf(req, header) {
    guard(req);
    if (safeMethod.has(req.method)) return;
    const candidate = req.headers[csrfHeader];
    const expected = csrfFor(header);
    if (typeof candidate !== 'string' || candidate.length !== expected.length
      || !timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) {
      throw error(403, 'Request verification failed.');
    }
  }

  return Object.freeze({ guard, csrfFor, verifyCsrf, origin: trusted.origin });
}
