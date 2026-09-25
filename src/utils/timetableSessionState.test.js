import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertUniqueSessionSlots, createSerializedSaveQueue, displayToSession, sessionToDisplay } from './timetableSessionState.js';

const period = '10000000-0000-4000-8000-000000000001';
const klass = '10000000-0000-4000-8000-000000000002';

function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('display mapping uses authoritative period/class identities and no persisted row or class name', () => {
  const display = sessionToDisplay({ day: 0, periodId: period, classId: klass, title: '', notes: '' }, new Map([[period, 4]]), new Map([[klass, 'Maths']]), 'temporary-1');
  assert.equal(display.time, 4); assert.equal(display.class, 'Maths'); assert.equal(display.id, undefined);
  assert.deepEqual(displayToSession(display, new Map([[4, period]])), { day: 0, periodId: period, classId: klass, title: '', notes: '' });
});

test('serialized queue coalesces edits and advances authoritative revision before the next save', async () => {
  const first = deferred(); const calls = []; const applied = [];
  const queue = createSerializedSaveQueue({ save: async (value) => { calls.push(value); if (calls.length === 1) return first.promise; return { revision: 2, sessions: value }; },
    onOptimistic() {}, onAuthoritative: (value) => applied.push(value), onError: assert.fail });
  queue.enqueue(['first']); queue.enqueue(['second']); queue.enqueue(['latest']);
  assert.deepEqual(calls, [['first']]); first.resolve({ revision: 1, sessions: ['server-first'] });
  await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [['first'], ['latest']]); assert.deepEqual(applied.map((entry) => entry.revision), [1, 2]); assert.equal(queue.pending, false);
});

test('failed saves stop rather than report success and retry deliberately', async () => {
  const calls = []; const failures = [];
  const queue = createSerializedSaveQueue({ save: async (value) => { calls.push(value); if (calls.length === 1) throw Object.assign(new Error('conflict'), { status: 409 }); return { revision: 3 }; },
    onOptimistic() {}, onAuthoritative() {}, onError: (error, value) => failures.push({ error, value }) });
  queue.enqueue(['edit']); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.conflicted, true); assert.deepEqual(failures[0].value, ['edit']); assert.equal(queue.enqueue(['lost']), false);
  queue.retry(['edit']); await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls.length, 2);
});

test('reset invalidates in-flight responses and supports scope cleanup', async () => {
  const pending = deferred(); let applied = 0;
  const queue = createSerializedSaveQueue({ save: () => pending.promise, onOptimistic() {}, onAuthoritative: () => { applied += 1; }, onError: assert.fail });
  queue.enqueue(['old-user']); queue.reset(); pending.resolve({ revision: 1 }); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied, 0); assert.equal(queue.pending, false);
});

test('context retains cleanup, batch persistence and transition protection without unused restore points', () => {
  const context = fs.readFileSync(new URL('../context/TimetableSessionContext.jsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(context, /overrideExists/); assert.match(context, /removeOverride/); assert.match(context, /saveBatch/);
  assert.match(context, /createSerializedSaveQueue/); assert.doesNotMatch(context, /restorePoint|setCurrentRestorePoint|undoRestorePoint/);
  assert.match(context, /generation\.current/); assert.match(context, /__plannixConfirmSessionDiscard/);
  assert.match(app, /__plannixConfirmSessionDiscard/);
  assert.equal((app.match(/<TimetableSessionProvider user=\{user\}>/g) || []).length, 1);
});

test('canonical duplicate-slot assertion rejects duplicates before optimistic enqueue', () => {
  const first = { id: 'first', day: 0, periodId: 'ABCD' };
  assert.throws(() => assertUniqueSessionSlots([first, { ...first, id: 'second', periodId: 'abcd' }]), /Duplicate timetable slot/);
  assert.doesNotThrow(() => assertUniqueSessionSlots([first, { ...first, day: 1 }]));
  const context = fs.readFileSync(new URL('../context/TimetableSessionContext.jsx', import.meta.url), 'utf8');
  const edit = context.slice(context.indexOf('const edit ='), context.indexOf('const retry ='));
  assert.ok(edit.indexOf('assertUniqueSessionSlots(sessions)') < edit.indexOf('ensureQueue(target).enqueue(sessions)'));
});
test('reload resets a stopped queue so subsequent moves can save', async () => {
  let fail = true; const calls = [];
  const queue = createSerializedSaveQueue({ save: async value => { calls.push(value); if (fail) throw new Error('Conflict'); return value; },
    onOptimistic() {}, onAuthoritative() {}, onError() {} });
  queue.enqueue(['swap']); await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.enqueue(['move']), false);
  queue.reset(); fail = false;
  assert.equal(queue.enqueue(['move']), true); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['swap'], ['move']]);

});

test('atomic swap migration retains final uniqueness and existing RPC validation', () => {
  const migration = fs.readFileSync(new URL('../../supabase/migrations/20260924130000_allow_atomic_timetable_session_swaps.sql', import.meta.url), 'utf8');
  assert.match(migration, /unique \(collection_id, day_number, period_id\) deferrable initially immediate/);
  assert.match(migration, /set constraints public.uq_plannix_timetable_session_slot deferred/);
  const validate = migration.indexOf('set constraints public.uq_plannix_timetable_session_slot immediate');
  assert.ok(validate > migration.indexOf('end loop;'));
  assert.ok(validate < migration.indexOf('return private.plannix_session_json'));
  assert.match(migration, /Session IDs must be unique/);
  assert.match(migration, /Timetable session slots must be unique/);
  assert.match(migration, /A session ID belongs to another collection/);
  assert.match(migration, /Session period must be an enabled teaching period/);
  assert.match(migration, /on conflict \(id\) do update/);
  assert.doesNotMatch(migration, /disable trigger|drop policy|disable row level security/i);
});
