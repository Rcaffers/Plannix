import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { signupSubmission } from './authForms.js';
import {
  PublicAuthError,
  createSupabaseAuthController,
  privateRouteState,
} from './supabaseAuthController.js';

const session = { access_token: 'access-token', user: { id: 'user-1' } };
const profile = { id: 'user-1', first_name: 'Ada', last_name: 'Lovelace', initials: 'AL' };
const organisationId = '20000000-0000-4000-8000-000000000001';

function mockAuth(overrides = {}) {
  const calls = [];
  let callback;
  const auth = {
    async signup() { calls.push('signup'); return { authenticated: false, confirmationPending: true, session: null }; },
    async login() { calls.push('login'); return { session }; },
    async getCurrentSession() { calls.push('session'); return session; },
    async getValidatedCurrentUser() { calls.push('validate'); return { id: 'user-1', email: 'ada@example.test' }; },
    async loadProfile() { calls.push('profile'); return profile; },
    async ensurePersonalOrganisation() { calls.push('onboard'); return { organisationId }; },
    subscribeToAuthChanges(next) { calls.push('subscribe'); callback = next; return () => calls.push('unsubscribe'); },
    async logout() { calls.push('logout'); },
    async logoutLocal() { calls.push('logout-local'); },
    ...overrides,
  };
  return { auth, calls, emit: (event, nextSession = session) => callback({ event, session: nextSession }) };
}

test('signup form submission preserves password and normalizes separate names', () => {
  assert.deepEqual(signupSubmission({ firstName: ' Ada ', lastName: ' Lovelace ', email: ' A@B.test ', password: ' pass ' }), {
    firstName: 'Ada', lastName: 'Lovelace', email: 'A@B.test', password: ' pass ',
  });
});

test('confirmation-pending signup does not authenticate or onboard', async () => {
  const mock = mockAuth();
  const result = await createSupabaseAuthController({ auth: mock.auth }).signup({});
  assert.deepEqual(result, { authenticated: false, confirmationPending: true, user: null });
  assert.deepEqual(mock.calls, ['signup']);
});

