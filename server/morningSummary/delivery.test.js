import assert from 'node:assert/strict';
import test from 'node:test';
import { createMorningSummaryDelivery, summaryPayload, GENERIC_SUMMARY_BODY } from './delivery.js';
import { endpointHash } from '../push/subscription.js';
import { buildMorningSummary } from '../../src/utils/morningSummary.js';

const userId = 'cb000000-0000-4000-8000-000000000041';
const yearId = 'cb000000-0000-4000-8000-000000000042';
const weekId = 'cb000000-0000-4000-8000-000000000043';
const periodId = 'cb000000-0000-4000-8000-000000000044';
const classId = 'cb000000-0000-4000-8000-000000000045';
const token = 'cb000000-0000-4000-8000-000000000046';
const version = 'cb000000-0000-4000-8000-000000000047';
const notificationRef = 'cb000000-0000-4000-8000-000000000048';
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-device';
const keys = { p256dh: 'x'.repeat(88), auth: 'y'.repeat(22) };
const hash = endpointHash(endpoint);
const config = { supabaseUrl: 'https://example.test', supabaseSecretKey: 'synthetic-fixture' };
const vapid = { subject: 'mailto:fixture@example.test', publicKey: 'synthetic-public', privateKey: 'synthetic-private' };
const snapshot = {
  year: { id: yearId, startDate: '2026-09-01', endDate: '2027-08-31' }, date: '2026-10-05',
  dated: { weekStartDate: '2026-10-05', repeatingWeekId: weekId,
    sessions: [{ day: 0, periodId, classId, title: 'Fractions', notes: 'private lesson notes' }] },
  periods: [{ id: periodId, type: 'teaching', enabled: true, order: 1, number: 1, startTime: '09:00', endTime: '10:00' }],
  weeks: [{ id: weekId, code: 'A' }], classes: [{ id: classId, name: '7A' }],
  events: [{ id: 'event-1', date: '2026-10-05', title: 'Assembly', startTime: null, endTime: null,
    location: 'Hall', notes: 'private event notes' }],
};

function harness({ claim = true, send = async () => ({ statusCode: 201 }), snapshotValue = snapshot,
  dispatchSeconds = 600, monotonicNow = () => 0, onDeviceClaim = () => {}, referenceDenied = false } = {}) {
  const calls = []; const pushes = [];
  const service = createMorningSummaryDelivery({ config, getPushConfiguration: () => vapid,
    createClientImpl: () => ({ rpc: async (name, args) => {
      calls.push([name, args]);
      if (referenceDenied && name === 'plannix_morning_summary_notification_snapshot')
        return { data: null, error: { code: 'P0002', message: 'Synthetic foreign reference' } };
      const data = name === 'plannix_claim_morning_summary_pilot_jobs'
        ? claim ? [{ userId, academicYearId: yearId, date: '2026-10-05', token, revision: 1, notificationRef }] : []
        : name === 'plannix_morning_summary_snapshot'
          || name === 'plannix_morning_summary_notification_snapshot' ? snapshotValue
          : name === 'plannix_morning_summary_device_hashes' ? [hash]
            : name === 'plannix_claim_morning_summary_device' ? (onDeviceClaim(), { endpoint, keys, version })
              : name === 'plannix_morning_summary_dispatch_seconds'
                ? typeof dispatchSeconds === 'function' ? dispatchSeconds() : dispatchSeconds : true;
      return { data, error: null };
    } }),
    monotonicNow,
    pushImpl: { sendNotification: async (...args) => { pushes.push(args); return send(...args); } },
  });
  return { service, calls, pushes };
}

test('snapshot and preview share canonical Week A ordering while the push contains generic text only', async () => {
  const { service, calls, pushes } = harness();
  const expectedPreview = buildMorningSummary({ date: snapshot.date, dated: snapshot.dated,
    periods: snapshot.periods, classes: snapshot.classes, events: snapshot.events, weeks: snapshot.weeks });
  assert.deepEqual(await service.resolve(userId, yearId, '2026-10-05'), expectedPreview,
    'scheduler and preview use the same summary transformation');
  assert.deepEqual(await service.resolveReference(userId, notificationRef), expectedPreview,
    'authenticated reference resolves the same complete day after access checks');
  assert.deepEqual((await service.run({ pilotUserId: userId })).claimed, 1);
  assert.equal(pushes.length, 1);
  const payload = JSON.parse(pushes[0][1]);
  assert.equal(payload.notificationRef, notificationRef);
  assert.equal(payload.date, undefined);
  assert.equal(payload.academicYearId, undefined);
  assert.equal(payload.body, GENERIC_SUMMARY_BODY);
  assert.doesNotMatch(JSON.stringify(payload), /7A|Fractions|Assembly|private|notes|pupil/);
  assert.equal(pushes[0][2].TTL, 600);
  assert.equal(calls.filter(([name]) => name === 'plannix_morning_summary_dispatch_seconds').length, 1);
  assert.equal(calls.find(([name]) => name === 'plannix_finish_morning_summary_device')[1].target_state, 'accepted');
  assert.equal(calls.filter(([name]) => name === 'plannix_finish_morning_summary_job').length, 1);
});

