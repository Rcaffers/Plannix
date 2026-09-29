import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cors from 'cors';
import { corsDelegate } from './cors.js';

test('allowed cross-origin response exposes only diagnostic and retry headers; disallowed origin remains denied', async t => {
  const app = express();
  app.use(cors(corsDelegate));
  app.get('/', (_req, res) => res.set({ 'X-Request-ID': 'fixture-reference', 'Retry-After': '30', 'X-Private-Fixture': 'hidden' }).sendStatus(429));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const response = await fetch(url, { headers: { Origin: 'https://fixture.example.test', 'X-Forwarded-Host': 'fixture.example.test', 'X-Forwarded-Proto': 'https' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://fixture.example.test');
  const exposed = response.headers.get('access-control-expose-headers').split(',').map(s => s.trim().toLowerCase()).sort();
  assert.deepEqual(exposed, ['retry-after', 'x-request-id']);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(response.headers.get('x-request-id'), 'fixture-reference');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  const denied = await fetch(url, { headers: { Origin: 'https://disallowed.example.test' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});
