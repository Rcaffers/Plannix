import assert from 'node:assert/strict';
import test from 'node:test';
import { createMorningSummaryDetailService } from './detail.js';

const userId = 'cb000000-0000-4000-8000-000000000001';
const sessionId = 'cb000000-0000-4000-8000-000000000002';
const installationVersion = 'cb000000-0000-4000-8000-000000000003';
const notificationRef = 'cb000000-0000-4000-8000-000000000004';
const endpointHash = 'a'.repeat(64);
const input = { userId, sessionId, installationVersion, notificationRef, endpointHash };
const config = { supabaseUrl: 'https://example.test', supabaseSecretKey: 'synthetic',
  morningSummaryPilotUserId: userId };
const summary = { date: '2026-11-03', week: 'A', lessons: [
  { period: 1, className: 'Synthetic class', title: 'Synthetic lesson', isPpa: false },
], events: [{ title: 'Synthetic event' }] };

function fixture({ decisions = [{ ownerId: userId, eventTitleConsent: false }], delayed } = {}) {
  const calls = [];
  const service = createMorningSummaryDetailService({ config,
    createClientImpl: () => ({ rpc: async (name, args) => {
      calls.push(['authorize', name, args]);
      return { data: decisions.shift() ?? null, error: null };
    } }),
    delivery: { resolveReference: async (owner, ref) => {
      calls.push(['snapshot', owner, ref]);
      if (delayed) await delayed;
      return summary;
    } },
  });
  return { service, calls };
}

test('detail authorization uses verified session and rechecks after snapshot; event titles have separate consent', async () => {
  const first = fixture({ decisions: [
    { ownerId: userId, eventTitleConsent: false }, { ownerId: userId, eventTitleConsent: false },
  ] });
  assert.deepEqual(await first.service.resolve(input), {
    date: summary.date, week: 'A', lessons: summary.lessons,
    events: [], eventTitlesIncluded: false,
  });
  assert.deepEqual(first.calls.map(call => call[0]), ['authorize', 'snapshot', 'authorize']);
  assert.deepEqual(first.calls[0][2], { target_session: sessionId, target_hash: endpointHash,
    target_version: installationVersion, target_reference: notificationRef, target_pilot: userId });
  const second = fixture({ decisions: [
    { ownerId: userId, eventTitleConsent: false }, { ownerId: userId, eventTitleConsent: true },
  ] });
  assert.deepEqual((await second.service.resolve(input)).events, [{ title: 'Synthetic event' }]);
});

test('revocation, reassignment or consent change during delayed snapshot denies all detail', async () => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const h = fixture({ delayed, decisions: [{ ownerId: userId, eventTitleConsent: true }, null] });
  const pending = h.service.resolve(input);
  while (!h.calls.some(call => call[0] === 'snapshot')) await new Promise(resolve => setImmediate(resolve));
  release();
  await assert.rejects(pending, /unavailable/);
  assert.deepEqual(h.calls.map(call => call[0]), ['authorize', 'snapshot', 'authorize']);
});

test('wrong account, invalid selectors and database errors fail without resolving the snapshot or exposing data', async () => {
  const foreign = fixture({ decisions: [{ ownerId: 'cb000000-0000-4000-8000-000000000099', eventTitleConsent: true }] });
  await assert.rejects(foreign.service.resolve(input), /unavailable/);
  assert.equal(foreign.calls.length, 1);
  await assert.rejects(foreign.service.resolve({ ...input, endpointHash: 'invalid' }), /unavailable/);
  assert.equal(foreign.calls.length, 1);
  const failed = createMorningSummaryDetailService({ config, createClientImpl: () => ({
    rpc: async () => ({ data: null, error: { message: 'synthetic-private-token' } }),
  }), delivery: { resolveReference: () => { throw new Error('must not run'); } } });
  await assert.rejects(failed.resolve(input), error => !JSON.stringify(error).includes('synthetic-private-token'));
});
