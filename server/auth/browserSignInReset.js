// Reset-only proof: no authentication authority and no raw cookie data in output.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parsePrivateSessionCookies } from './privateSessionRepository.js';

export function orphanContext(header) {
  const parsed = parsePrivateSessionCookies(header);
  if (parsed.state !== 'parsed' || parsed.markers.length || parsed.sessions.length !== 1
    || !/^__Host-plannix-s-[1-9][0-9]{0,15}$/.test(parsed.sessions[0].name)) return null;
  return { markers: [], sessions: parsed.sessions };
}

export function createBrowserResetProofs({ key, origin, now = Date.now }) {
  const mac = value => createHmac('sha256', key)
    .update(`plannix-browser-reset-v1\0${origin}\0${value}`).digest('base64url');
  const contextHash = context => mac(JSON.stringify(context));
  return Object.freeze({
    issue(context) {
      const payload = Buffer.from(JSON.stringify({ expires: now() + 60000,
        nonce: randomBytes(32).toString('base64url'), context: contextHash(context) })).toString('base64url');
      return `${payload}.${mac(payload)}`;
    },
    verify(proof, context) {
      if (typeof proof !== 'string' || proof.length > 1024 || !context) return null;
      const parts = proof.split('.');
      if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0])
        || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
      const expected = mac(parts[0]);
      if (parts[1].length !== expected.length
        || !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null;
      try {
        const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        if (!Number.isSafeInteger(value.expires) || value.expires <= now()
          || value.expires > now() + 60000 || value.context !== contextHash(context)
          || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce)) return null;
        return { hash: createHash('sha256').update(proof).digest('hex'),
          expiresAt: new Date(value.expires).toISOString() };
      } catch { return null; }
    },
  });
}
