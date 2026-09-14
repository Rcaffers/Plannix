import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountDeletionRateLimit } from './accountDeletionRateLimit.js';

function invoke(limiter, userId, ip = '192.0.2.1') {
  const req = { auth: { userId }, ip };
  const response = { headers: {}, set(name, value) { this.headers[name] = value; } };
  const nextCalls = [];
  limiter(req, response, (error) => nextCalls.push(error));
  return { response, error: nextCalls[0] };
}

test('deletion limiter isolates users and supplies Retry-After', () => {
  const limiter = createAccountDeletionRateLimit({ limit: 2, now: () => 1000, hash: String });
  assert.equal(invoke(limiter, 'user-one', 'ip-one').error, undefined);
  assert.equal(invoke(limiter, 'user-one', 'ip-one').error, undefined);
  const blocked = invoke(limiter, 'user-one', 'ip-one');
  assert.equal(blocked.error.statusCode, 429);
  assert.equal(blocked.error.message, 'Too many account deletion attempts. Please try again later.');
  assert.equal(blocked.response.headers['Retry-After'], '900');
  assert.equal(invoke(limiter, 'user-two', 'ip-two').error, undefined);
});

test('expired and excess limiter entries are removed from bounded memory', () => {
  let currentTime = 0;
  const limiter = createAccountDeletionRateLimit({
    limit: 5,
    windowMs: 10,
    maxEntries: 4,
    now: () => currentTime,
    hash: String,
  });
  invoke(limiter, 'one', 'one');
  invoke(limiter, 'two', 'two');
  invoke(limiter, 'three', 'three');
  assert.ok(limiter.entryCount() <= 4);
  currentTime = 11;
  invoke(limiter, 'four', 'four');
  assert.equal(limiter.entryCount(), 2);
});
