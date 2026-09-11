import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createBrowserSupabaseClient } from '../lib/supabase.js';
import {
  SupabaseAuthError,
  createSupabaseAuthAdapter,
  mapSupabaseUser,
  normalizeAuthEmail,
} from './supabaseAuth.js';

const location = { origin: 'https://app.plannix.test' };

function createMockClient({ profile = null } = {}) {
  const calls = {};
  let authCallback;
  const unsubscribe = () => { calls.unsubscribed = true; };
  const profileBuilder = {
    select(columns) { calls.profileColumns = columns; return this; },
    eq(column, value) { calls.profileMatch = [column, value]; return this; },
    async maybeSingle() { return { data: profile, error: null }; },
  };
  const client = {
    auth: {
      async signUp(input) { calls.signUp = input; return calls.signUpResult; },
      async signInWithPassword(input) { calls.login = input; return calls.loginResult; },
      async getSession() { calls.getSession = (calls.getSession || 0) + 1; return calls.sessionResult; },
      async getUser(token) { calls.getUser = arguments.length ? token : 'without-token'; return calls.userResult; },
      onAuthStateChange(callback) {
        authCallback = callback;
        return { data: { subscription: { unsubscribe } } };
      },
      async signOut() { calls.signOut = true; return calls.signOutResult || { error: null }; },
      async resetPasswordForEmail(email, options) {
        calls.recovery = { email, options };
        return calls.recoveryResult || { error: null };
      },
      async updateUser(input) { calls.updateUser = input; return calls.updateResult; },
    },
    from(table) { calls.profileTable = table; return profileBuilder; },
  };
  return {
    calls,
    client,
    emitAuthChange: (event, session) => authCallback(event, session),
  };
}

test('browser client requires only public configuration and enables browser session handling', () => {
  assert.throws(
    () => createBrowserSupabaseClient({ configuration: {}, createClientImpl: () => null }),
    /VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/,
  );
  let received;
  const client = createBrowserSupabaseClient({
    configuration: {
      VITE_SUPABASE_URL: ' https://project.supabase.test ',
      VITE_SUPABASE_PUBLISHABLE_KEY: ' public-test-key ',
    },
    createClientImpl: (...args) => { received = args; return { kind: 'client' }; },
  });
  assert.deepEqual(client, { kind: 'client' });
  assert.deepEqual(received, [
    'https://project.supabase.test',
    'public-test-key',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
  ]);
});

