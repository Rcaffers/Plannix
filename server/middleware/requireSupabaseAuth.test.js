import assert from 'node:assert/strict';
import test from 'node:test';
import cors from 'cors';
import express from 'express';
import { corsDelegate } from '../config/cors.js';
import { errorHandler } from './errorHandler.js';
import { requestId } from './requestId.js';
import {
  createRequestSupabaseClient,
  createServerSupabaseClient,
} from '../supabase/client.js';
import {
  createRequireSupabaseAuth,
  readBearerToken,
} from './requireSupabaseAuth.js';

const token = 'valid.jwt.token';
const confirmedUser = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'person@example.test',
  email_confirmed_at: '2026-09-14T00:00:00Z',
};

function request(authorization, extra = {}) {
  const rawHeaders = authorization === undefined
    ? []
    : Array.isArray(authorization)
      ? authorization.flatMap((value) => ['Authorization', value])
      : ['Authorization', authorization];
  return {
    headers: { authorization: Array.isArray(authorization) ? authorization : authorization },
    rawHeaders,
    body: extra.body,
    id: extra.id || '8e6ddc18-d0d9-4fbc-a036-b02028e9f421',
    method: 'GET',
    path: '/protected',
  };
}

async function invoke(options = {}) {
  const { result, thrown, extra } = options;
  const authorization = Object.hasOwn(options, 'authorization')
    ? options.authorization
    : `Bearer ${token}`;
  const calls = [];
  const middleware = createRequireSupabaseAuth({
    getClient: () => ({ auth: { async getUser(received) {
      calls.push(['getUser', received]);
      if (thrown) throw thrown;
      return result || { data: { user: confirmedUser }, error: null };
    } } }),
  });
  const req = request(authorization, extra);
  const nextCalls = [];
  await middleware(req, {}, (error) => nextCalls.push(error));
  return { calls, req, nextCalls };
}

test('missing, duplicated, malformed, blank, and oversized bearer values are rejected before verification', async () => {
  const invalid = [
    undefined,
    [`Bearer ${token}`, `Bearer ${token}`],
    `Basic ${token}`,
    'Bearer ',
    'Bearer token with spaces',
    `Bearer ${'x'.repeat(8193)}`,
  ];
  for (const authorization of invalid) {
    const outcome = await invoke({ authorization });
    assert.equal(outcome.calls.length, 0);
    assert.equal(outcome.nextCalls.length, 1);
    assert.equal(outcome.nextCalls[0].statusCode, 401);
    assert.equal(outcome.nextCalls[0].message, 'Authentication is required.');
  }
  assert.equal(readBearerToken(request(`Bearer ${token}`)), token);
});

test('invalid and expired tokens receive the same safe 401 response', async () => {
  for (const code of ['bad_jwt', 'session_expired']) {
    const outcome = await invoke({ result: { data: { user: null }, error: { code, status: 401 } } });
    assert.equal(outcome.nextCalls[0].statusCode, 401);
    assert.equal(outcome.nextCalls[0].message, 'Authentication is required.');
  }
});

test('confirmed validated users proceed exactly once and attacker user IDs are ignored', async () => {
  const outcome = await invoke({ extra: { body: { userId: 'attacker' } } });
  outcome.req.headers['x-user-id'] = 'attacker';
  assert.deepEqual(outcome.calls, [['getUser', token]]);
  assert.deepEqual(outcome.req.auth, {
    userId: confirmedUser.id,
    email: confirmedUser.email,
    accessToken: token,
  });
  assert.deepEqual(outcome.nextCalls, [undefined]);
});

test('validated users with unconfirmed email receive safe 403 and never proceed', async () => {
  const outcome = await invoke({ result: { data: { user: { ...confirmedUser, email_confirmed_at: null } }, error: null } });
  assert.equal(outcome.req.auth, undefined);
  assert.equal(outcome.nextCalls.length, 1);
  assert.equal(outcome.nextCalls[0].statusCode, 403);
  assert.equal(outcome.nextCalls[0].message, 'Email confirmation is required.');
});

test('verification outages return 503 while explicit verification failures remain 401', async () => {
  for (const failure of [new TypeError('network unavailable'), { status: 503, message: 'upstream detail' }]) {
    const outcome = await invoke({ thrown: failure });
    assert.equal(outcome.nextCalls[0].statusCode, 503);
    assert.equal(outcome.nextCalls[0].message, 'Authentication service is temporarily unavailable.');
  }
  const explicitInvalid = await invoke({ thrown: { status: 401, message: 'raw auth detail' } });
  assert.equal(explicitInvalid.nextCalls[0].statusCode, 401);
  const unknown = await invoke({ thrown: new Error('SDK failure') });
  assert.equal(unknown.nextCalls[0].statusCode, 503);
});

test('central errors retain request IDs without logging tokens or emails', async () => {
  const outcome = await invoke({ result: { data: null, error: { status: 401, message: confirmedUser.email } } });
  const captured = [];
  const original = console.error;
  console.error = (value) => captured.push(String(value));
  try {
    const req = outcome.req;
    const response = {
      req,
      headersSent: false,
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
    };
    errorHandler(outcome.nextCalls[0], req, response, () => {});
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { message: 'Authentication is required.' });
  } finally {
    console.error = original;
  }
  assert.equal(captured.length, 1);
  const log = JSON.parse(captured[0]);
  assert.equal(log.requestId, outcome.req.id);
  assert.equal(captured[0].includes(token), false);
  assert.equal(captured[0].includes(confirmedUser.email), false);
});

test('server clients use only public configuration with all browser session features disabled', () => {
  const calls = [];
  const config = { supabaseUrl: 'https://project.example.test', supabasePublishableKey: 'publishable-key' };
  const createClientImpl = (...args) => { calls.push(args); return { call: calls.length }; };
  createServerSupabaseClient({ config, createClientImpl });
  createRequestSupabaseClient({ userId: 'user-one', accessToken: 'token-one' }, { config, createClientImpl });
  createRequestSupabaseClient({ userId: 'user-two', accessToken: 'token-two' }, { config, createClientImpl });
  assert.deepEqual(calls[0], [config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }]);
  assert.equal(calls[1][1], config.supabasePublishableKey);
  assert.equal(calls[1][2].global.headers.Authorization, 'Bearer token-one');
  assert.equal(calls[2][2].global.headers.Authorization, 'Bearer token-two');
  assert.notEqual(calls[1][2].global.headers, calls[2][2].global.headers);
});

test('CORS preflight permits Authorization for an allowed origin without changing credentials policy', async () => {
  const app = express();
  app.use(requestId);
  app.use(cors(corsDelegate));
  app.get('/protected', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/protected`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-headers') || '', /Authorization/i);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
