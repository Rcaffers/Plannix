// Server-only token envelopes. This module is deliberately not imported by app.js.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL = /^[A-Za-z0-9_-]+$/;
const genericError = () => new Error('Session token unavailable.');

function context(sessionId, purpose, version) {
  if (!UUID.test(sessionId) || !['access', 'refresh'].includes(purpose)
    || !Number.isSafeInteger(version) || version < 1) throw genericError();
  return Buffer.from(`plannix-session-token:v1:${sessionId.toLowerCase()}:${purpose}:${version}`, 'utf8');
}

export function createSessionTokenCipher({ activeKeyId, keys }) {
  if (!KEY_ID.test(activeKeyId || '') || !keys || typeof keys !== 'object') throw genericError();
  const keyring = new Map();
  for (const [id, key] of Object.entries(keys)) {
    if (!KEY_ID.test(id) || !Buffer.isBuffer(key) || key.length !== 32) throw genericError();
    keyring.set(id, Buffer.from(key));
  }
  if (!keyring.has(activeKeyId)) throw genericError();

  function encrypt({ sessionId, purpose, version, token }) {
    const aad = context(sessionId, purpose, version);
    if (typeof token !== 'string' || !token.length || Buffer.byteLength(token, 'utf8') > 16384) {
      throw genericError();
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyring.get(activeKeyId), iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return { v: 1, kid: activeKeyId, iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') };
  }

  function decrypt({ sessionId, purpose, version, envelope }) {
    const aad = context(sessionId, purpose, version);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).sort().join(',') !== 'data,iv,kid,tag,v'
      || envelope.v !== 1 || !KEY_ID.test(envelope.kid || '')
      || !keyring.has(envelope.kid)
      || ![envelope.iv, envelope.tag, envelope.data].every(value =>
        typeof value === 'string' && B64URL.test(value) && value.length <= 22000)) {
      throw genericError();
    }
    const iv = Buffer.from(envelope.iv, 'base64url');
    const tag = Buffer.from(envelope.tag, 'base64url');
    const data = Buffer.from(envelope.data, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || data.length > 16384
      || iv.toString('base64url') !== envelope.iv || tag.toString('base64url') !== envelope.tag
      || data.toString('base64url') !== envelope.data) throw genericError();
    try {
      const decipher = createDecipheriv('aes-256-gcm', keyring.get(envelope.kid), iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch { throw genericError(); }
  }

  return Object.freeze({ encrypt, decrypt, activeKeyId });
}

// Call explicitly at server startup in a later stage; importing this module
// never reads credentials or enables session management.
export function createSessionTokenCipherFromEnvironment(environment) {
  try {
    const encoded = JSON.parse(environment?.PLANNIX_SESSION_TOKEN_KEYS_JSON || '');
    if (!encoded || typeof encoded !== 'object' || Array.isArray(encoded)
      || Object.keys(encoded).length < 1 || Object.keys(encoded).length > 8) throw genericError();
    const keys = {};
    for (const [id, value] of Object.entries(encoded)) {
      if (!KEY_ID.test(id) || typeof value !== 'string' || !B64URL.test(value)) throw genericError();
      const decoded = Buffer.from(value, 'base64url');
      if (decoded.length !== 32 || decoded.toString('base64url') !== value) throw genericError();
      keys[id] = decoded;
    }
    return createSessionTokenCipher({ activeKeyId: environment.PLANNIX_SESSION_TOKEN_ACTIVE_KEY_ID, keys });
  } catch { throw genericError(); }
}
