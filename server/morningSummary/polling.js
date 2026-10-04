import { createMorningSummaryDelivery } from './delivery.js';

const MINUTE_MS = 60_000;
const CYCLE_TIMEOUT_MS = 45_000;
const ERROR_BACKOFF_MS = 120_000;

export function createMorningSummaryPolling({
  delivery = createMorningSummaryDelivery(), pilotUserId,
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  logger = console, cycleTimeoutMs = CYCLE_TIMEOUT_MS, errorBackoffMs = ERROR_BACKOFF_MS,
} = {}) {
  if (typeof pilotUserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pilotUserId)
    || !Number.isInteger(cycleTimeoutMs) || cycleTimeoutMs < 1 || cycleTimeoutMs >= MINUTE_MS
    || !Number.isInteger(errorBackoffMs) || errorBackoffMs < MINUTE_MS) {
    throw new Error('Morning summary polling configuration is invalid.');
  }
  let stopped = false;
  let started = false;
  let timer = null;
  let active = null;
  let controller = null;
  let nextEligibleAt = 0;

  const schedule = () => {
    if (stopped) return;
    const current = now();
    const earliest = Math.max(current + 1, nextEligibleAt);
    const boundary = Math.ceil(earliest / MINUTE_MS) * MINUTE_MS;
    timer = setTimer(tick, Math.max(0, boundary - current));
  };

  const tick = () => {
    timer = null;
    if (stopped) return;
    if (active || now() < nextEligibleAt) { schedule(); return; }
    controller = new AbortController();
    const startedAt = now();
    let timedOut = false;
    const timeout = setTimer(() => {
      timedOut = true;
      nextEligibleAt = Math.max(nextEligibleAt, now() + errorBackoffMs);
      controller?.abort();
      logger.error('Morning summary polling cycle timed out.');
    }, cycleTimeoutMs);
    active = Promise.resolve().then(() => delivery.run({
      pilotUserId, maxJobs: 4, concurrency: 4, signal: controller.signal,
    })).then(result => {
      if (!timedOut) logger.info(`Morning summary polling cycle completed: ${result.claimed} claims, ${now() - startedAt} ms.`);
    }).catch(() => {
      if (!timedOut) {
        nextEligibleAt = Math.max(nextEligibleAt, now() + errorBackoffMs);
        logger.error('Morning summary polling cycle failed.');
      }
    }).finally(() => {
      clearTimer(timeout);
      active = null;
      controller = null;
      schedule();
    });
  };

  return {
    start() { if (!started && !stopped) { started = true; schedule(); } },
    async stop({ graceMs = 10_000 } = {}) {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      controller?.abort();
      if (!active) return true;
      let deadline;
      const settled = await Promise.race([
        active.then(() => true),
        new Promise(resolve => { deadline = setTimer(() => resolve(false), graceMs); }),
      ]);
      if (deadline !== undefined) clearTimer(deadline);
      return settled;
    },
  };
}
