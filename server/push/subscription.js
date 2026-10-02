import { createHash } from 'node:crypto';

const HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const KEY = /^[A-Za-z0-9_-]+$/;

export function endpointHash(endpoint) {
  return createHash('sha256').update(endpoint).digest('hex');
}

export function validPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length < 30 || endpoint.length > 2048
    || /[\u0000-\u0020\u007f\\]/.test(endpoint)) return false;
  try {
    const url = new URL(endpoint);
    const windowsPush = /^[a-z0-9-]+\.(?:notify|wns)\.windows\.com$/.test(url.hostname);
    return url.href === endpoint && url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && (!url.port || url.port === '443') && (HOSTS.has(url.hostname) || windowsPush)
      && (windowsPush ? url.search.startsWith('?token=') && !url.search.includes('&') && url.search.length <= 1800
        : url.pathname.length > 1 && !url.search);
  } catch { return false; }
}

export function validPushSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'endpoint,keys'
    || !validPushEndpoint(value.endpoint)
    || !value.keys || typeof value.keys !== 'object' || Array.isArray(value.keys)
    || Object.keys(value.keys).sort().join(',') !== 'auth,p256dh') return false;
  const { auth, p256dh } = value.keys;
  return typeof auth === 'string' && auth.length >= 16 && auth.length <= 32 && KEY.test(auth)
    && typeof p256dh === 'string' && p256dh.length >= 80 && p256dh.length <= 128 && KEY.test(p256dh);
}

export const TEST_PUSH_PAYLOAD = JSON.stringify({ type: 'plannix-test', version: 1 });
