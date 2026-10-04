import assert from 'node:assert/strict';
import test from 'node:test';
import { createMorningSummaryPreferenceService, MorningSummaryPreferenceConflict, validDeliveryTime } from './preferences.js';

const userId = 'cb000000-0000-4000-8000-000000000001';
const yearId = 'cb000000-0000-4000-8000-000000000010';
const config = { supabaseUrl: 'https://example.test', supabaseSecretKey: 'synthetic-private-fixture' };

test('time validation is exact and preferences use fresh service-role RPC clients', async () => {
  assert.equal(validDeliveryTime('00:00'), true); assert.equal(validDeliveryTime('23:59'), true);
  for (const invalid of ['24:00', '7:00', '07:60', '', null]) assert.equal(validDeliveryTime(invalid), false);
  const calls = [];
  const service = createMorningSummaryPreferenceService({ config, createClientImpl: (_url, _key, options) => {
    assert.equal(options.auth.persistSession, false);
    return { rpc: async (name, args) => { calls.push([name, args]); return { data: name.includes('get_')
      ? { enabled: false, deliveryTime: '07:00', revision: 0, academicYearId: null }
      : { enabled: true, deliveryTime: '08:30', revision: 1, academicYearId: yearId }, error: null }; } };
  } });
  assert.deepEqual(await service.load(userId), { enabled: false, deliveryTime: '07:00', revision: 0, academicYearId: null });
  assert.deepEqual(await service.save(userId, { enabled: true, deliveryTime: '08:30', revision: 0, academicYearId: yearId }),
    { enabled: true, deliveryTime: '08:30', revision: 1, academicYearId: yearId });
  assert.deepEqual(calls.map(item => item[0]), ['plannix_get_morning_summary_preferences', 'plannix_save_morning_summary_preferences']);
  assert.ok(calls.every(item => item[1].validated_user_id === userId));
  assert.equal(calls[1][1].expected_revision, 0);
  assert.equal(calls[1][1].target_academic_year_id, yearId);
});

test('malformed IDs/results and database errors fail without exposing diagnostics', async () => {
  const service = createMorningSummaryPreferenceService({ config, createClientImpl: () => ({ rpc: async () => ({
    data: { enabled: 'true', deliveryTime: '07:00', credential: 'synthetic-sensitive-marker' }, error: null,
  }) }) });
  await assert.rejects(service.load('invalid'), /unavailable/);
  await assert.rejects(service.load(userId), error => !JSON.stringify(error).includes('synthetic-sensitive-marker'));
  const failed = createMorningSummaryPreferenceService({ config, createClientImpl: () => ({ rpc: async () => ({
    data: null, error: { message: 'synthetic-sensitive-marker' },
  }) }) });
  await assert.rejects(failed.load(userId), error => !JSON.stringify(error).includes('synthetic-sensitive-marker'));
  const conflict = createMorningSummaryPreferenceService({ config, createClientImpl: () => ({ rpc: async () => ({
    data: null, error: { code: '40001', message: 'synthetic-private-row' },
  }) }) });
  await assert.rejects(conflict.save(userId, { enabled: true, deliveryTime: '07:00', revision: 0, academicYearId: yearId }),
    error => error instanceof MorningSummaryPreferenceConflict && !JSON.stringify(error).includes('synthetic-private-row'));
  assert.throws(() => failed.save(userId, { enabled: true, deliveryTime: '07:00', revision: -1 }), /unavailable/);
});
