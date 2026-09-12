import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyError, errorHandler, sendError } from './errorHandler.js';
import { notFound } from './notFound.js';
import { isCanonicalRequestId, requestId } from './requestId.js';

function responseRecorder() {
  return {
    headersSent: false,
    statusCode: null,
    body: null,
    headers: {},
    req: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function captureErrorLog(work) {
  const entries = [];
  const originalConsoleError = console.error;
  console.error = (entry) => entries.push(entry);
  try {
    work();
  } finally {
    console.error = originalConsoleError;
  }
  return entries;
}

function runRequestId(value) {
  const req = { headers: {} };
  if (value !== undefined) req.headers['x-request-id'] = value;
  const res = responseRecorder();
  let calledNext = false;
  requestId(req, res, () => {
    calledNext = true;
  });
  assert.equal(calledNext, true);
  assert.equal(res.headers['x-request-id'], req.id);
  return req.id;
}

test('requestId generates, preserves, and varies canonical request IDs', () => {
  const valid = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';
  const first = runRequestId();
  const second = runRequestId();
  assert.equal(isCanonicalRequestId(first), true);
  assert.equal(isCanonicalRequestId(second), true);
  assert.notEqual(first, second);
  assert.equal(runRequestId(valid), valid);
});

test('requestId replaces invalid and noncanonical header values', () => {
  const invalidValues = [
    '8E6DDC18-D0D9-4FBC-A036-B02028E9F421',
    ' 8e6ddc18-d0d9-4fbc-a036-b02028e9f421',
    '8e6ddc18-d0d9-4fbc-a036-b02028e9f421 ',
    'not-a-request-id',
    'a'.repeat(500),
    ['8e6ddc18-d0d9-4fbc-a036-b02028e9f421'],
    '8e6ddc18-d0d9-4fbc-a036-b02028e9f421\u0000',
    '8e6ddc18-d0d9-4fbc-a036-b02028e9f421\nsecond-value',
  ];

  for (const value of invalidValues) {
    const result = runRequestId(value);
    assert.equal(isCanonicalRequestId(result), true);
    assert.notDeepEqual(result, value);
  }
});

test('notFound returns JSON for unknown API routes', () => {
  const response = responseRecorder();
  notFound(
    { path: '/admin/migrate', method: 'POST', originalUrl: '/admin/migrate', accepts: () => false },
    response,
    () => assert.fail('API requests must not fall through'),
  );
  assert.equal(response.statusCode, 404);
  assert.match(response.body.message, /No API route found/);
});

test('errorHandler hides unexpected error details', () => {
  const response = responseRecorder();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    errorHandler(
      new Error('private detail'),
      { method: 'GET', originalUrl: '/failure' },
      response,
      () => {},
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.statusCode, 500);
  assert.doesNotMatch(response.body.message, /private detail/);
});

test('errorHandler delegates when response headers have already been sent', () => {
  const error = new Error('connection stopped');
  const response = responseRecorder();
  response.headersSent = true;
  let delegated;
  errorHandler(error, { id: 'request-id', method: 'GET', path: '/failure' }, response, (value) => {
    delegated = value;
  });
  assert.equal(delegated, error);
  assert.equal(response.statusCode, null);
  assert.equal(response.body, null);
});

test('sendError hides an unexpected internal error message', () => {
  const response = responseRecorder();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    sendError(response, new Error('private database detail'), 'Could not save changes.');
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { message: 'Could not save changes.' });
});

test('sendError returns an explicitly exposed safe message', () => {
  const response = responseRecorder();
  const error = Object.assign(new Error('Safe validation message.'), {
    expose: true,
    statusCode: 400,
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    sendError(response, error, 'Fallback message.');
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { message: 'Safe validation message.' });
});

test('error classification handles parser errors and ignores untrusted status codes', () => {
  assert.deepEqual(classifyError({ type: 'entity.parse.failed', statusCode: 500 }), {
    status: 400,
    message: 'Request body contains invalid JSON.',
    category: 'invalid_json',
  });
  assert.deepEqual(classifyError({ type: 'entity.too.large', statusCode: 400 }), {
    status: 413,
    message: 'Request body is too large.',
    category: 'payload_too_large',
  });
  assert.equal(classifyError({ statusCode: 418 }).status, 500);
  assert.equal(
    classifyError({ expose: true, statusCode: 422, message: 'Safe validation.' }).status,
    422,
  );
});

test('common PostgreSQL errors map to safe public statuses and messages', () => {
  const expected = new Map([
    ['23505', [409, 'A record with those details already exists.']],
    ['23503', [409, 'The requested change conflicts with related data.']],
    ['23502', [400, 'A required value is missing.']],
    ['23514', [400, 'One or more values are invalid.']],
    ['22P02', [400, 'One or more values are invalid.']],
  ]);

  for (const [code, [status, message]] of expected) {
    const result = classifyError({ code, detail: 'private database details' });
    assert.equal(result.status, status);
    assert.equal(result.message, message);
    assert.equal(result.postgresCode, code);
  }

  const unknown = classifyError({ code: 'XX000', detail: 'private database details' });
  assert.equal(unknown.status, 500);
  assert.equal(unknown.message, 'Unexpected server error. Check server logs for details.');
  assert.equal(Object.hasOwn(unknown, 'postgresCode'), false);
});

test('structured error logs contain only safe fields and omit query strings and secrets', () => {
  const secretValues = [
    'Password123!',
    'session-token-value',
    'postgresql://private-database.example/secret',
    'internal database message',
    'raw-enumerable-secret',
  ];
  const error = Object.assign(new Error(secretValues[3]), {
    code: '23505',
    constraint: 'plannix_users_email_key',
    detail: secretValues[0],
    token: secretValues[1],
    databaseUrl: secretValues[2],
    unknownProperty: secretValues[4],
  });
  const response = responseRecorder();
  response.req = {
    id: '8e6ddc18-d0d9-4fbc-a036-b02028e9f421',
    method: 'POST',
    path: '/auth/signup',
    originalUrl: '/auth/signup?reset_token=private',
  };

  const entries = captureErrorLog(() => sendError(response, error, 'Could not sign up.'));
  assert.equal(entries.length, 1);
  const record = JSON.parse(entries[0]);
  assert.deepEqual(Object.keys(record).sort(), [
    'constraint',
    'errorType',
    'event',
    'level',
    'method',
    'path',
    'postgresCode',
    'requestId',
    'status',
    'timestamp',
  ]);
  assert.equal(record.requestId, response.req.id);
  assert.equal(record.path, '/auth/signup');
  assert.equal(record.status, 409);
  assert.equal(record.postgresCode, '23505');
  assert.equal(record.constraint, 'plannix_users_email_key');
  assert.doesNotThrow(() => new Date(record.timestamp).toISOString());

  const serialized = entries[0];
  for (const secret of secretValues) assert.doesNotMatch(serialized, new RegExp(secret, 'i'));
  assert.doesNotMatch(serialized, /reset_token|private/i);
});

test('unallowlisted PostgreSQL constraints and payload content are not logged', () => {
  const response = responseRecorder();
  response.req = {
    id: '8e6ddc18-d0d9-4fbc-a036-b02028e9f421',
    method: 'POST',
    path: '/api/contact',
    body: { message: 'payload must never be logged' },
  };
  const error = {
    code: '23514',
    constraint: 'private_unallowlisted_constraint',
    body: 'payload must never be logged',
  };
  const entries = captureErrorLog(() => sendError(response, error, 'Could not submit.'));
  const record = JSON.parse(entries[0]);
  assert.equal(Object.hasOwn(record, 'constraint'), false);
  assert.doesNotMatch(entries[0], /payload must never be logged|private_unallowlisted_constraint/);
});
