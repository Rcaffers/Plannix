// Temporary operator probe for managed-ingress header rewriting. It never
// returns header values or makes an outbound/authenticated request.
import { timingSafeEqual } from 'node:crypto';
import { normalizedIp } from '../auth/distributedAuthLimiter.js';

export const INGRESS_DIAGNOSTIC_PATH = '/__operator/ingress-diagnostic';

const SYNTHETIC_VALUES = new Set([
  '192.0.2.77', '198.51.100.77', '203.0.113.77', '2001:db8::77',
]);

function keyBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value ? bytes : null;
}

function values(raw, name) {
  const found = [];
  for (let index = 0; index < raw.length; index += 2) {
    if (typeof raw[index] !== 'string' || typeof raw[index + 1] !== 'string') return null;
    if (raw[index].toLowerCase() === name) found.push(raw[index + 1]);
  }
  return found;
}

export function registerIngressDiagnostic({ app, enabled = 'false', token = '',
  authMode = 'bearer' } = {}) {
  if (!app?.use || !['true', 'false'].includes(enabled))
    throw new Error('Ingress diagnostic configuration is invalid.');
  const active = enabled === 'true';
  const expected = active ? keyBytes(token) : null;
  if (active && (!expected || authMode !== 'bearer'))
    throw new Error('Ingress diagnostic requires a separate operator token and bearer mode.');

  app.use(INGRESS_DIAGNOSTIC_PATH, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    if (!active || req.method !== 'GET' || req.originalUrl !== INGRESS_DIAGNOSTIC_PATH)
      return res.status(404).end();

    const raw = req.rawHeaders;
    if (!Array.isArray(raw) || raw.length % 2) return res.status(400).end();
    const authorization = values(raw, 'authorization');
    if (!authorization || authorization.length !== 1
      || !authorization[0].startsWith('Bearer ')) return res.status(404).end();
    const candidate = keyBytes(authorization[0].slice(7));
    if (!candidate || !timingSafeEqual(candidate, expected)) return res.status(404).end();

    const supplied = values(raw, 'x-plannix-diagnostic-synthetic-ip');
    if (!supplied || supplied.length !== 1 || !SYNTHETIC_VALUES.has(supplied[0]))
      return res.status(400).end();
    const identity = values(raw, 'do-connecting-ip');
    const forwarded = values(raw, 'x-forwarded-for');
    if (!identity || !forwarded) return res.status(400).end();
    const address = identity.length === 1 ? normalizedIp(identity[0]) : null;
    const valid = address !== null;
    return res.json({
      doConnectingIp: { present: identity.length > 0, count: identity.length,
        valid, matchesSynthetic: valid && address === supplied[0] },
      xForwardedFor: { present: forwarded.length > 0, count: forwarded.length },
    });
  });
}
