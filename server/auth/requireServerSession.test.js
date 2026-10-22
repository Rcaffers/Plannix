import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createRequireServerSession } from './requireServerSession.js';
import { createSessionRequestSecurity } from './sessionRequestSecurity.js';

const marker = `__Host-plannix-b-1=${'a'.repeat(43)}`;
const session = `__Host-plannix-s-2=${'b'.repeat(43)}`;
const cookie = `${marker}; ${session}`;
const sessionName = '__Host-plannix-s-2';
const csrfKey = Buffer.alloc(32, 7);

test('protected request uses combined selection once and rejects stale writes before mutation', async () => {
  const calls = [];
  let writes = 0;
  const repository = {
    async resolveForApplication(header) {
      calls.push('combined');
      assert.equal(header, cookie);
      return { state: 'current', header, sessionName, ownerId: 'synthetic-owner',
        sessionId: 'synthetic-session', tokenVersion: 1,
        accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' };
    },
    async resolve() { throw Error('separate selector must not run'); },
    async readTokens() { throw Error('separate inspection must not run'); },
  };
  const identity = { async validateAccess({ accessToken, expectedUserId }) {
    calls.push('provider');
    assert.equal(accessToken, 'synthetic-access');
    assert.equal(expectedUserId, 'synthetic-owner');
  } };
  const app = express();
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const guard = createRequireServerSession({ repository, identity, origin, csrfKey });
  app.post('/protected', guard, (_req, res) => { writes += 1; res.json({ ok: true }); });
  try {
    const baseHeaders = { Cookie: cookie, Origin: origin,
      'x-plannix-expected-session': sessionName,
      'x-plannix-csrf': createSessionRequestSecurity({ origin, csrfKey }).csrfFor(cookie) };
    const valid = await fetch(`${origin}/protected`, { method: 'POST', headers: baseHeaders });
    assert.equal(valid.status, 200);
    assert.deepEqual(calls, ['combined', 'provider']);
    assert.equal(writes, 1);
    for (const changed of [
      { 'x-plannix-expected-session': '__Host-plannix-s-3' },
      { 'x-plannix-csrf': 'invalid' },
      { Origin: 'http://localhost:9999' },
    ]) {
      const rejected = await fetch(`${origin}/protected`, { method: 'POST',
        headers: { ...baseHeaders, ...changed } });
      assert.ok([403, 409].includes(rejected.status));
      assert.equal(writes, 1);
    }
    assert.deepEqual(calls, ['combined', 'provider', 'combined', 'combined']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('combined selection with recovery or expired state never reaches application work', async () => {
  let providerCalls = 0;
  let writes = 0;
  for (const state of ['wrong-kind', 'expired', 'invalid', 'absent']) {
    const app = express();
    const server = createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    app.post('/protected', createRequireServerSession({
      repository: { async resolveForApplication() { return { state }; } },
      identity: { async validateAccess() { providerCalls += 1; } }, origin, csrfKey,
    }), (_req, res) => { writes += 1; res.end(); });
    try {
      const response = await fetch(`${origin}/protected`, { method: 'POST',
        headers: { Cookie: cookie, Origin: origin } });
      assert.equal(response.status, 401);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
  assert.equal(providerCalls, 0);
  assert.equal(writes, 0);
});
