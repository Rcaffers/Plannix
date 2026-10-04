import assert from 'node:assert/strict';
import test from 'node:test';
import { createMorningSummaryPolling } from './polling.js';
import { pilotUserFromEnvironment } from './pilotConfig.js';

const pilotUserId = 'cb000000-0000-4000-8000-000000000041';

function clock(initial = 10_000) {
  let time = initial; let serial = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer: (callback, delay) => { const id = ++serial; timers.set(id, { at: time + delay, callback }); return id; },
    clearTimer: id => timers.delete(id),
    async advance(milliseconds) {
      const end = time + milliseconds;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      }
      time = end;
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    },
  };
}

const logger = () => ({ info() {}, error() {} });
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('disabled configuration and importing Express app do not start polling', async () => {
  assert.equal(pilotUserFromEnvironment({}, 'MORNING_SUMMARY_POLLING_ENABLED'), null);
  assert.equal(pilotUserFromEnvironment({ MORNING_SUMMARY_POLLING_ENABLED: 'false' }, 'MORNING_SUMMARY_POLLING_ENABLED'), null);
  assert.throws(() => pilotUserFromEnvironment({ MORNING_SUMMARY_POLLING_ENABLED: 'true' }, 'MORNING_SUMMARY_POLLING_ENABLED'), /invalid/);
  const original = process.env.MORNING_SUMMARY_POLLING_ENABLED;
  process.env.MORNING_SUMMARY_POLLING_ENABLED = 'true';
  try {
    const { default: app } = await import('../app.js');
    assert.equal(typeof app.listen, 'function');
    assert.equal(app.listenerCount?.('listening') || 0, 0);
  } finally {
    if (original === undefined) delete process.env.MORNING_SUMMARY_POLLING_ENABLED;
    else process.env.MORNING_SUMMARY_POLLING_ENABLED = original;
  }
});

test('cycles start on minute boundaries with a fixed four-job/four-concurrency cap', async () => {
  const fake = clock(); const calls = [];
  const polling = createMorningSummaryPolling({ pilotUserId, ...fake, logger: logger(),
    delivery: { run: async options => { calls.push([fake.now(), options]); return { claimed: 1 }; } },
  });
  polling.start(); polling.start();
  await fake.advance(49_999); assert.equal(calls.length, 0);
  await fake.advance(1); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 60_000);
  assert.deepEqual([calls[0][1].pilotUserId, calls[0][1].maxJobs, calls[0][1].concurrency], [pilotUserId, 4, 4]);
  await fake.advance(60_000); assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 120_000);
  assert.equal(await polling.stop(), true);
});

test('a pending or timed-out cycle never overlaps; failures back off to a minute boundary', async () => {
  const fake = clock(); const pending = deferred(); const calls = []; const messages = [];
  const polling = createMorningSummaryPolling({ pilotUserId, ...fake,
    logger: { info() {}, error: message => messages.push(message) },
    delivery: { run: options => { calls.push([fake.now(), options]); return calls.length === 1 ? pending.promise : Promise.resolve({ claimed: 0 }); } },
  });
  polling.start(); await fake.advance(50_000); assert.equal(calls.length, 1);
  await fake.advance(45_000); assert.equal(calls[0][1].signal.aborted, true);
  assert.match(messages[0], /timed out/);
  await fake.advance(120_000); assert.equal(calls.length, 1, 'a non-cooperative operation retains the no-overlap guard');
  pending.resolve({ claimed: 1 }); await new Promise(resolve => setImmediate(resolve));
  await fake.advance(25_000); assert.equal(calls.length, 2);
  assert.equal(calls[1][0] % 60_000, 0);
  await polling.stop();

  const failClock = clock(); let attempts = 0;
  const retry = createMorningSummaryPolling({ pilotUserId, ...failClock, logger: logger(),
    delivery: { run: () => { attempts++; return attempts === 1 ? Promise.reject(Error('synthetic')) : Promise.resolve({ claimed: 0 }); } },
  });
  retry.start(); await failClock.advance(50_000); assert.equal(attempts, 1);
  await failClock.advance(119_999); assert.equal(attempts, 1);
  await failClock.advance(60_001); assert.equal(attempts, 2);
  await retry.stop();
});

test('shutdown aborts work, waits only the grace period and starts no later cycle', async () => {
  const fake = clock(); const pending = deferred(); let calls = 0; let signal;
  const polling = createMorningSummaryPolling({ pilotUserId, ...fake, logger: logger(),
    delivery: { run: options => { calls++; signal = options.signal; return pending.promise; } },
  });
  polling.start(); await fake.advance(50_000);
  const stopping = polling.stop({ graceMs: 5_000 });
  assert.equal(signal.aborted, true);
  await fake.advance(5_000); assert.equal(await stopping, false);
  pending.resolve({ claimed: 0 }); await Promise.resolve(); await Promise.resolve();
  await fake.advance(180_000); assert.equal(calls, 1);
});

test('a failed delivery cycle leaves the existing Express service responsive', async () => {
  const { default: app } = await import('../app.js');
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const fake = clock();
  const polling = createMorningSummaryPolling({ pilotUserId, ...fake, logger: logger(),
    delivery: { run: async () => { throw Error('synthetic provider failure'); } },
  });
  try {
    polling.start(); await fake.advance(50_000);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
  } finally {
    await polling.stop();
    await new Promise(resolve => server.close(resolve));
  }
});
