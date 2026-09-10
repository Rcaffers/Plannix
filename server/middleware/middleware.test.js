import assert from 'node:assert/strict';
import test from 'node:test';
import { errorHandler, sendError } from './errorHandler.js';
import { notFound } from './notFound.js';

function responseRecorder() {
  return {
    headersSent: false,
    statusCode: null,
    body: null,
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
