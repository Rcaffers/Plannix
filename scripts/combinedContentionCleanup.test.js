import test from 'node:test';
import assert from 'node:assert/strict';
import { runCombinedContention } from './combinedContentionCleanup.js';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const never = new Promise(() => {});

async function withControlledTimers(run) {
  const oldNow = Date.now;
  const oldSet = globalThis.setTimeout;
  const oldClear = globalThis.clearTimeout;
  const timers = new Map();
  let now = 1000; let next = 0;
  Date.now = () => now;
  globalThis.setTimeout = (callback, delay) => {
    const id = ++next;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  try {
    await run({
      advance(ms) {
        now += ms;
        for (const [id, timer] of [...timers]) if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      },
      active: () => timers.size,
    });
  } finally {
    Date.now = oldNow;
    globalThis.setTimeout = oldSet;
    globalThis.clearTimeout = oldClear;
  }
}

test('stuck child closure and cleanup query share one bounded budget', async () => {
  const reports = [];
  const started = Date.now();
  await assert.rejects(runCombinedContention({
    work: async registry => {
      await registry.acquire(() => ({ release: () => never, stop: () => never,
        finished: never }));
      throw Error('primary lock assertion');
    }, cleanup: () => never, operationMs: 100, cleanupMs: 35,
    report: error => reports.push(error.message),
  }), /primary lock assertion/);
  assert.ok(Date.now() - started < 250, 'cleanup did not share its deadline');
  assert.ok(reports.some(message => message.includes('rollback')));
  assert.ok(reports.some(message => message.includes('termination')));
  assert.ok(reports.some(message => message.includes('child closure')));
  assert.ok(reports.some(message => message.includes('fixture cleanup')));
});

test('cleanup failure is secondary to the original assertion', async () => {
  const primary = new assert.AssertionError({ message: 'intended lock failure' });
  const reports = [];
  await assert.rejects(runCombinedContention({
    work: async registry => {
      await registry.acquire(() => ({ release: () => { throw Error('rollback failed'); },
        stop: () => {}, finished: Promise.resolve(0) }));
      throw primary;
    }, cleanup: () => { throw Error('database cleanup failed'); },
    report: error => reports.push(error.message), cleanupMs: 100,
  }), error => error === primary);
  assert.deepEqual(reports, ['rollback failed: rollback failed',
    'fixture cleanup failed: database cleanup failed']);
});

test('timeout closes admission before late work can create a child', async () => {
  await withControlledTimers(async timers => {
    const gate = deferred();
    let factories = 0;
    const running = runCombinedContention({
      work: async registry => {
        await gate.promise;
        await registry.acquire(() => { factories++; return { stop() {}, finished: Promise.resolve() }; });
      }, cleanup: () => {}, operationMs: 100, cleanupMs: 100,
    });
    timers.advance(100);
    await assert.rejects(running, /operation exceeded its deadline/);
    gate.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(factories, 0, 'late acquisition did not invoke its child factory');
    assert.equal(timers.active(), 0);
  });
});

test('resource published during an in-progress acquisition is tracked at creation', async () => {
  await withControlledTimers(async timers => {
    const gate = deferred();
    const published = deferred();
    const closed = deferred();
    let stopped = 0; let released = 0;
    const resource = { release() { released++; }, stop() { stopped++; closed.resolve(); },
      finished: closed.promise };
    const running = runCombinedContention({
      work: registry => registry.acquire(async publish => {
        publish(resource);
        published.resolve();
        await gate.promise;
        return resource;
      }), cleanup: () => {}, operationMs: 100, cleanupMs: 100, report: () => {},
    });
    await published.promise;
    timers.advance(100);
    await new Promise(resolve => setImmediate(resolve));
    timers.advance(100);
    await assert.rejects(running, /operation exceeded its deadline/);
    assert.equal(stopped, 1, 'published child was terminated during cleanup');
    assert.equal(released, 1);
    gate.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, 1, 'late factory completion did not double-dispose');
  });
});

test('factory resolving only after cleanup immediately disposes its late child', async () => {
  await withControlledTimers(async timers => {
    const gate = deferred();
    const started = deferred();
    const closed = deferred();
    let stopped = 0;
    const running = runCombinedContention({
      work: registry => registry.acquire(async () => { started.resolve(); return gate.promise; }),
      cleanup: () => {}, operationMs: 100, cleanupMs: 100, report: () => {},
    });
    await started.promise;
    timers.advance(100);
    await new Promise(resolve => setImmediate(resolve));
    timers.advance(100);
    await assert.rejects(running, /operation exceeded its deadline/);
    gate.resolve({ stop() { stopped++; closed.resolve(); }, finished: closed.promise });
    await closed.promise;
    assert.equal(stopped, 1);
  });
});

test('late rejection and cleanup failure do not replace the timeout', async () => {
  const gate = deferred();
  const reports = [];
  await assert.rejects(runCombinedContention({
    work: async () => gate.promise,
    cleanup: () => { throw Error('synthetic cleanup failure'); },
    operationMs: 5, cleanupMs: 20,
    report: error => reports.push(error.message),
  }), /operation exceeded its deadline/);
  assert.deepEqual(reports, ['fixture cleanup failed: synthetic cleanup failure']);
  gate.reject(Error('late operation failure'));
  await new Promise(resolve => setImmediate(resolve));
});

test('invalid deadlines reject before resource acquisition', async () => {
  let called = false;
  await assert.rejects(runCombinedContention({
    work: () => { called = true; }, cleanup: () => {}, operationMs: 0,
  }), /Invalid contention deadlines/);
  assert.equal(called, false);
});
