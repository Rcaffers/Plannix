import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  INVALID_RECOVERY_MESSAGE,
  RECOVERY_ACKNOWLEDGEMENT,
  RECOVERY_UPDATE_ERROR,
  createSupabaseRecoveryController,
  validateRecoveryPasswords,
} from './supabaseRecovery.js';

function mockAuth(overrides = {}) {
  const calls = [];
  let callback;
  const auth = {
    async sendPasswordRecovery(email) { calls.push(['request', email]); },
    subscribeToAuthChanges(next) { callback = next; calls.push(['subscribe']); return () => calls.push(['unsubscribe']); },
    async getCurrentSession() { return { access_token: 'recovery-token' }; },
    async updatePasswordDuringRecovery(password) { calls.push(['update', password]); },
    async logout() { calls.push(['logout']); },
    ...overrides,
  };
  return { auth, calls, emit: (event, session) => callback({ event, session }) };
}

test('forgotten-password requests always return the same generic acknowledgement', async () => {
  const known = mockAuth();
  const unknown = mockAuth({ async sendPasswordRecovery() { throw new Error('user not found'); } });
  assert.equal(await createSupabaseRecoveryController({ auth: known.auth }).request('known@example.test'), RECOVERY_ACKNOWLEDGEMENT);
  assert.equal(await createSupabaseRecoveryController({ auth: unknown.auth }).request('unknown@example.test'), RECOVERY_ACKNOWLEDGEMENT);
});

test('PASSWORD_RECOVERY validates the current session, clears sensitive URL data, and enables reset', async () => {
  const mock = mockAuth();
  const replacements = [];
  const queued = [];
  let ready = false;
  const controller = createSupabaseRecoveryController({
    auth: mock.auth,
    schedule: (task) => queued.push(task),
    history: { state: null, replaceState: (...args) => replacements.push(args) },
    location: { pathname: '/reset-password', search: '?code=sensitive', hash: '#access_token=sensitive' },
  });
  controller.subscribe({ onReady: () => { ready = true; } });
  mock.emit('PASSWORD_RECOVERY', { access_token: 'recovery-token' });
  assert.equal(ready, false);
  await queued.shift()();
  assert.equal(ready, true);
  assert.deepEqual(replacements, [[null, '', '/reset-password']]);
});

test('a queued PASSWORD_RECOVERY event wins over Supabase INITIAL_SESSION ordering', async () => {
  const mock = mockAuth();
  const queued = [];
  const deferred = [];
  let outcome = '';
  createSupabaseRecoveryController({
    auth: mock.auth,
    schedule: (task) => queued.push(task),
    deferInvalid: (task) => deferred.push(task),
  }).subscribe({ onReady: () => { outcome = 'ready'; }, onInvalid: () => { outcome = 'invalid'; } });
  mock.emit('INITIAL_SESSION', { access_token: 'recovery-token' });
  await queued.shift()();
  mock.emit('PASSWORD_RECOVERY', { access_token: 'recovery-token' });
  await queued.shift()();
  deferred.forEach((task) => task());
  assert.equal(outcome, 'ready');
});

test('ordinary login, missing, invalid, and expired recovery state never enable reset', async () => {
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN']) {
    const mock = mockAuth();
    const queued = [];
    const deferred = [];
    let outcome = '';
    createSupabaseRecoveryController({
      auth: mock.auth,
      schedule: (task) => queued.push(task),
      deferInvalid: (task) => deferred.push(task),
    })
      .subscribe({ onReady: () => { outcome = 'ready'; }, onInvalid: (message) => { outcome = message; } });
    mock.emit(event, event === 'SIGNED_IN' ? { access_token: 'ordinary' } : null);
    await queued.shift()();
    deferred.forEach((task) => task());
    assert.equal(outcome, INVALID_RECOVERY_MESSAGE);
  }
  const invalid = mockAuth({ async getCurrentSession() { return null; } });
  const queued = [];
  let outcome = '';
  createSupabaseRecoveryController({ auth: invalid.auth, schedule: (task) => queued.push(task) })
    .subscribe({ onReady: () => { outcome = 'ready'; }, onInvalid: (message) => { outcome = message; } });
  invalid.emit('PASSWORD_RECOVERY', { access_token: 'expired' });
  await queued.shift()();
  assert.equal(outcome, INVALID_RECOVERY_MESSAGE);
});

test('password validation enforces length and confirmation', () => {
  assert.match(validateRecoveryPasswords('short', 'short'), /at least 8/);
  assert.match(validateRecoveryPasswords('x'.repeat(129), 'x'.repeat(129)), /no more than 128/);
  assert.equal(validateRecoveryPasswords('valid-password', 'different-password'), 'Passwords do not match.');
  assert.equal(validateRecoveryPasswords('valid-password', 'valid-password'), null);
});

test('successful recovery update is followed by sign-out', async () => {
  const mock = mockAuth();
  const queued = [];
  const controller = createSupabaseRecoveryController({ auth: mock.auth, schedule: (task) => queued.push(task) });
  controller.subscribe({ onReady() {} });
  mock.emit('PASSWORD_RECOVERY', { access_token: 'recovery-token' });
  await queued.shift()();
  await controller.update('valid-password', 'valid-password');
  assert.deepEqual(mock.calls.slice(-2), [['update', 'valid-password'], ['logout']]);
});

test('update failures remain safe and do not sign out or destroy recovery state', async () => {
  const mock = mockAuth({ async updatePasswordDuringRecovery() { throw new Error('raw database detail'); } });
  const queued = [];
  const controller = createSupabaseRecoveryController({ auth: mock.auth, schedule: (task) => queued.push(task) });
  controller.subscribe({ onReady() {} });
  mock.emit('PASSWORD_RECOVERY', { access_token: 'recovery-token' });
  await queued.shift()();
  await assert.rejects(() => controller.update('valid-password', 'valid-password'), (error) => error.message === RECOVERY_UPDATE_ERROR);
  assert.equal(mock.calls.some(([name]) => name === 'logout'), false);
});

test('subscription cleanup prevents state updates', async () => {
  const mock = mockAuth();
  const queued = [];
  let ready = false;
  const cleanup = createSupabaseRecoveryController({ auth: mock.auth, schedule: (task) => queued.push(task) })
    .subscribe({ onReady: () => { ready = true; } });
  mock.emit('PASSWORD_RECOVERY', { access_token: 'recovery-token' });
  cleanup();
  await queued.shift()();
  assert.equal(ready, false);
  assert.equal(mock.calls.at(-1)[0], 'unsubscribe');
});

test('production React has no legacy reset-token parsing or Express recovery calls', async () => {
  const [header, reset, api] = await Promise.all([
    fs.readFile(new URL('../components/Header.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../pages/ResetPassword.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('./api.js', import.meta.url), 'utf8'),
  ]);
  assert.equal(/requestPasswordReset|resetPasswordWithToken|useSearchParams/.test(header + reset + api), false);
  assert.equal(/auth\/(forgot-password|reset-password)/.test(header + reset + api), false);
  assert.equal(/[?&]token=|searchParams\.get\(['"]token/.test(reset), false);
});
