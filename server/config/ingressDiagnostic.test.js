import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { INGRESS_DIAGNOSTIC_PATH, registerIngressDiagnostic } from './ingressDiagnostic.js';

const token = randomBytes(32).toString('base64url');
const baseHeaders = [
  ['Authorization', `Bearer ${token}`],
  ['X-Plannix-Diagnostic-Synthetic-IP', '192.0.2.77'],
];

async function harness(t, enabled = 'true') {
  const app = express();
  let authCalls = 0;
  registerIngressDiagnostic({ app, enabled, token, authMode: 'bearer' });
  app.get('/__stage3/auth/status', (_req, res) => {
    authCalls += 1;
    res.status(401).end();
  });
  app.use((_req, res) => res.status(404).end());
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const send = ({ path = INGRESS_DIAGNOSTIC_PATH, method = 'GET', headers = baseHeaders } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: server.address().port,
        path, method, headers: [['Host', '127.0.0.1'], ...headers] }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode,
          headers: response.headers, text: Buffer.concat(chunks).toString() }));
      });
      request.on('error', reject);
      request.end();
    });
  return { send, get authCalls() { return authCalls; } };
}

test('diagnostic is disabled by default and never routes into authentication', async t => {
  const h = await harness(t, 'false');
  const response = await h.send();
  assert.equal(response.status, 404);
  assert.equal(response.text, '');
  assert.equal(h.authCalls, 0);
  assert.equal((await h.send({ path: '/__stage3/auth/status' })).status, 401);
  assert.equal(h.authCalls, 1);
});

test('activation requires exact flag, independent 32-byte token and bearer mode', () => {
  const app = express();
  for (const enabled of ['TRUE', 'yes', '', true])
    assert.throws(() => registerIngressDiagnostic({ app, enabled, token }), /configuration/);
  for (const invalid of ['', 'short', Buffer.alloc(31).toString('base64url'),
    `${token}=`, token.replace(/.$/, 'A') + 'A'])
    assert.throws(() => registerIngressDiagnostic({ app, enabled: 'true', token: invalid }),
      /operator token/);
  assert.throws(() => registerIngressDiagnostic({ app, enabled: 'true', token,
    authMode: 'server' }), /bearer mode/);
});

test('operator authorization rejects absent, incorrect and duplicate raw headers without data', async t => {
  const h = await harness(t);
  for (const headers of [[], [['Authorization', 'Bearer invalid']],
    [['Authorization', `Bearer ${token}`], ['AUTHORIZATION', `Bearer ${token}`]]]) {
    const result = await h.send({ headers });
    assert.equal(result.status, 404);
    assert.equal(result.text, '');
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal(h.authCalls, 0);
});

test('raw ingress counts and synthetic comparison expose no address, cookie or query', async t => {
  const h = await harness(t);
  const result = await h.send({ headers: [...baseHeaders,
    ['do-connecting-ip', '192.0.2.77'], ['x-forwarded-for', 'forged-private-value'],
    ['Cookie', 'private-cookie-value']] });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.text), {
    doConnectingIp: { present: true, count: 1, valid: true, matchesSynthetic: true },
    xForwardedFor: { present: true, count: 1 },
  });
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.doesNotMatch(result.text, /192\.0\.2\.77|forged-private-value|private-cookie-value/);
  assert.doesNotMatch(result.text, new RegExp(token));
  assert.equal(h.authCalls, 0);
});

test('spoofed, duplicate, mixed-case, comma-joined and scoped values are distinguishable', async t => {
  const h = await harness(t);
  const spoofed = await h.send({ headers: [...baseHeaders,
    ['do-connecting-ip', '203.0.113.77'], ['x-forwarded-for', '192.0.2.77']] });
  assert.deepEqual(JSON.parse(spoofed.text), {
    doConnectingIp: { present: true, count: 1, valid: true, matchesSynthetic: false },
    xForwardedFor: { present: true, count: 1 },
  });
  const mixedCase = await h.send({ headers: [...baseHeaders,
    ['DO-CONNECTING-IP', '203.0.113.77']] });
  assert.deepEqual(JSON.parse(mixedCase.text).doConnectingIp,
    { present: true, count: 1, valid: true, matchesSynthetic: false });
  for (const headers of [
    [...baseHeaders, ['do-connecting-ip', '192.0.2.77'], ['DO-CONNECTING-IP', '203.0.113.77']],
    [...baseHeaders, ['do-connecting-ip', '192.0.2.77, 203.0.113.77']],
    [...baseHeaders, ['do-connecting-ip', 'fe80::1%eth0']],
    baseHeaders,
  ]) {
    const response = await h.send({ headers });
    assert.equal(response.status, 200);
    const report = JSON.parse(response.text);
    assert.equal(report.doConnectingIp.valid, false);
    assert.equal(report.doConnectingIp.matchesSynthetic, false);
    assert.equal(report.doConnectingIp.count, headers.filter(([name]) =>
      name.toLowerCase() === 'do-connecting-ip').length);
  }
  assert.equal(h.authCalls, 0);
});

test('comparison accepts only fixed documentation addresses; query, method and alternate path fail', async t => {
  const h = await harness(t);
  const badProbe = await h.send({ headers: [baseHeaders[0],
    ['x-plannix-diagnostic-synthetic-ip', '127.0.0.1'],
    ['do-connecting-ip', '192.0.2.77']] });
  assert.equal(badProbe.status, 400);
  for (const input of [{ path: `${INGRESS_DIAGNOSTIC_PATH}?code=private-value` },
    { path: `${INGRESS_DIAGNOSTIC_PATH}/extra` }, { method: 'HEAD' }]) {
    const result = await h.send(input);
    assert.equal(result.status, 404);
    assert.equal(result.text, '');
  }
  assert.equal(h.authCalls, 0);
});
