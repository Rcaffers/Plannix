/** Assert collection-local canonical slot uniqueness before optimistic persistence. */
export function assertUniqueSessionSlots(sessions) {
  const seen = new Set();
  for (const session of sessions) {
    const key = `${session.day}:${String(session.periodId).toLowerCase()}`;
    if (seen.has(key)) throw new Error(`Duplicate timetable slot: ${key}`);
    seen.add(key);
  }
}

export function sameSessions(left, right) {
  const clean = (items) => items.map(({ id, day, periodId, classId, title, notes }) =>
    ({ id: id || null, day, periodId, classId, title, notes }));
  return JSON.stringify(clean(left)) === JSON.stringify(clean(right));
}

export function createSerializedSaveQueue({ save, onOptimistic, onAuthoritative, onError }) {
  let queued = null;
  let running = false;
  let stopped = false;
  let generation = 0;

  async function drain(currentGeneration) {
    if (running || stopped) return;
    running = true;
    while (queued && !stopped && currentGeneration === generation) {
      const next = queued;
      queued = null;
      try {
        const result = await save(next);
        if (currentGeneration !== generation) break;
        onAuthoritative(result, queued);
      } catch (error) {
        if (currentGeneration === generation) onError(error, next);
        stopped = true;
      }
    }
    running = false;
  }

  return {
    enqueue(value) {
      if (stopped) return false;
      queued = value;
      onOptimistic(value);
      void drain(generation);
      return true;
    },
    retry(value) {
      stopped = false;
      return this.enqueue(value);
    },
    reset() { generation += 1; queued = null; running = false; stopped = false; },
    get pending() { return running || queued !== null; },
    get conflicted() { return stopped; },
  };
}

export function sessionToDisplay(session, periodIndexById, classNameById, temporaryKey) {
  const time = periodIndexById.get(session.periodId);
  if (!Number.isInteger(time)) return null;
  return { ...session, time, class: classNameById.get(session.classId) || '',
    reactKey: session.id || temporaryKey };
}

export function displayToSession(session, periodIdByIndex) {
  const periodId = periodIdByIndex.get(session.time);
  if (!periodId) throw new Error('The selected teaching period is unavailable.');
  return { ...(session.id ? { id: session.id } : {}), day: session.day, periodId,
    classId: session.classId, title: String(session.title || '').trim().slice(0, 200),
    notes: String(session.notes || '').trim().slice(0, 5000) };
}

export function combinedRecurringSessions(weeks) {
  return weeks.flatMap((week) => week.sessions);
}