test('failed snapshot prevents all device claims and provider calls', async () => {
  const { service, calls, pushes } = harness({ snapshotValue: { ...snapshot, dated: null } });
  await assert.rejects(service.run({ pilotUserId: userId }), /unavailable/);
  assert.equal(calls.some(([name]) => name === 'plannix_claim_morning_summary_device'), false);
  assert.equal(pushes.length, 0);
});

test('explicit rejection is retryable; unknown outcome stays uncertain; expiry conditionally removes exact version', async () => {
  for (const [statusCode, expected] of [[429, 'retryable'], [undefined, 'uncertain'], [410, 'expired']]) {
    const { service, calls } = harness({ send: async () => {
      if (statusCode === undefined) throw Error('synthetic lost response');
      return { statusCode };
    } });
    await service.run({ pilotUserId: userId });
    assert.equal(calls.find(([name]) => name === 'plannix_finish_morning_summary_device')[1].target_state, expected);
    assert.equal(calls.some(([name]) => name === 'plannix_push_remove_expired_device'), expected === 'expired');
    if (expected === 'expired') assert.equal(calls.find(([name]) => name === 'plannix_push_remove_expired_device')[1].claimed_version, version);
  }
});

test('no claim means no send; invalid payloads fail before transport', async () => {
  const empty = harness({ claim: false });
  await assert.rejects(empty.service.run(), /unavailable/);
  assert.equal(empty.calls.length, 0, 'missing pilot scope cannot reach the database');
  assert.equal((await empty.service.run({ pilotUserId: userId })).claimed, 0);
  assert.equal(empty.calls[0][0], 'plannix_claim_morning_summary_pilot_jobs');
  assert.equal(empty.calls[0][1].pilot_user, userId);
  assert.equal(empty.pushes.length, 0);
  assert.throws(() => summaryPayload({ date: '2026-10-05', lessons: [], events: [] }, 'foreign'), /unavailable/);
  const invalid = harness({ snapshotValue: { ...snapshot, year: { ...snapshot.year, id: userId } } });
  await assert.rejects(invalid.service.run({ pilotUserId: userId }), /unavailable/);
  assert.equal(invalid.pushes.length, 0);
  const bounded = summaryPayload({ date: '2026-10-05', lessons: Array.from({ length: 20 }, (_, index) =>
    ({ period: `P${index + 1}`, className: '7A', title: '📚'.repeat(80), isPpa: false })),
  events: [] }, notificationRef);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 1024);
  assert.ok(!bounded.body.endsWith('\ud83d'), 'UTF-8 truncation keeps code points intact');
  assert.throws(() => summaryPayload({ date: '2026-10-05', lessons: [], events: [] }, notificationRef), /unavailable/);
});

test('reassignment after claim skips transport; reassignment immediately before send cannot reveal old content', async () => {
  let currentVersion = version;
  const beforeCheck = harness({ onDeviceClaim: () => { currentVersion = userId; },
    dispatchSeconds: () => currentVersion === version ? 600 : null });
  await beforeCheck.service.run({ pilotUserId: userId });
  assert.equal(beforeCheck.pushes.length, 0);
  assert.equal(beforeCheck.calls.find(([name]) => name === 'plannix_finish_morning_summary_device')[1].target_state, 'skipped');

  const beforeSend = harness({ send: async (_device, rawPayload) => {
    currentVersion = userId;
    assert.equal(JSON.parse(rawPayload).body, GENERIC_SUMMARY_BODY);
    assert.doesNotMatch(rawPayload, /Fractions|Assembly|7A/);
    return { statusCode: 201 };
  } });
  await beforeSend.service.run({ pilotUserId: userId });
  assert.equal(beforeSend.pushes.length, 1);
  const foreign = harness({ referenceDenied: true });
  await assert.rejects(foreign.service.resolveReference(userId, notificationRef), /unavailable/);
});

test('delivery-window check bounds TTL and skips an attempt crossing the cutoff, including retries', async () => {
  let tick = 0;
  const nearCutoff = harness({ dispatchSeconds: 2, monotonicNow: () => tick++ ? 1200 : 0 });
  await nearCutoff.service.run({ pilotUserId: userId });
  assert.equal(nearCutoff.pushes.length, 0);
  assert.equal(nearCutoff.calls.find(([name]) => name === 'plannix_finish_morning_summary_device')[1].target_state, 'skipped');
  const inside = harness({ dispatchSeconds: 14 });
  await inside.service.run({ pilotUserId: userId });
  assert.equal(inside.pushes[0][2].TTL, 14);
  const retryAtCutoff = harness({ dispatchSeconds: null });
  await retryAtCutoff.service.run({ pilotUserId: userId });
  assert.equal(retryAtCutoff.pushes.length, 0);
});

test('polling AbortSignal reaches the database request and prevents transport', async () => {
  const controller = new AbortController(); let receivedSignal; let pushes = 0;
  const service = createMorningSummaryDelivery({ config, getPushConfiguration: () => vapid,
    createClientImpl: () => ({ rpc: () => ({ abortSignal: signal => {
      receivedSignal = signal;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('synthetic abort')), { once: true }));
    } }) }),
    pushImpl: { sendNotification: async () => { pushes++; return { statusCode: 201 }; } },
  });
  const running = service.run({ pilotUserId: userId, signal: controller.signal });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(receivedSignal, controller.signal);
  controller.abort();
  await assert.rejects(running, /unavailable/);
  assert.equal(pushes, 0);
});
