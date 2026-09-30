import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createRequireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import { registerEventRoutes } from './event-routes.js';

const year = 'e4000000-0000-4000-8000-000000000001';
const id = 'e5000000-0000-4000-8000-000000000001';
const event = { id, academicYearId: year, date: '2026-10-01', title: 'Assembly', startTime: null, endTime: null, location: null, notes: null, revision: 1 };
const authUser = { id: 'e1000000-0000-4000-8000-000000000001', email_confirmed_at: '2026-09-01T00:00:00Z' };
async function harness({ user = authUser, rpc = async (name) => ({ data: name.includes('list') ? [event] : name.includes('delete') ? true : event, error: null }) } = {}) {
  const calls = [];
  const app = express(); app.use(requestId); app.use(express.json({ limit: '100kb' }));
  const requireAuth = createRequireSupabaseAuth({ getClient: () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) });
  registerEventRoutes({ app, requireAuth, createRequestClient: auth => {
    calls.push({ auth });
    return { rpc: async (name, args) => { calls.push({ name, args }); return rpc(name, args); } };
  } });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { calls, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
const headers = { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' };
const fields = { date: event.date, title: event.title, startTime: null, endTime: null, location: null, notes: null };
test('all four methods require confirmed authentication before an RPC', async () => {
  for (const user of [null, { ...authUser, email_confirmed_at: null }]) {
    const h = await harness({ user });
    try {
      for (const [method, path, body] of [
        ['GET', `/api/events?academicYearId=${year}`], ['POST', '/api/events', { academicYearId: year, event: fields }],
        ['PUT', `/api/events/${id}`, { expectedRevision: 1, event: fields }], ['DELETE', `/api/events/${id}`, { expectedRevision: 1 }],
      ]) {
        const response = await fetch(`${h.url}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
        assert.equal(response.status, user ? 403 : 401);
      }
      assert.equal(h.calls.length, 0);
    } finally { await h.close(); }
  }
});
test('list/create/update/delete use only authenticated RPCs and exact contracts', async () => {
  const h = await harness({ rpc: async name => ({ data: name.includes('list') ? [event] : name.includes('delete') ? true : name.includes('update') ? { ...event, revision: 2 } : event, error: null }) });
  try {
    const queries = [
      ['GET', `/api/events?academicYearId=${year}&from=2026-09-28&to=2026-10-04`, undefined, 200],
      ['POST', '/api/events', { academicYearId: year, event: fields }, 201],
      ['PUT', `/api/events/${id}`, { expectedRevision: 1, event: fields }, 200],
      ['DELETE', `/api/events/${id}`, { expectedRevision: 1 }, 200],
    ];
    for (const [method, path, body, status] of queries) {
      const response = await fetch(`${h.url}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, status); await response.json();
    }
    assert.equal(h.calls.filter(c => c.auth).length, 4);
    assert.deepEqual(h.calls.filter(c => c.name).map(c => c.name), [
      'plannix_list_personal_events', 'plannix_create_personal_event', 'plannix_update_personal_event', 'plannix_delete_personal_event']);
    assert.deepEqual(h.calls[3].args, { target_academic_year_id: year, target_date: fields.date,
      target_title: fields.title, target_start_time: null, target_end_time: null, target_location: null, target_notes: null });
    assert.equal(h.calls.some(c => c.args && ('organisationId' in c.args || 'userId' in c.args)), false);
  } finally { await h.close(); }
});
test('unknown fields, malformed dates and revisions fail before database access', async () => {
  const h = await harness();
  try {
    for (const [method, path, body] of [
      ['GET', `/api/events?academicYearId=${year}&ownerId=${id}`],
      ['GET', `/api/events?academicYearId=${year}&from=2026-02-30&to=2026-03-01`],
      ['POST', '/api/events', { academicYearId: year, event: { ...fields, userId: id } }],
      ['POST', '/api/events?ownerId=not-allowed', { academicYearId: year, event: fields }],
      ['POST', '/api/events', { academicYearId: year, event: { ...fields, date: '2026-02-30' } }],
      ['PUT', `/api/events/${id}`, { expectedRevision: 0, event: fields }],
      ['PUT', `/api/events/${id}?provider=openai`, { expectedRevision: 1, event: fields }],
      ['DELETE', `/api/events/${id}`, { expectedRevision: '1' }],
      ['DELETE', `/api/events/${id}?ownerId=${id}`, { expectedRevision: 1 }],
    ]) {
      const response = await fetch(`${h.url}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, 400);
    }
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});
test('RPC errors are mapped safely and cross-user event existence is not disclosed', async () => {
  for (const [code, status] of [['P0002', 404], ['42501', 403], ['40001', 409], ['23505', 409], ['P1001', 409], ['XX000', 500]]) {
    const h = await harness({ rpc: async () => ({ data: null, error: { code, message: 'raw synthetic secret in upstream response' } }) });
    try {
      const response = await fetch(`${h.url}/api/events/${id}`, { method: 'DELETE', headers, body: JSON.stringify({ expectedRevision: 1 }) });
      const body = await response.json();
      assert.equal(response.status, status);
      assert.doesNotMatch(JSON.stringify(body), /raw synthetic secret/);
    } finally { await h.close(); }
  }
});

test('request body, event text and upstream details never enter structured logs', async () => {
  const captured = [];
  const original = console.error;
  console.error = value => captured.push(String(value));
  const h = await harness({ rpc: async () => ({ data: null,
    error: { code: 'XX000', message: 'secret upstream event text' } }) });
  try {
    const response = await fetch(`${h.url}/api/events`, { method: 'POST', headers,
      body: JSON.stringify({ academicYearId: year, event: { ...fields, title: 'Synthetic private meeting' } }) });
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /secret upstream|Synthetic private meeting/);
    assert.doesNotMatch(captured.join('\n'), /secret upstream|Synthetic private meeting|synthetic-token/);
  } finally { console.error = original; await h.close(); }
});