test('authenticated signup and login validate, load profile, onboard, reload, then expose React user', async () => {
  for (const operation of ['signup', 'login']) {
    const mock = mockAuth({
      async signup() { mock.calls.push('signup'); return { authenticated: true, session }; },
    });
    const controller = createSupabaseAuthController({ auth: mock.auth });
    const result = operation === 'signup' ? (await controller.signup({})).user : await controller.login({});
    assert.deepEqual(result, { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace', initials: 'AL', organisationId });
    assert.deepEqual(mock.calls, [operation, 'validate', 'profile', 'onboard', 'profile']);
  }
});

test('onboarding failure signs out, returns only a safe error, and denies access', async () => {
  const mock = mockAuth({ async ensurePersonalOrganisation() { mock.calls.push('onboard'); throw new Error('SQL secret detail'); } });
  const controller = createSupabaseAuthController({ auth: mock.auth });
  await assert.rejects(() => controller.login({}), (error) => error instanceof PublicAuthError && !error.message.includes('SQL'));
  assert.equal(mock.calls.includes('logout'), true);
  assert.equal(privateRouteState({ isAuthLoading: false, user: null }), 'public');
});

test('session restoration validates and onboards; invalid sessions sign out and remain public', async () => {
  const good = mockAuth();
  assert.equal((await createSupabaseAuthController({ auth: good.auth }).restoreSession()).id, 'user-1');
  const bad = mockAuth({ async getValidatedCurrentUser() { throw new Error('expired token'); } });
  assert.equal(await createSupabaseAuthController({ auth: bad.auth }).restoreSession(), null);
  assert.equal(bad.calls.includes('logout'), true);
});

test('confirmation events are delegated outside the auth callback and duplicate events share onboarding', async () => {
  const queued = [];
  let release;
  const mock = mockAuth({
    async ensurePersonalOrganisation() {
      mock.calls.push('onboard');
      await new Promise((resolve) => { release = resolve; });
      return { organisationId };
    },
  });
  const users = [];
  const controller = createSupabaseAuthController({ auth: mock.auth, schedule: (task) => queued.push(task) });
  const cleanup = controller.subscribe({ onUser: (user) => users.push(user) });
  mock.emit('SIGNED_IN');
  mock.emit('TOKEN_REFRESHED');
  assert.equal(mock.calls.includes('validate'), false);
  queued.splice(0).forEach((task) => task());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mock.calls.filter((call) => call === 'onboard').length, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(users.length, 1);
  cleanup();
  assert.equal(mock.calls.at(-1), 'unsubscribe');
});

test('subscription cleanup prevents scheduled state changes and logout uses Supabase', async () => {
  const queued = [];
  const mock = mockAuth();
  let changed = false;
  const controller = createSupabaseAuthController({ auth: mock.auth, schedule: (task) => queued.push(task) });
  const cleanup = controller.subscribe({ onUser: () => { changed = true; } });
  mock.emit('SIGNED_IN');
  cleanup();
  queued.forEach((task) => task());
  await controller.logout();
  assert.equal(changed, false);
  assert.equal(mock.calls.includes('logout'), true);
});

test('account deletion exposes the current session and clears only the local Auth session', async () => {
  const mock = mockAuth();
  const controller = createSupabaseAuthController({ auth: mock.auth });
  assert.equal(await controller.getCurrentSession(), session);
  await controller.clearAfterAccountDeletion();
  assert.deepEqual(mock.calls, ['session', 'logout-local']);
});

test('logout and account deletion discard the cached user and organisation selector', async () => {
  const mock = mockAuth();
  const controller = createSupabaseAuthController({ auth: mock.auth });
  assert.equal((await controller.login({})).organisationId, organisationId);
  await controller.logout();
  assert.equal((await controller.login({})).organisationId, organisationId);
  await controller.clearAfterAccountDeletion();
  await controller.login({});
  assert.equal(mock.calls.filter((call) => call === 'onboard').length, 3);
});

test('a recovery session is never published as an authenticated application user', async () => {
  const queued = [];
  const mock = mockAuth();
  let published = false;
  const controller = createSupabaseAuthController({ auth: mock.auth, schedule: (task) => queued.push(task) });
  controller.subscribe({ onUser: () => { published = true; } });
  mock.emit('PASSWORD_RECOVERY');
  queued.splice(0).forEach((task) => task());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(published, false);
  assert.equal(mock.calls.includes('onboard'), false);
});

test('a recovery event interrupting restoration prevents onboarding', async () => {
  const queued = [];
  let releaseProfile;
  const mock = mockAuth({
    async loadProfile() {
      mock.calls.push('profile');
      await new Promise((resolve) => { releaseProfile = resolve; });
      return profile;
    },
  });
  const controller = createSupabaseAuthController({ auth: mock.auth, schedule: (task) => queued.push(task) });
  controller.subscribe({});
  const restoring = controller.restoreSession();
  await new Promise((resolve) => setImmediate(resolve));
  mock.emit('PASSWORD_RECOVERY');
  queued.splice(0).forEach((task) => task());
  releaseProfile();
  assert.equal(await restoring, null);
  assert.equal(mock.calls.includes('onboard'), false);
});

test('private route states distinguish restoration, public, and onboarded access', () => {
  assert.equal(privateRouteState({ isAuthLoading: true, user: null }), 'loading');
  assert.equal(privateRouteState({ isAuthLoading: false, user: null }), 'public');
  assert.equal(privateRouteState({ isAuthLoading: false, user: profile }), 'private');
});

test('Supabase login and signup failures are mapped without exposing account existence or internals', async () => {
  const login = mockAuth({ async login() { throw Object.assign(new Error('User exists in secret table'), { code: 'invalid_credentials' }); } });
  await assert.rejects(
    () => createSupabaseAuthController({ auth: login.auth }).login({}),
    (error) => error.message === 'Unable to log in with those details.' && !error.message.includes('exists'),
  );
  const signup = mockAuth({ async signup() { throw new Error('duplicate key value'); } });
  await assert.rejects(
    () => createSupabaseAuthController({ auth: signup.auth }).signup({}),
    (error) => error.message === 'Unable to create your account. Please try again.' && !error.message.includes('duplicate'),
  );
});

test('production React no longer imports or calls the four legacy Express auth helpers', async () => {
  const [app, api, header] = await Promise.all([
    fs.readFile(new URL('../App.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('./api.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../components/Header.jsx', import.meta.url), 'utf8'),
  ]);
  for (const legacy of ['fetchAuthMe', 'loginWithCredentials', 'logoutSession', 'signupAccount']) {
    assert.equal(app.includes(legacy) || api.includes(legacy), false);
  }
  assert.match(header, /name="firstName"/);
  assert.match(header, /name="lastName"/);
  assert.match(api, /`\$\{API_BASE_URL\}\/account`/);
});
