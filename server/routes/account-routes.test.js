import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import express from 'express';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createAccountDeletionAdmin } from '../supabase/adminClient.js';
import { createPasswordVerifier } from '../supabase/passwordVerifier.js';
import { registerAccountRoutes } from './account-routes.js';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'account@example.test',
  email_confirmed_at: '2026-09-14T00:00:00Z',
};
const bearer = 'test.bearer.token';

async function createHarness({
  verifiedUser = user,
  verificationError = null,
  verifyPassword = async () => {},
  deleteUser = async () => ({ data: { user: null }, error: null }),
  rateLimit = (_req, _res, next) => next(),
  activeDeletions = new Set(),
} = {}) {
  const adminCalls = [];
  const requireAuth = createRequireSupabaseAuth({
    getClient: () => ({ auth: { getUser: async () => ({
      data: { user: verificationError ? null : verifiedUser },
      error: verificationError,
    }) } }),
  });
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '100kb' }));
  registerAccountRoutes({
    app,
    requireAuth,
    rateLimit,
    verifyPassword,
    getAdmin: () => ({ async deleteUser(...args) {
      adminCalls.push(args);
      return deleteUser(...args);
    } }),
    activeDeletions,
  });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return {
    adminCalls,
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}/account`,
  };
}

async function deletion(harness, {
  authorization = `Bearer ${bearer}`,
  body = { password: 'Correct password' },
  cookie,
  requestId = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421',
} = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Request-ID': requestId };
  if (authorization !== null) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return fetch(harness.url, { method: 'DELETE', headers, body: JSON.stringify(body) });
}

test('bearer authentication is mandatory and an old cookie cannot authenticate', async () => {
  const harness = await createHarness();
  try {
    for (const options of [
      { authorization: null },
      { authorization: 'Basic invalid', cookie: 'plannix_session=legacy' },
    ]) {
      const response = await deletion(harness, options);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { message: 'Authentication is required.' });
      assert.ok(response.headers.get('x-request-id'));
    }
    assert.equal(harness.adminCalls.length, 0);
  } finally {
    await harness.close();
  }
});

test('password body validation rejects missing, non-string, empty, and oversized values', async () => {
  const harness = await createHarness();
  try {
    for (const password of [undefined, 123, '', 'x'.repeat(1025)]) {
      const response = await deletion(harness, { body: password === undefined ? {} : { password } });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: 'A valid password is required.' });
    }
  } finally {
    await harness.close();
  }
});

test('password verification uses only validated identity and success hard-deletes it', async () => {
  const verificationCalls = [];
  const harness = await createHarness({
    verifyPassword: async (details) => verificationCalls.push(details),
  });
  try {
    const response = await deletion(harness, {
      body: { password: '  preserved password  ', email: 'attacker@example.test', userId: 'attacker' },
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.deepEqual(verificationCalls, [{
      userId: user.id,
      email: user.email,
      password: '  preserved password  ',
    }]);
    assert.deepEqual(harness.adminCalls, [[user.id]]);
  } finally {
    await harness.close();
  }
});

test('safe verification, conflict, outage, and unexpected Admin failures are mapped', async () => {
  const cases = [
    {
      verifyPassword: async () => { throw Object.assign(new Error('Password verification failed.'), { expose: true, statusCode: 403 }); },
      status: 403,
      message: 'Password verification failed.',
    },
    {
      deleteUser: async () => ({ error: { code: 'PLANNIX_ACCOUNT_DELETE_LAST_SCHOOL_ADMIN', message: 'raw database detail' } }),
      status: 409,
      message: 'Account deletion is blocked until the account issue is resolved.',
    },
    {
      deleteUser: async () => ({ error: { status: 503, message: 'raw outage' } }),
      status: 503,
      message: 'Account deletion service is temporarily unavailable.',
    },
    {
      deleteUser: async () => { throw new Error('raw unexpected failure'); },
      status: 500,
      message: 'Could not delete the account.',
    },
  ];
  for (const testCase of cases) {
    const captured = [];
    const original = console.error;
    console.error = (entry) => captured.push(String(entry));
    const harness = await createHarness(testCase);
    try {
      const response = await deletion(harness);
      assert.equal(response.status, testCase.status);
      assert.deepEqual(await response.json(), { message: testCase.message });
      const log = JSON.parse(captured.at(-1));
      assert.equal(log.requestId, '8e6ddc18-d0d9-4fbc-a036-b02028e9f421');
      const combined = captured.join('\n');
      for (const forbidden of [bearer, user.email, 'Correct password', 'raw database detail', 'raw outage', 'raw unexpected failure']) {
        assert.equal(combined.includes(forbidden), false);
      }
    } finally {
      console.error = original;
      await harness.close();
    }
  }
});

test('rate-limit errors preserve Retry-After and concurrent deletion is guarded', async () => {
  const limited = await createHarness({
    rateLimit: (_req, res, next) => {
      res.set('Retry-After', '60');
      next(Object.assign(new Error('Too many account deletion attempts. Please try again later.'), {
        expose: true,
        statusCode: 429,
      }));
    },
  });
  try {
    const response = await deletion(limited);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
  } finally {
    await limited.close();
  }

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const concurrent = await createHarness({ verifyPassword: () => pending });
  try {
    const first = deletion(concurrent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await deletion(concurrent);
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { message: 'Account deletion is already in progress.' });
    release();
    assert.equal((await first).status, 204);
    assert.equal(concurrent.adminCalls.length, 1);
  } finally {
    release?.();
    await concurrent.close();
  }
});

test('password verifier calls nonpersistent Supabase auth and requires matching user', async () => {
  const calls = [];
  const verifier = createPasswordVerifier({ getClient: () => ({ auth: {
    async signInWithPassword(credentials) {
      calls.push(credentials);
      return { data: { user }, error: null };
    },
  } }) });
  await verifier({ userId: user.id, email: user.email, password: 'Password value' });
  assert.deepEqual(calls, [{ email: user.email, password: 'Password value' }]);

  const mismatch = createPasswordVerifier({ getClient: () => ({ auth: {
    signInWithPassword: async () => ({ data: { user: { ...user, id: 'different' } }, error: null }),
  } }) });
  await assert.rejects(
    () => mismatch({ userId: user.id, email: user.email, password: 'Password value' }),
    (error) => error.statusCode === 403 && error.message === 'Password verification failed.',
  );
});

test('password verifier distinguishes invalid credentials from service outages', async () => {
  for (const [error, expectedStatus] of [
    [{ status: 400, code: 'invalid_credentials', message: 'raw invalid' }, 403],
    [{ status: 503, message: 'raw outage' }, 503],
  ]) {
    const verifier = createPasswordVerifier({ getClient: () => ({ auth: {
      signInWithPassword: async () => ({ data: null, error }),
    } }) });
    await assert.rejects(
      () => verifier({ userId: user.id, email: user.email, password: 'Password value' }),
      (failure) => failure.statusCode === expectedStatus,
    );
  }
});

test('Admin wrapper uses the secret client only for hard Auth deletion', async () => {
  const clientCalls = [];
  const deleteCalls = [];
  const admin = createAccountDeletionAdmin({
    config: {
      supabaseUrl: 'https://project.example.test',
      supabaseSecretKey: 'server-secret-placeholder',
    },
    createClientImpl: (...args) => {
      clientCalls.push(args);
      return { auth: { admin: { deleteUser: async (...deleteArgs) => {
        deleteCalls.push(deleteArgs);
        return { data: {}, error: null };
      } } } };
    },
  });
  await admin.deleteUser(user.id);
  assert.deepEqual(deleteCalls, [[user.id, false]]);
  assert.equal(clientCalls[0][0], 'https://project.example.test');
  assert.equal(clientCalls[0][1], 'server-secret-placeholder');
  assert.deepEqual(clientCalls[0][2], {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  assert.deepEqual(Object.keys(admin), ['deleteUser']);
});

test('production has exactly one account route and privileged code is server-only', () => {
  const serverSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.equal((serverSource.match(/registerAccountRoutes\(\{ app \}\)/g) || []).length, 1);
  assert.equal((serverSource.match(/app\.delete\(['"]\/account/g) || []).length, 0);
  for (const directory of ['src', 'dist']) {
    const files = [];
    const walk = (path) => {
      for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
        const child = `${path}/${entry.name}`;
        if (entry.isDirectory()) walk(child);
        else files.push(child);
      }
    };
    walk(directory);
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      assert.equal(source.includes('SUPABASE_SECRET_KEY'), false, file);
      assert.equal(source.includes('supabase/adminClient'), false, file);
    }
  }
  for (const file of fs.readdirSync('server/routes')) {
    if (file.startsWith('account-routes.') || !file.endsWith('.js')) continue;
    const source = fs.readFileSync(`server/routes/${file}`, 'utf8');
    assert.equal(source.includes('supabase/adminClient'), false, file);
  }
});
