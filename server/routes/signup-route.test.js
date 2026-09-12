import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { errorHandler } from '../middleware/errorHandler.js';
import { notFound } from '../middleware/notFound.js';
import { requestId } from '../middleware/requestId.js';
import { createSessionCookieAttacher, registerSignupRoute } from './signup-route.js';

const COOKIE_NAME = 'plannix_session';

function toPublicUser({ id, name, email }) {
  return { id, name, email };
}

function normalizeEmailInput(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function validateSignupPayload({ name, email, password }) {
  if (!name || !name.trim()) return 'Full name is required.';
  if (!email || !email.trim()) return 'Email is required.';
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

function createIsolatedSignupApp({ existingUser = null, createUserError = null, secure = false } = {}) {
  const calls = { createdUsers: [], sessions: [] };
  const app = express();
  app.use(requestId);
  app.use(cors());
  app.use(cookieParser());
  app.use(express.json());
  const attachSessionCookie = createSessionCookieAttacher({
    createSessionForUser: async (userId) => {
      const sessionId = `session-for-${userId}`;
      calls.sessions.push({ sessionId, userId });
      return sessionId;
    },
    cookieName: COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 1000 * 60 * 60 * 24,
    },
  });
  registerSignupRoute({
    app,
    attachSessionCookie,
    createUser: async (user) => {
      if (createUserError) throw createUserError;
      calls.createdUsers.push(user);
      return user;
    },
    findUserByEmail: async () => existingUser,
    hashPassword: (password) => bcrypt.hash(password, 10),
    normalizeEmailInput,
    randomUUID: () => 'test-user-id',
    requireDb: () => true,
    toPublicUser,
    validateSignupPayload,
  });
  app.use(notFound);
  app.use(errorHandler);
  return { app, calls };
}

async function request(app, path, options = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}${path}`, options);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function signupRequest(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

test('configured signup app creates one user and session with a public 201 response', async () => {
  const password = 'password123';
  const { app, calls } = createIsolatedSignupApp();
  const response = await request(
    app,
    '/auth/signup',
    signupRequest({ name: ' Test Teacher ', email: ' TEACHER @example.test ', password }),
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(payload, {
    user: { id: 'u_individual_test-user-id', name: 'Test Teacher', email: 'teacher@example.test' },
  });
  assert.equal(calls.createdUsers.length, 1);
  assert.equal(calls.sessions.length, 1);
  assert.equal(calls.sessions[0].userId, 'u_individual_test-user-id');
  assert.notEqual(calls.createdUsers[0].passwordHash, password);
  assert.equal(await bcrypt.compare(password, calls.createdUsers[0].passwordHash), true);
  assert.equal(bcrypt.getRounds(calls.createdUsers[0].passwordHash), 10);
  assert.deepEqual(Object.keys(payload), ['user']);
  assert.deepEqual(Object.keys(payload.user), ['id', 'name', 'email']);
  assert.doesNotMatch(JSON.stringify(payload), /password|hash|session|token|stripe|payment|customer|subscription|promotion/i);

  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^plannix_session=session-for-u_individual_test-user-id;/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /;\s*Secure/i);
});

test('configured signup app honours secure cookie configuration', async () => {
  const { app } = createIsolatedSignupApp({ secure: true });
  const response = await request(
    app,
    '/auth/signup',
    signupRequest({ name: 'Secure Teacher', email: 'secure@example.test', password: 'password123' }),
  );
  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /;\s*Secure/i);
});

test('configured signup app preserves invalid-input and duplicate-email responses', async () => {
  const invalid = createIsolatedSignupApp();
  const invalidResponse = await request(
    invalid.app,
    '/auth/signup',
    signupRequest({ name: '', email: '', password: '' }),
  );
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { message: 'Full name is required.' });
  assert.equal(invalid.calls.createdUsers.length, 0);
  assert.equal(invalid.calls.sessions.length, 0);

  const duplicate = createIsolatedSignupApp({ existingUser: { id: 'existing' } });
  const duplicateResponse = await request(
    duplicate.app,
    '/auth/signup',
    signupRequest({ name: 'Test Teacher', email: 'teacher@example.test', password: 'password123' }),
  );
  assert.equal(duplicateResponse.status, 409);
  assert.deepEqual(await duplicateResponse.json(), {
    message: 'An account already exists for this email.',
  });
  assert.equal(duplicate.calls.createdUsers.length, 0);
  assert.equal(duplicate.calls.sessions.length, 0);
});

test('configured signup app sanitises rejected database errors', async () => {
  const internalMessage = 'database password and private connection details';
  const { app } = createIsolatedSignupApp({ createUserError: new Error(internalMessage) });
  const response = await request(
    app,
    '/auth/signup',
    signupRequest({ name: 'Test Teacher', email: 'teacher@example.test', password: 'password123' }),
  );
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.deepEqual(payload, {
    message: 'Unexpected server error. Check server logs for details.',
  });
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(internalMessage, 'i'));
  assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
});

test('configured signup app translates a unique-constraint race to 409', async () => {
  const uniqueError = Object.assign(new Error('private duplicate detail'), {
    code: '23505',
    constraint: 'plannix_users_email_key',
  });
  const { app } = createIsolatedSignupApp({ createUserError: uniqueError });
  const response = await request(
    app,
    '/auth/signup',
    signupRequest({ name: 'Test Teacher', email: 'teacher@example.test', password: 'password123' }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    message: 'A record with those details already exists.',
  });
  assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
});
