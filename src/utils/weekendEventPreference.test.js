import assert from 'node:assert/strict';
import test from 'node:test';
import { readWeekendEventsPreference, weekendEventsPreferenceKey, writeWeekendEventsPreference } from './weekendEventPreference.js';

const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
};

test('weekend events require an explicit enabled preference and persist independently per user', () => {
  const local = storage();
  const notifications = [];
  assert.equal(readWeekendEventsPreference(USER_A, local), false);
  assert.equal(readWeekendEventsPreference(USER_B, local), false);
  assert.equal(writeWeekendEventsPreference(USER_A, false, local, notice => notifications.push(notice)), true);
  assert.equal(readWeekendEventsPreference(USER_A, local), false);
  assert.equal(readWeekendEventsPreference(USER_B, local), false);
  assert.equal(local.values.size, 1);
  assert.equal(local.values.get(weekendEventsPreferenceKey(USER_A)), 'false');
  assert.equal(writeWeekendEventsPreference(USER_B, false, local, notice => notifications.push(notice)), true);
  assert.equal(writeWeekendEventsPreference(USER_A, true, local, notice => notifications.push(notice)), true);
  assert.equal(readWeekendEventsPreference(USER_A, local), true);
  assert.equal(readWeekendEventsPreference(USER_B, local), false);
  assert.deepEqual(notifications.map(item => item.userId), [USER_A, USER_B, USER_A]);
  local.values.set(weekendEventsPreferenceKey(USER_B), 'unexpected');
  assert.equal(readWeekendEventsPreference(USER_B, local), false);
});

test('invalid user IDs and unavailable storage cannot leak or overwrite another preference', () => {
  const local = storage();
  assert.equal(weekendEventsPreferenceKey('../other'), null);
  assert.equal(writeWeekendEventsPreference('../other', false, local, () => {}), false);
  assert.equal(readWeekendEventsPreference('../other', local), false);
  assert.equal(local.values.size, 0);
  assert.equal(readWeekendEventsPreference(USER_A, { getItem: () => { throw Error('blocked'); } }), false);
  assert.equal(writeWeekendEventsPreference(USER_A, false, { setItem: () => { throw Error('blocked'); } }, () => {}), false);
});
