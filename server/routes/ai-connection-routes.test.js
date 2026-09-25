import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { registerAiConnectionRoutes } from './ai-connection-routes.js';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { requestId } from '../middleware/requestId.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { providerRegistry } from '../ai/providers.js';

const providers = Object.values(providerRegistry);
const key = 'fixture-credential-not-a-real-key-1234';
const reference = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';
const user = { id: 'confirmed-user', email_confirmed_at: '2026-01-01' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function harness(t, { authUser = user, rpc } = {}) {
  const calls = [], clients = [], logs = [];
  const original = console.error; console.error = value => logs.push(value);
  const app = express(); app.use(requestId);
  const requireAuth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async () => ({ data: { user: authUser } }) } }) });
  registerAiConnectionRoutes({ app, requireAuth, createRequestClient(auth) {
    clients.push(auth);
    return { async rpc(name, input) { calls.push({ name, input }); return rpc ? rpc(name, input) : { data: name.includes('delete') ? null : { provider: input.provider || 'openai', lastFour: '1234', active: true, vault_secret_id: 'private-vault-id', rawKey: key, providerLabel: key } }; } };
  } });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); console.error = original; });
  async function request(method, body, { authenticated = true, query = '', raw = false, headers = {} } = {}) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/connection${query}`, {
      method, headers: { ...(authenticated ? { Authorization: 'Bearer fixture-token' } : {}), 'X-Request-ID': reference,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
    });
    return { status: res.status, reference: res.headers.get('x-request-id'), cache: res.headers.get('cache-control'), body: await res.json() };
  }
  return { request, calls, clients, logs };
}
for (const provider of providers) {
  test(`connect ${provider.label}: request-scoped RPC and safe metadata only`, async t => {
    const h = await harness(t);
    const result = await h.request('POST', { provider: provider.id, apiKey: `  ${key}  ` });
    assert.equal(result.status, 201); assert.equal(result.reference, reference); assert.equal(result.cache, 'no-store');
    assert.deepEqual(h.calls, [{ name: 'plannix_create_personal_ai_connection', input: { provider: provider.id, api_key: key } }]);
    assert.deepEqual(h.clients, [{ userId: user.id, email: '', accessToken: 'fixture-token' }]);
    assert.deepEqual(result.body, { connection: { provider: provider.id, providerLabel: provider.label, lastFour: '1234', active: true } });
    for (const secret of [key, 'private-vault-id', 'fixture-token']) assert.ok(!JSON.stringify([result,h.logs]).includes(secret));
    assert.equal(provider.executionEnabled, false);
  });
  for (const destination of providers) {
    test(`replace ${provider.id} -> ${destination.id} makes one atomic RPC`, async t => {
      const h = await harness(t);
      const result = await h.request('PUT', { provider: destination.id, apiKey: key });
      assert.equal(result.status, 200); assert.equal(result.body.connection.providerLabel, destination.label);
      assert.deepEqual(h.calls, [{ name: 'plannix_replace_personal_ai_connection', input: { provider: destination.id, api_key: key } }]);
    });
  }
}
test('GET and DELETE call caller-scoped RPCs without any membership IDs', async t => {
  const h = await harness(t);
  assert.equal((await h.request('GET')).status, 200);
  assert.deepEqual((await h.request('DELETE')).body, { connection: null });
  assert.deepEqual(h.calls, [{ name: 'plannix_get_personal_ai_connection', input: {} }, { name: 'plannix_delete_personal_ai_connection', input: {} }]);
});
for (const method of ['GET','POST','PUT','DELETE']) {
  test(`${method} requires confirmed authentication`, async t => {
    const h = await harness(t, { authUser: { ...user, email_confirmed_at: null } });
    const body = ['POST','PUT'].includes(method) ? { provider: 'openai', apiKey: key } : undefined;
    assert.equal((await h.request(method, body, { authenticated: false })).status, 401);
    assert.equal((await h.request(method, body)).status, 403); assert.equal(h.calls.length, 0);
  });
}
test('strict allowlist rejects providers, IDs, models, destinations and invalid keys', async t => {
  const h = await harness(t);
  const base = { provider: 'google_gemini', apiKey: key };
  for (const extra of ['organisationId','organisation_user_id','membershipId','providerLabel','model','preferred_model','baseUrl','apiUrl','destination']) {
    assert.equal((await h.request('POST', { ...base, [extra]: 'untrusted' })).status, 400);
  }
  for (const provider of ['other','__proto__','constructor','Google Gemini','OPENAI',null,{}]) {
    assert.equal((await h.request('POST', { ...base, provider })).status, 400);
  }
  for (const apiKey of ['', '   ', 'abcd', null, 42, {}, 'x'.repeat(4097)]) {
    assert.equal((await h.request('PUT', { ...base, apiKey })).status, 400);
  }
  assert.equal((await h.request('DELETE', { membershipId: 'another-user' })).status, 400);
  assert.equal((await h.request('GET', undefined, { query: '?apiKey=do-not-log-this' })).status, 400);
  assert.equal(h.calls.length, 0); assert.ok(!h.logs.join('').includes('do-not-log-this'));
});
test('malformed and oversized JSON are safe and correlated without body logging', async t => {
  const h = await harness(t);
  for (const [body, status] of [[`{"apiKey":"${key}`,400], [JSON.stringify({ apiKey: key.repeat(300) }),413]]) {
    const result = await h.request('POST', body, { raw: true });
    assert.equal(result.status, status); assert.equal(result.reference, reference);
    assert.ok(!JSON.stringify(result).includes(key));
  }
  assert.ok(!h.logs.join('').includes(key)); assert.equal(h.calls.length, 0);
});
for (const code of ['22023','XX000','23505','P0002','42501']) {
  test(`database failure ${code} never exposes credentials or implementation errors`, async t => {
    const h = await harness(t, { rpc: () => ({ error: { code, message: `${key} private-vault-id`, details: key } }) });
    const result = await h.request('PUT', { provider: 'anthropic', apiKey: key });
    assert.ok(result.status >= 400); assert.equal(result.reference, reference);
    assert.ok(!JSON.stringify([result,h.logs]).includes(key)); assert.ok(!JSON.stringify([result,h.logs]).includes('private-vault-id'));
  });
}
test('unexpected thrown exceptions and invalid metadata fail closed', async t => {
  const h = await harness(t, { rpc: () => { throw Object.assign(Error(key), { expose: true }); } });
  const result = await h.request('PUT', { provider: 'openai', apiKey: key });
  assert.equal(result.status, 500); assert.ok(!JSON.stringify([result,h.logs]).includes(key));
});
test('duplicate in-flight writes are rejected and lock releases after failure', async t => {
  const gate = deferred(); let first = true;
  const h = await harness(t, { rpc: async () => { if (first) { first = false; return gate.promise; } return { data: null }; } });
  const pending = h.request('PUT', { provider: 'openai', apiKey: key });
  while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await h.request('PUT', { provider: 'google_gemini', apiKey: key })).status, 409);
  gate.resolve({ error: { code: 'XX000', message: key } }); await pending;
  assert.equal((await h.request('DELETE')).status, 200); assert.equal(h.calls.length, 2);
});

test('invalid or excessive metadata cannot escape the response whitelist', async t => {
  const h = await harness(t, { rpc: () => ({ data: { provider: 'openai', lastFour: key, active: true } }) });
  const result = await h.request('GET');
  assert.equal(result.status, 500); assert.ok(!JSON.stringify([result,h.logs]).includes(key));
});
