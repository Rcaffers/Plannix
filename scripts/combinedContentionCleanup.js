// Test-only lifecycle for disposable-database contention processes. Acquisitions
// are registered before their factories run; closing admission prevents later
// work from spawning a child through this registry.
const timeout = Symbol('timeout');
const admissionClosed = () => new Error('Contention resource admission is closed.');

async function bounded(work, until, onTimeout) {
  let timer;
  const result = await Promise.race([
    Promise.resolve().then(work).then(value => ({ value }), error => ({ error })),
    new Promise(resolve => { timer = setTimeout(() => { onTimeout?.(); resolve(timeout); },
      Math.max(0, until - Date.now())); }),
  ]);
  clearTimeout(timer);
  if (result === timeout) return timeout;
  if ('error' in result) throw result.error;
  return result.value;
}

export async function runCombinedContention({ work, cleanup,
  report = error => process.stderr.write(`Combined contention cleanup: ${error.message}\n`),
  operationMs = 20000, cleanupMs = 9000 }) {
  if (!Number.isInteger(operationMs) || operationMs < 1
    || !Number.isInteger(cleanupMs) || cleanupMs < 1) throw Error('Invalid contention deadlines.');
  const resources = new Set();
  const pending = new Set();
  let admissionOpen = true;
  let cleanupUntil;
  const secondary = [];
  const reportError = error => {
    secondary.push(error);
    try { Promise.resolve(report(error)).catch(() => {}); } catch { /* preserve primary */ }
  };
  const attempt = async (label, task, until) => {
    try {
      if (await bounded(task, until) === timeout)
        reportError(Error(`${label} exceeded cleanup deadline.`));
    } catch (error) { reportError(Error(`${label} failed: ${error.message}`)); }
  };
  const disposeLate = resource => {
    // A factory may resolve even after the main cleanup budget. It remains
    // registered by its acquisition ticket and is terminated immediately.
    const until = Date.now() + cleanupMs;
    void (async () => {
      await Promise.all([
        attempt('late rollback', () => resource.release?.('rollback'), until),
        attempt('late termination', () => resource.stop(), until),
      ]);
      await attempt('late child closure', () => resource.finished, until);
    })().catch(error => reportError(error));
  };
  const registry = Object.freeze({
    acquire(factory) {
      if (!admissionOpen) return Promise.reject(admissionClosed());
      const ticket = {};
      pending.add(ticket);
      const publish = resource => {
        if (!resource || !resource.finished || typeof resource.stop !== 'function')
          throw Error('Invalid contention resource.');
        if (ticket.resource && ticket.resource !== resource) {
          disposeLate(resource);
          throw Error('Contention acquisition published more than one resource.');
        }
        if (ticket.resource) return resource;
        ticket.resource = resource;
        if (!admissionOpen) {
          disposeLate(resource);
          throw admissionClosed();
        }
        resources.add(resource);
        return resource;
      };
      const acquisition = (async () => {
        try {
          const resource = await factory(publish);
          publish(resource);
          if (!admissionOpen) throw admissionClosed();
          return resource;
        } finally { pending.delete(ticket); }
      })();
      ticket.promise = acquisition;
      return acquisition;
    },
  });
  const operationUntil = Date.now() + operationMs;
  let primary; let value;
  try {
    value = await bounded(() => work(registry), operationUntil,
      () => { admissionOpen = false; });
    if (value === timeout) throw Error('Combined contention operation exceeded its deadline.');
  } catch (error) { primary = error; }

  // Close admission before taking a snapshot or awaiting cleanup.
  admissionOpen = false;
  cleanupUntil = Date.now() + cleanupMs;
  const all = [...resources];
  const rollbackUntil = Math.min(cleanupUntil, Date.now() + Math.ceil(cleanupMs / 4));
  await Promise.all(all.map(resource => attempt('rollback',
    () => resource.release?.('rollback'), rollbackUntil)));
  await Promise.all(all.map(resource => attempt('termination',
    () => resource.stop(), cleanupUntil)));
  await Promise.all(all.map(resource => attempt('child closure',
    () => resource.finished, cleanupUntil)));
  // A pending factory cannot escape the registry: if it eventually yields a
  // child, acquire() terminates it and rejects rather than handing it out.
  const acquisitions = [...pending].map(ticket => ticket.promise);
  if (acquisitions.length) await attempt('pending acquisition',
    () => Promise.allSettled(acquisitions), cleanupUntil);
  await attempt('fixture cleanup', cleanup, cleanupUntil);
  if (primary) throw primary;
  if (secondary.length) throw new AggregateError(secondary, 'Combined contention cleanup failed.');
  return value;
}
