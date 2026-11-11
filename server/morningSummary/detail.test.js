import assert from 'node:assert/strict';
import test from 'node:test';
import { createMorningSummaryDetailService } from './detail.js';

const userId = 'cb000000-0000-4000-8000-000000000001';
const sessionId = 'cb000000-0000-4000-8000-000000000002';
const installationVersion = 'cb000000-0000-4000-8000-000000000003';
const detailPolicyVersion = 'cb000000-0000-4000-8000-000000000005';
const notificationRef = 'cb000000-0000-4000-8000-000000000004';
const endpointHash = 'a'.repeat(64);
const input = { userId, sessionId, installationVersion, detailPolicyVersion, notificationRef, endpointHash };
const config = { supabaseUrl: 'https://example.test', supabaseSecretKey: 'synthetic',
  morningSummaryPilotUserId: userId };
const summary = { date: '2026-11-03', week: 'A', lessons: [
  { period: 1, className: 'Synthetic class', title: 'Synthetic lesson', isPpa: false },
], events: [{ title: 'Synthetic event' }] };

function fixture({ decisions = [{ ownerId: userId, lessonDetailConsent: true,
  eventTitleConsent: false }], delayed, snapshot = summary } = {}) {
  const calls = [];
  const service = createMorningSummaryDetailService({ config,
    createClientImpl: () => ({ rpc: async (name, args) => {
      calls.push(['authorize', name, args]);
      return { data: decisions.shift() ?? null, error: null };
    } }),
    delivery: { resolveReference: async (owner, ref) => {
      calls.push(['snapshot', owner, ref]);
      if (delayed) await delayed;
      return snapshot;
    } },
  });
  return { service, calls };
}

test('detail authorization uses verified session and rechecks after snapshot; event titles have separate consent', async () => {
  const first = fixture({ decisions: [
    { ownerId: userId, lessonDetailConsent: true, eventTitleConsent: false },
    { ownerId: userId, lessonDetailConsent: true, eventTitleConsent: false },
  ] });
  assert.deepEqual(await first.service.resolve(input), {
    date: summary.date, week: 'A', lessons: summary.lessons,
    events: [], lessonDetailsIncluded: true, eventTitlesIncluded: false,
  });
  assert.deepEqual(first.calls.map(call => call[0]), ['authorize', 'snapshot', 'authorize']);
  assert.deepEqual(first.calls[0][2], { target_session: sessionId, target_hash: endpointHash,
    target_version: installationVersion, target_reference: notificationRef, target_pilot: userId,
    target_policy_version:detailPolicyVersion });
  const second = fixture({ decisions: [
    { ownerId: userId, lessonDetailConsent: true, eventTitleConsent: false },
    { ownerId: userId, lessonDetailConsent: true, eventTitleConsent: true },
  ] });
  assert.deepEqual((await second.service.resolve(input)).events, [{ title: 'Synthetic event' }]);
  const eventOnly = fixture({ decisions: [
    { ownerId:userId, lessonDetailConsent:false, eventTitleConsent:true },
    { ownerId:userId, lessonDetailConsent:false, eventTitleConsent:true },
  ] });
  assert.deepEqual(await eventOnly.service.resolve(input), {
    date:summary.date, week:'A', lessons:[], events:[{title:'Synthetic event'}],
    lessonDetailsIncluded:false, eventTitlesIncluded:true,
  });
});

test('detail response exposes at most five authorized periods and two independently consented event titles', async () => {
  const snapshot = { date:summary.date, week:'A',
    lessons:Array.from({length:6}, (_, index) => ({period:`P${index + 1}`,
      className:'Synthetic class',title:'Synthetic lesson',isPpa:false})),
    events:Array.from({length:3}, (_, index) => ({title:`Synthetic event ${index + 1}`})) };
  const both = fixture({snapshot, decisions:Array(2).fill({ownerId:userId,
    lessonDetailConsent:true,eventTitleConsent:true})});
  const result = await both.service.resolve(input);
  assert.deepEqual(result.lessons,snapshot.lessons.slice(0,5));
  assert.deepEqual(result.events,snapshot.events.slice(0,2));
  const lessonsOnly = fixture({snapshot,decisions:Array(2).fill({ownerId:userId,
    lessonDetailConsent:true,eventTitleConsent:false})});
  assert.deepEqual((await lessonsOnly.service.resolve(input)).events,[]);
  const eventsOnly = fixture({snapshot,decisions:Array(2).fill({ownerId:userId,
    lessonDetailConsent:false,eventTitleConsent:true})});
  assert.deepEqual((await eventsOnly.service.resolve(input)).lessons,[]);
});

test('revocation, reassignment or consent change during delayed snapshot denies all detail', async () => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const h = fixture({ delayed, decisions: [{ ownerId: userId, lessonDetailConsent:true,
    eventTitleConsent:true }, null] });
  const pending = h.service.resolve(input);
  while (!h.calls.some(call => call[0] === 'snapshot')) await new Promise(resolve => setImmediate(resolve));
  release();
  await assert.rejects(pending, /unavailable/);
  assert.deepEqual(h.calls.map(call => call[0]), ['authorize', 'snapshot', 'authorize']);
});

test('wrong account, invalid selectors and database errors fail without resolving the snapshot or exposing data', async () => {
  const foreign = fixture({ decisions: [{ ownerId: 'cb000000-0000-4000-8000-000000000099',
    lessonDetailConsent:true, eventTitleConsent:true }] });
  await assert.rejects(foreign.service.resolve(input), /unavailable/);
  assert.equal(foreign.calls.length, 1);
  await assert.rejects(foreign.service.resolve({ ...input, endpointHash: 'invalid' }), /unavailable/);
  assert.equal(foreign.calls.length, 1);
  const failed = createMorningSummaryDetailService({ config, createClientImpl: () => ({
    rpc: async () => ({ data: null, error: { message: 'synthetic-private-token' } }),
  }), delivery: { resolveReference: () => { throw new Error('must not run'); } } });
  await assert.rejects(failed.resolve(input), error => !JSON.stringify(error).includes('synthetic-private-token'));
});
