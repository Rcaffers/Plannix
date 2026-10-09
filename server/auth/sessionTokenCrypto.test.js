import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createSessionTokenCipher, createSessionTokenCipherFromEnvironment } from './sessionTokenCrypto.js';

const sessionId = '12345678-1234-4123-8123-123456789abc';
const old = randomBytes(32); const next = randomBytes(32);

test('AES-256-GCM round trip binds session, purpose and token version', () => {
  const cipher = createSessionTokenCipher({ activeKeyId: 'one', keys: { one: old } });
  const envelope = cipher.encrypt({ sessionId, purpose: 'access', version: 1, token: 'synthetic-access' });
  assert.equal(cipher.decrypt({ sessionId, purpose: 'access', version: 1, envelope }), 'synthetic-access');
  assert.doesNotMatch(JSON.stringify(envelope), /synthetic-access/);
  for (const wrong of [
    { sessionId: '22345678-1234-4123-8123-123456789abc', purpose: 'access', version: 1 },
    { sessionId, purpose: 'refresh', version: 1 },
    { sessionId, purpose: 'access', version: 2 },
  ]) assert.throws(() => cipher.decrypt({ ...wrong, envelope }), /Session token unavailable/);
  assert.throws(() => cipher.decrypt({ sessionId, purpose: 'access', version: 1,
    envelope: { ...envelope, tag: 'A'.repeat(envelope.tag.length) } }), /Session token unavailable/);
  assert.throws(() => cipher.decrypt({ sessionId, purpose: 'access', version: 1,
    envelope: { ...envelope, data: envelope.data + 'A' } }), /Session token unavailable/);
});

test('rotation reads old and new envelopes until old key is removed', () => {
  const first = createSessionTokenCipher({ activeKeyId: 'one', keys: { one: old } });
  const oldEnvelope = first.encrypt({ sessionId, purpose: 'refresh', version: 1, token: 'old-synthetic' });
  const rotated = createSessionTokenCipher({ activeKeyId: 'two', keys: { one: old, two: next } });
  assert.equal(rotated.decrypt({ sessionId, purpose: 'refresh', version: 1, envelope: oldEnvelope }), 'old-synthetic');
  const newEnvelope = rotated.encrypt({ sessionId, purpose: 'refresh', version: 2, token: 'new-synthetic' });
  assert.equal(newEnvelope.kid, 'two');
  assert.equal(rotated.decrypt({ sessionId, purpose: 'refresh', version: 2, envelope: newEnvelope }), 'new-synthetic');
  const afterRemoval = createSessionTokenCipher({ activeKeyId: 'two', keys: { two: next } });
  assert.throws(() => afterRemoval.decrypt({ sessionId, purpose: 'refresh', version: 1,
    envelope: oldEnvelope }), /Session token unavailable/);
});

test('invalid keys, missing keys, malformed envelopes and oversized tokens fail safely', () => {
  assert.throws(() => createSessionTokenCipher({ activeKeyId: 'one', keys: {} }), /Session token unavailable/);
  assert.throws(() => createSessionTokenCipher({ activeKeyId: 'one', keys: { one: Buffer.alloc(16) } }), /Session token unavailable/);
  const cipher = createSessionTokenCipher({ activeKeyId: 'one', keys: { one: old } });
  assert.throws(() => cipher.encrypt({ sessionId, purpose: 'access', version: 1,
    token: 'x'.repeat(16385) }), /Session token unavailable/);
  assert.throws(() => cipher.decrypt({ sessionId, purpose: 'access', version: 1,
    envelope: { v: 1, kid: 'one', iv: 'bad', tag: 'bad', data: 'bad' } }), /Session token unavailable/);
});

test('server-only environment keyring requires canonical 256-bit keys and an active identifier', () => {
  const loaded = createSessionTokenCipherFromEnvironment({
    PLANNIX_SESSION_TOKEN_KEYS_JSON: JSON.stringify({ one: old.toString('base64url') }),
    PLANNIX_SESSION_TOKEN_ACTIVE_KEY_ID: 'one',
  });
  assert.equal(loaded.activeKeyId, 'one');
  assert.throws(() => createSessionTokenCipherFromEnvironment({
    PLANNIX_SESSION_TOKEN_KEYS_JSON: JSON.stringify({ one: 'bad' }),
    PLANNIX_SESSION_TOKEN_ACTIVE_KEY_ID: 'one',
  }), /Session token unavailable/);
  assert.throws(() => createSessionTokenCipherFromEnvironment({}), /Session token unavailable/);
});
