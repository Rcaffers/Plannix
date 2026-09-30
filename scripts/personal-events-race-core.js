// Coordination checks are deliberately independent of Docker and SQL so failure paths can be tested.
export function parseLockObservation(output, expectedA, expectedB) {
  const lines = String(output).trim().split(/\r?\n/);
  if (lines.length !== 1 || !lines[0]) throw new Error('Lock observation was empty or malformed.');
  let row;
  try { row = JSON.parse(lines[0]); } catch { throw new Error('Lock observation was empty or malformed.'); }
  if (!row || !Number.isSafeInteger(row.aPid) || !Number.isSafeInteger(row.bPid)
    || row.aPid < 1 || row.bPid < 1 || row.aPid === row.bPid
    || row.aName !== expectedA || row.bName !== expectedB
    || typeof row.bQuery !== 'string' || !Array.isArray(row.blockers)
    || !Array.isArray(row.waitingLocks)) throw new Error('Lock observation was empty or malformed.');
  return row;
}

export async function waitForActualBlock({ observe, aName, bName, expectedQuery,
  deadlineMs = 5000, intervalMs = 40, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const deadline = now() + deadlineMs;
  do {
    const row = parseLockObservation(await observe(), aName, bName);
    if (row.bState === 'active' && row.waitType === 'Lock'
      && row.blockers.includes(row.aPid) && row.bQuery.includes(expectedQuery)
      && row.waitingLocks.some(lock => lock.granted === false && typeof lock.locktype === 'string')) {
      return { aPid: row.aPid, bPid: row.bPid,
        lockTypes: row.waitingLocks.filter(lock => lock.granted === false).map(lock => lock.locktype) };
    }
    if (now() >= deadline) break;
    await pause(Math.min(intervalMs, Math.max(0, deadline - now())));
  } while (true);
  throw new Error('Competing transaction never blocked on the first transaction.');
}

export async function runContendedPair({ first, second, observe, expectedQuery, inspect, cleanup }) {
  let primaryError;
  try {
    await first.waitFor('READY');
    await second.waitFor('READY');
    first.send('OPERATE');
    await first.waitFor('OPERATED');
    second.send('OPERATE');
    const block = await waitForActualBlock({ observe, aName: first.name, bName: second.name, expectedQuery });
    first.send('COMMIT');
    const [a, b] = await Promise.all([first.waitExit(), second.waitExit()]);
    await inspect(a, b, block);
    return block;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { await cleanup(); } catch (error) { if (!primaryError) throw error; }
  }
}
