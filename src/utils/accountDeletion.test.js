import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  ACCOUNT_PASSWORD_MAX,
  ACCOUNT_PASSWORD_MIN,
  AccountDeletionError,
  accountDeletionMessage,
  createAccountDeletionController,
  validateDeletionPassword,
} from './accountDeletion.js';
import { ApiError, deleteAccount } from './api.js';

const requestId = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';

function response({ status = 204, payload = null, id = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name.toLowerCase() === 'x-request-id' ? id : null },
    async json() {
      if (payload === null) throw new Error('empty body');
      return payload;
    },
  };
}

test('deletion API retrieves a bearer session externally and sends password only', async () => {
  const calls = [];
  await deleteAccount({
    password: 'Password value',
    accessToken: 'access-token-value',
    fetchImpl: async (...args) => { calls.push(args); return response(); },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/account$/);
  assert.equal(calls[0][1].method, 'DELETE');
  assert.equal(calls[0][1].credentials, 'omit');
  assert.deepEqual(calls[0][1].headers, {
    Authorization: 'Bearer access-token-value',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(calls[0][1].body), { password: 'Password value' });
  assert.equal(calls[0][1].body.includes('email'), false);
  assert.equal(calls[0][1].body.includes('userId'), false);
});

test('API errors retain only canonical request IDs and safe response messages', async () => {
  for (const [id, expected] of [
    [requestId, requestId],
    [requestId.toUpperCase(), null],
    ['not-a-request-id', null],
  ]) {
    await assert.rejects(
      () => deleteAccount({
        password: 'Password value',
        accessToken: 'access-token-value',
        fetchImpl: async () => response({
          status: 409,
          id,
          payload: { message: 'Safe deletion response.' },
        }),
      }),
      (error) => error instanceof ApiError
        && error.message === 'Safe deletion response.'
        && error.status === 409
        && error.requestId === expected,
    );
  }
});

test('password validation enforces the 8 to 128 character bounds without trimming', () => {
  assert.equal(ACCOUNT_PASSWORD_MIN, 8);
  assert.equal(ACCOUNT_PASSWORD_MAX, 128);
  for (const password of [undefined, 123, '', 'x'.repeat(7), 'x'.repeat(129)]) {
    assert.equal(typeof validateDeletionPassword(password), 'string');
  }
  assert.equal(validateDeletionPassword('x'.repeat(8)), null);
  assert.equal(validateDeletionPassword('x'.repeat(128)), null);
  assert.equal(validateDeletionPassword('        '), null);
});

test('every safe server status maps to a fixed deletion message', () => {
  const expected = new Map([
    [400, 'Enter a valid password between 8 and 128 characters.'],
    [401, 'Your session has expired. Please sign in again.'],
    [403, 'Password verification failed.'],
    [409, 'Account deletion is blocked. If you administer a school, assign another Organisation Admin before trying again.'],
    [429, 'Too many deletion attempts. Please wait before trying again.'],
    [503, 'Account deletion is temporarily unavailable. Please try again later.'],
    [500, 'Could not delete your account. Please try again.'],
  ]);
  for (const [status, message] of expected) {
    assert.equal(accountDeletionMessage({ status }), message);
  }
});

test('controller retrieves the current session and clears only user-specific state after success', async () => {
  const calls = [];
  const controller = createAccountDeletionController({
    getSession: async () => { calls.push('session'); return { access_token: 'access-token-value' }; },
    requestDeletion: async (details) => calls.push(['delete', details]),
    clearSensitiveState: () => calls.push('clear-password'),
    clearAuthenticatedUser: () => calls.push('clear-user'),
    clearUserCaches: () => calls.push('clear-caches'),
    signOut: async () => calls.push('sign-out'),
    replaceLocation: (path) => calls.push(['replace', path]),
  });
  await controller.submit('Password value');
  assert.deepEqual(calls, [
    'session',
    ['delete', { password: 'Password value', accessToken: 'access-token-value' }],
    'clear-password',
    'clear-user',
    'clear-caches',
    'sign-out',
    ['replace', '/'],
  ]);
  assert.equal(controller.isSubmitting, false);
});

test('missing sessions fail safely before deletion', async () => {
  let deleted = false;
  for (const getSession of [async () => null, async () => { throw new Error('raw session failure'); }]) {
    const controller = createAccountDeletionController({
      getSession,
      requestDeletion: async () => { deleted = true; },
    });
    await assert.rejects(
      () => controller.submit('Password value'),
      (error) => error instanceof AccountDeletionError
        && error.message === 'Your session has expired. Please sign in again.',
    );
  }
  assert.equal(deleted, false);
});

test('duplicate submission is blocked while the first request is pending', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const controller = createAccountDeletionController({
    getSession: async () => ({ access_token: 'access-token-value' }),
    requestDeletion: () => pending,
  });
  const first = controller.submit('Password value');
  await Promise.resolve();
  await assert.rejects(
    () => controller.submit('Password value'),
    /already in progress/,
  );
  release();
  await first;
});

test('sign-out failure cannot undo completed deletion or replacement redirect', async () => {
  const calls = [];
  const controller = createAccountDeletionController({
    getSession: async () => ({ access_token: 'access-token-value' }),
    requestDeletion: async () => calls.push('deleted'),
    clearSensitiveState: () => calls.push('clear-password'),
    clearAuthenticatedUser: () => calls.push('clear-user'),
    clearUserCaches: () => calls.push('clear-caches'),
    signOut: async () => { calls.push('sign-out'); throw new Error('raw sign-out failure'); },
    replaceLocation: (path) => calls.push(['replace', path]),
  });
  await controller.submit('Password value');
  assert.deepEqual(calls, [
    'deleted', 'clear-password', 'clear-user', 'clear-caches', 'sign-out', ['replace', '/'],
  ]);
});

test('safe errors retain a valid reference without exposing passwords or tokens', async () => {
  const secretPassword = 'Password value';
  const secretToken = 'access-token-value';
  const captured = [];
  const original = console.error;
  console.error = (...values) => captured.push(values.join(' '));
  const controller = createAccountDeletionController({
    getSession: async () => ({ access_token: secretToken }),
    requestDeletion: async () => {
      throw new ApiError('Safe deletion response.', { status: 409, requestId });
    },
  });
  try {
    await assert.rejects(
      () => controller.submit(secretPassword),
      (error) => error instanceof AccountDeletionError
        && error.requestId === requestId
        && error.message === accountDeletionMessage({ status: 409 }),
    );
  } finally {
    console.error = original;
  }
  assert.equal(captured.join('\n').includes(secretPassword), false);
  assert.equal(captured.join('\n').includes(secretToken), false);
});

test('Settings implements accessible staged confirmation and clears password state', () => {
  const source = fs.readFileSync(new URL('../pages/Settings.jsx', import.meta.url), 'utf8');
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /type="password"/);
  assert.match(source, /autoComplete="current-password"/);
  assert.match(source, /minLength=\{8\}/);
  assert.match(source, /maxLength=\{128\}/);
  assert.match(source, />\s*Delete account\s*</);
  assert.match(source, /Permanently delete account/);
  assert.match(source, />\s*Cancel\s*</);
  assert.match(source, /clearDeletionForm\(\)/);
  assert.match(source, /deletePasswordRef\.current = ''/);
  assert.doesNotMatch(source, /window\.(confirm|prompt)/);
});

test('production frontend has no legacy cookie-only deletion or privileged key reference', () => {
  const apiSource = fs.readFileSync(new URL('./api.js', import.meta.url), 'utf8');
  assert.match(apiSource, /'Authorization': `Bearer \$\{accessToken\}`/);
  assert.match(apiSource, /credentials: 'omit'/);
  assert.doesNotMatch(apiSource, /deleteAccount[\s\S]{0,500}credentials: 'include'/);

  const privilegedVariableName = ['SUPABASE', 'SECRET', 'KEY'].join('_');
  const privilegedClientPath = ['supabase', 'adminClient'].join('/');
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
      assert.equal(source.includes(privilegedVariableName), false, file);
      assert.equal(source.includes(privilegedClientPath), false, file);
    }
  }
});
