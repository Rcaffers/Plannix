import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createSessionTokenCipher } from './sessionTokenCrypto.js';
import { createPrivateSessionRepository, parsePrivateSessionCookies } from './privateSessionRepository.js';

const cipher = createSessionTokenCipher({ activeKeyId: 'test', keys: { test: randomBytes(32) } });
const marker = `__Host-plannix-b-1=${'a'.repeat(43)}`;
const session = `__Host-plannix-s-2=${'b'.repeat(43)}`;
const sessionId = '12345678-1234-4123-8123-123456789abc';

test('cookie parser rejects duplicates, malformed names and over-limit state without cleanup', () => {
  assert.equal(parsePrivateSessionCookies(`${marker}; ${session}`).state, 'parsed');
  for (const header of [`${marker}; ${marker}`, `${marker}; __Host-plannix-s-0=x`,
    `${marker}; x=${'x'.repeat(4096)}`,
    Array.from({ length: 5 }, (_, i) => `__Host-plannix-b-${i + 1}=${'a'.repeat(43)}`).join('; ')]) {
    assert.deepEqual(parsePrivateSessionCookies(header), { state: 'invalid', markers: [], sessions: [] });
  }
});

test('repository stores only hashes and encrypted envelopes through its RPC transport', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'plannix_auth_issue_binding') return { data: { state: 'issued', name: '__Host-plannix-b-1' } };
    if (name === 'plannix_auth_begin') return { data: { state: 'started', intentId: sessionId, generation: 2 } };
    if (name === 'plannix_auth_settle') return { data: { state: 'created', kind: 'ordinary', generation: 2 } };
    if (name === 'plannix_auth_inspect') return { data: { state: 'current', ownerId: 'synthetic-owner',
      sessionId, tokenVersion: 1, accessEnvelope: args.access_cipher,
      refreshEnvelope: args.refresh_cipher } };
    return { data: { state: 'rejected' } };
  };
  const repo = createPrivateSessionRepository({ rpc, cipher, generateSecret: () => 'a'.repeat(43) });
  const binding = await repo.issueBinding();
  assert.match(binding.setCookie, /Secure; HttpOnly; SameSite=Lax$/);
  assert.equal((await repo.begin(marker)).state, 'started');
  const created = await repo.settle(sessionId, 'created', { confirmedOwnerId: 'synthetic-owner',
    accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
  assert.equal(created.state, 'created');
  assert.match(created.setCookie, /^__Host-plannix-s-2=/);
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /synthetic-access|synthetic-refresh|=a{43}/);
  assert.equal(calls[0].args.target_hash.length, 64);
  assert.equal(calls[2].args.access_cipher.kid, 'test');
  assert.equal((await repo.inspect(`${marker}; ${session}; ${session}`)).state, 'invalid');
  assert.equal(calls.length, 3, 'ambiguous request does not call an RPC');
});

test('invalid secret generation settles failure without revoking an existing session', async () => {
  const calls = [];
  const repo = createPrivateSessionRepository({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: { state: args.outcome || 'failed' } };
  }, cipher, generateSecret: () => 'invalid' });
  assert.equal((await repo.settle(sessionId, 'created', { confirmedOwnerId: 'synthetic-owner',
    accessToken: 'a', refreshToken: 'r' })).state, 'failed');
  assert.equal(calls[0].args.outcome, 'failed');
  assert.equal(calls[0].args.target_hash, null);
});

test('signed-in begin passes exactly one current-cookie proof to the RPC', async () => {
  const calls = [];
  const repo = createPrivateSessionRepository({ rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { state: 'started' } };
  }, cipher });
  assert.equal((await repo.begin(`${marker}; ${session}`)).state, 'started');
  assert.equal(calls[0].name, 'plannix_auth_begin');
  assert.equal(calls[0].args.session_name, '__Host-plannix-s-2');
  assert.match(calls[0].args.provided_session_hash, /^[0-9a-f]{64}$/);
  assert.equal((await repo.begin(`${marker}; ${session}; __Host-plannix-s-3=${'c'.repeat(43)}`)).state,
    'ambiguous');
  assert.equal(calls.length, 1);
});

test('rejected session proof and expired completion issue no cookie or cleanup', async () => {
  const repo = createPrivateSessionRepository({ rpc: async name => ({ data: {
    state: name === 'plannix_auth_begin' ? 'invalid' : 'expired',
  } }), cipher, generateSecret: () => 'a'.repeat(43) });
  assert.deepEqual(await repo.begin(`${marker}; ${session}`), { state: 'invalid' });
  assert.deepEqual(await repo.settle(sessionId, 'created', {
    confirmedOwnerId: 'synthetic-owner', accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
  }), { state: 'expired' });
});

test('transport failures are generic and expose no diagnostics', async () => {
  const repo = createPrivateSessionRepository({ rpc: async () => { throw Error('private diagnostic synthetic-secret'); }, cipher });
  await assert.rejects(repo.begin(marker), error => error.message === 'Session service unavailable.');
});
