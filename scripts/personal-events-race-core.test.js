import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLockObservation, runContendedPair, waitForActualBlock } from './personal-events-race-core.js';

const blocked = {
  aPid: 101, bPid: 102, aName: 'fixture-a', bName: 'fixture-b',
  bState: 'active', waitType: 'Lock', bQuery: 'select public.plannix_create_personal_event()',
  blockers: [101], waitingLocks: [{ locktype: 'transactionid', granted: false }],
};
const output = row => JSON.stringify(row);

test('only a real PostgreSQL lock wait blocked by the named holder counts', async () => {
  assert.deepEqual(await waitForActualBlock({
    observe: async () => output(blocked), aName: 'fixture-a', bName: 'fixture-b',
    expectedQuery: 'plannix_create_personal_event',
  }), { aPid: 101, bPid: 102, lockTypes: ['transactionid'] });
  for (const patch of [
    { blockers: [] }, { waitType: 'Client' }, { bState: 'idle' },
    { bQuery: 'select 1' }, { waitingLocks: [] }, { aPid: 102 },
  ]) {
    let time = 0;
    await assert.rejects(waitForActualBlock({
      observe: async () => output({ ...blocked, ...patch }),
      aName: 'fixture-a', bName: 'fixture-b', expectedQuery: 'plannix_create_personal_event',
      deadlineMs: 2, intervalMs: 1, now: () => ++time, pause: async () => {},
    }), /never blocked|malformed/);
  }
});

test('empty and malformed observations fail closed', async () => {
  for (const value of ['', 'not-json', '{}', output({ ...blocked, blockers: null }),
    output({ ...blocked, aName: 'another-session' })]) {
    assert.throws(() => parseLockObservation(value, 'fixture-a', 'fixture-b'), /malformed/);
  }
});

function pair({ firstWait, secondWait, observe = async () => output(blocked),
  exit = { ok: true }, inspect = async () => {} } = {}) {
  const calls = [];
  const first = { name: 'fixture-a', send: value => calls.push('a:' + value),
    waitFor: async value => { calls.push('a:wait:' + value); if (firstWait) throw firstWait; },
    waitExit: async () => exit };
  const second = { name: 'fixture-b', send: value => calls.push('b:' + value),
    waitFor: async value => { calls.push('b:wait:' + value); if (secondWait) throw secondWait; },
    waitExit: async () => exit };
  const run = () => runContendedPair({ first, second, observe,
    expectedQuery: 'plannix_create_personal_event', inspect,
    cleanup: async () => { calls.push('cleanup'); } });
  return { calls, run };
}

test('an unreached barrier cleans up without starting the competing operation', async () => {
  const { calls, run } = pair({ firstWait: new Error('barrier timeout') });
  await assert.rejects(run(), /barrier timeout/);
  assert.deepEqual(calls, ['a:wait:READY', 'cleanup']);
});

test('a competitor that never blocks cannot release the holder and still cleans up', async () => {
  const { calls, run } = pair({ observe: async () => '' });
  await assert.rejects(run(), /malformed/);
  assert.ok(calls.includes('b:OPERATE'));
  assert.ok(!calls.includes('a:COMMIT'));
  assert.equal(calls.at(-1), 'cleanup');
});

test('child timeout or failure prevents success and invokes cleanup', async () => {
  const timedOut = pair({ secondWait: new Error('child timeout') });
  await assert.rejects(timedOut.run(), /child timeout/);
  assert.equal(timedOut.calls.at(-1), 'cleanup');
  const failed = pair({ exit: { ok: false },
    inspect: async (a, b) => { assert.equal(a.ok && b.ok, true); } });
  await assert.rejects(failed.run(), /false !== true/);
  assert.equal(failed.calls.at(-1), 'cleanup');
});

test('failed final-state assertions clean up; successful inspection follows observed block', async () => {
  const failed = pair({ inspect: async () => { throw new Error('final state failed'); } });
  await assert.rejects(failed.run(), /final state failed/);
  assert.equal(failed.calls.at(-1), 'cleanup');
  const good = pair({ inspect: async (_a, _b, block) => {
    assert.deepEqual(block.lockTypes, ['transactionid']);
  } });
  await good.run();
  assert.ok(good.calls.indexOf('b:OPERATE') < good.calls.indexOf('a:COMMIT'));
  assert.equal(good.calls.at(-1), 'cleanup');
});
