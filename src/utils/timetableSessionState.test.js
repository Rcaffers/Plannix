import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSerializedSaveQueue, displayToSession, sessionToDisplay } from './timetableSessionState.js';

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

test('context includes restore point modes, cleanup, batch persistence and transition protection', () => {
  const context = fs.readFileSync(new URL('../context/TimetableSessionContext.jsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(context, /overrideExists/); assert.match(context, /removeOverride/); assert.match(context, /saveBatch/);
  assert.match(context, /createSerializedSaveQueue/); assert.match(context, /setRestorePoint\(null\)/);
  assert.match(context, /generation\.current/); assert.match(context, /__plannixConfirmSessionDiscard/);
  assert.match(app, /__plannixConfirmSessionDiscard/);
  assert.equal((app.match(/<TimetableSessionProvider user=\{user\}>/g) || []).length, 1);
});