test('browser client and adapter contain no privileged key variable name', async () => {
  const forbiddenName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
  const sources = await Promise.all([
    fs.readFile(new URL('../lib/supabase.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('./supabaseAuth.js', import.meta.url), 'utf8'),
  ]);
  assert.equal(sources.some((source) => source.includes(forbiddenName)), false);
});

test('signup normalizes names and email, preserves password, and sends exact metadata and redirect', async () => {
  const mock = createMockClient();
  mock.calls.signUpResult = { data: { user: { id: 'user-1', email: 'teacher@example.test' }, session: null }, error: null };
  const auth = createSupabaseAuthAdapter({ client: mock.client, location });
  const result = await auth.signup({
    firstName: '  Ada ',
    lastName: ' Lovelace  ',
    email: ' ADA @Example.Test ',
    password: '  preserved password  ',
  });
  assert.deepEqual(mock.calls.signUp, {
    email: 'ada@example.test',
    password: '  preserved password  ',
    options: {
      data: { first_name: 'Ada', last_name: 'Lovelace' },
      emailRedirectTo: 'https://app.plannix.test/',
    },
  });
  assert.equal(result.authenticated, false);
  assert.equal(result.confirmationPending, true);
  assert.equal(result.session, null);
  assert.equal(result.user, null);
  assert.equal(result.pendingUser.id, 'user-1');
});

test('signup rejects every missing required field before calling Supabase', async () => {
  for (const input of [
    { firstName: '', lastName: 'Last', email: 'a@b.test', password: 'password' },
    { firstName: 'First', lastName: '', email: 'a@b.test', password: 'password' },
    { firstName: 'First', lastName: 'Last', email: '', password: 'password' },
    { firstName: 'First', lastName: 'Last', email: 'a@b.test', password: '' },
  ]) {
    const mock = createMockClient();
    const auth = createSupabaseAuthAdapter({ client: mock.client, location });
    await assert.rejects(() => auth.signup(input), /First name, last name, email, and password are required/);
    assert.equal(mock.calls.signUp, undefined);
  }
});

test('signup with a returned session is authenticated and loads the profile', async () => {
  const profile = { id: 'user-1', first_name: 'Ada', last_name: 'Lovelace', initials: 'AL' };
  const mock = createMockClient({ profile });
  const user = { id: 'user-1', email: 'ADA@example.test', user_metadata: {} };
  mock.calls.signUpResult = { data: { user, session: { access_token: 'token', user } }, error: null };
  const result = await createSupabaseAuthAdapter({ client: mock.client, location }).signup({
    firstName: 'Ada', lastName: 'Lovelace', email: user.email, password: 'password123',
  });
  assert.equal(result.authenticated, true);
  assert.equal(result.confirmationPending, false);
  assert.deepEqual(result.user, {
    id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace', initials: 'AL',
  });
  assert.equal(result.pendingUser, null);
});

test('login, current session, and server-validated user use the injected client', async () => {
  const profile = { first_name: 'Grace', last_name: 'Hopper', initials: 'GH' };
  const mock = createMockClient({ profile });
  const user = { id: 'user-2', email: 'grace@example.test', user_metadata: {} };
  const session = { access_token: 'access', user };
  mock.calls.loginResult = { data: { user, session }, error: null };
  mock.calls.sessionResult = { data: { session }, error: null };
  mock.calls.userResult = { data: { user }, error: null };
  const auth = createSupabaseAuthAdapter({ client: mock.client, location });
  const login = await auth.login({ email: ' GRACE@example.test ', password: ' password ' });
  assert.deepEqual(mock.calls.login, { email: 'grace@example.test', password: ' password ' });
  assert.equal(login.user.name, 'Grace Hopper');
  assert.equal(await auth.getCurrentSession(), session);
  assert.equal((await auth.getValidatedCurrentUser('access')).id, 'user-2');
  assert.equal(mock.calls.getUser, 'access');
});

test('user mapping prefers profile data and has safe metadata and email fallbacks', () => {
  const authUser = {
    id: 'user-3', email: ' PERSON@Example.Test ',
    user_metadata: { first_name: 'Meta', last_name: 'Name', initials: 'MN' },
  };
  assert.deepEqual(mapSupabaseUser(authUser, { first_name: 'Profile', last_name: 'Person', initials: 'PP' }), {
    id: 'user-3', name: 'Profile Person', email: 'person@example.test', firstName: 'Profile', lastName: 'Person', initials: 'PP',
  });
  assert.deepEqual(
    mapSupabaseUser({ id: 'metadata', email: '', user_metadata: { full_name: 'Mary Van Buren' } }),
    {
      id: 'metadata', name: 'Mary Van Buren', email: '', firstName: 'Mary', lastName: 'Van Buren', initials: 'MV',
    },
  );
  assert.equal(mapSupabaseUser({ id: '4', email: 'fallback@example.test', user_metadata: {} }).name, 'fallback@example.test');
  assert.equal(normalizeAuthEmail(' A @Example.Test '), 'a@example.test');
});

test('auth-state subscription maps users, records recovery sessions, and cleans up', async () => {
  const mock = createMockClient({ profile: { first_name: 'Recover', last_name: 'User', initials: 'RU' } });
  mock.calls.sessionResult = { data: { session: { access_token: 'recovery-token' } }, error: null };
  mock.calls.updateResult = { data: { user: { id: 'r1', email: 'r@example.test', user_metadata: {} } }, error: null };
  const auth = createSupabaseAuthAdapter({ client: mock.client, location });
  let eventPayload;
  const cleanup = auth.subscribeToAuthChanges((payload) => { eventPayload = payload; });
  await mock.emitAuthChange('PASSWORD_RECOVERY', {
    access_token: 'recovery-token', user: { id: 'r1', email: 'r@example.test', user_metadata: {} },
  });
  assert.equal(eventPayload.event, 'PASSWORD_RECOVERY');
  await auth.updatePasswordDuringRecovery(' new password ');
  assert.deepEqual(mock.calls.updateUser, { password: ' new password ' });
  cleanup();
  assert.equal(mock.calls.unsubscribed, true);
});

test('logout and recovery email use Supabase Auth with the expected redirect', async () => {
  const mock = createMockClient();
  const auth = createSupabaseAuthAdapter({ client: mock.client, location });
  await auth.logout();
  await auth.sendPasswordRecovery(' RECOVER @example.test ');
  assert.equal(mock.calls.signOut, true);
  assert.deepEqual(mock.calls.recovery, {
    email: 'recover@example.test',
    options: { redirectTo: 'https://app.plannix.test/reset-password' },
  });
});

test('password update requires a recovery session and Supabase errors retain safe metadata', async () => {
  const mock = createMockClient();
  mock.calls.sessionResult = { data: { session: { access_token: 'ordinary-token' } }, error: null };
  mock.calls.loginResult = { data: null, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } };
  const auth = createSupabaseAuthAdapter({ client: mock.client, location });
  await assert.rejects(() => auth.updatePasswordDuringRecovery('password123'), /recovery session is required/i);
  await assert.rejects(
    () => auth.login({ email: 'a@example.test', password: 'password123' }),
    (error) => error instanceof SupabaseAuthError && error.message === 'Invalid login credentials' && error.code === 'invalid_credentials' && error.status === 400,
  );
});
