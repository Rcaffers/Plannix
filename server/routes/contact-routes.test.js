import assert from 'node:assert/strict';
import test from 'node:test';
import cors from 'cors';
import express from 'express';
import { corsDelegate } from '../config/cors.js';
import { errorHandler, logRouteError } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { registerContactRoutes } from './contact-routes.js';

const REQUEST_ID = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeEmailInput(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

async function withContactServer({ send = async () => ({ error: null }), work }) {
  const deliveries = [];
  const app = express();
  app.use(requestId);
  app.use(cors(corsDelegate));
  app.use(express.json({ limit: '100kb' }));
  registerContactRoutes({
    app,
    createResend: () => ({ emails: { send: async (delivery) => {
      deliveries.push(delivery);
      return send(delivery);
    } } }),
    escapeHtml,
    getContactConfig: () => ({
      apiKey: 'test-api-key',
      toEmail: 'contact-recipient@example.test',
      fromEmail: 'Plannix Test <sender@example.test>',
    }),
    logRouteError,
    normalizeEmailInput,
  });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    return await work(`http://127.0.0.1:${server.address().port}`, deliveries);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function contact(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': REQUEST_ID, ...headers },
    body: JSON.stringify(body),
  });
}

test('public contact delivery uses submitted identity and ignores cookies', async () => {
  await withContactServer({ work: async (baseUrl, deliveries) => {
    const response = await contact(baseUrl, {
      name: 'Submitted Name', email: ' Submitted@Example.Test ', message: 'Submitted message',
    }, { Cookie: 'plannix_session=legacy-session; email=cookie@example.test' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].replyTo, 'submitted@example.test');
    assert.match(deliveries[0].subject, /Submitted Name/);
    assert.match(deliveries[0].html, /Submitted message/);
    assert.doesNotMatch(JSON.stringify(deliveries[0]), /cookie@example\.test|legacy-session/);
  } });
});

test('contact validation and message-size limits remain enforced', async () => {
  await withContactServer({ work: async (baseUrl, deliveries) => {
    const cases = [
      [{ email: 'valid@example.test', message: 'Hello' }, 'Name is required.'],
      [{ name: 'Name', email: 'invalid', message: 'Hello' }, 'A valid email is required.'],
      [{ name: 'Name', email: 'valid@example.test', message: 'x' }, 'Please enter a message'],
      [{ name: 'Name', email: 'valid@example.test', message: 'x'.repeat(10001) }, 'Message is too long.'],
    ];
    for (const [body, expected] of cases) {
      const response = await contact(baseUrl, body);
      assert.equal(response.status, 400);
      assert.match((await response.json()).message, new RegExp(expected));
      assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
    }
    assert.equal(deliveries.length, 0);
  } });
});

test('provider failures are safe, correlated, and never log contact or provider details', async () => {
  const secrets = ['private@example.test', 'private contact contents', 'raw-provider-secret', 'Bearer private-token'];
  const entries = [];
  const originalError = console.error;
  console.error = (entry) => entries.push(String(entry));
  try {
    await withContactServer({
      send: async () => ({ error: { message: secrets[2], headers: { authorization: secrets[3] } } }),
      work: async (baseUrl) => {
        const response = await contact(baseUrl, {
          name: 'Private Person', email: secrets[0], message: secrets[1],
        }, { Authorization: secrets[3] });
        assert.equal(response.status, 502);
        assert.equal(response.headers.get('x-request-id'), REQUEST_ID);
        assert.deepEqual(await response.json(), { message: 'Could not send your message. Please try again later.' });
      },
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(entries.length, 1);
  const record = JSON.parse(entries[0]);
  assert.equal(record.requestId, REQUEST_ID);
  assert.equal(record.path, '/api/contact');
  for (const secret of secrets) assert.equal(entries[0].includes(secret), false);
});

test('contact route source has no database, session, or cookie lookup dependency', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./contact-routes.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /getSessionUser|sessionUser|req\.cookies|\bdb\b/);
});
