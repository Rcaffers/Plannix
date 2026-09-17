import { findSessionAt } from './timetable';

/** Normalise classes plan entries for timetable class picking (id, name, max frequency). */
export function getPlannedClassEntries(classesPlan) {
  return classesPlan.entries
    .map((entry) => ({
      id: String(entry.id || ''),
      name: entry.name.trim(),
      max: Number(entry.frequency) || 0,
    }))
    .filter((entry) => entry.id && entry.name && entry.max > 0);
}

export function mapsFromPlannedClasses(plannedClasses) {
  return {
    byId: new Map(plannedClasses.map((entry) => [entry.id, entry])),
    byName: new Map(plannedClasses.map((entry) => [entry.name, entry])),
  };
}

export function resolveSessionClassDisplay(session, plannedClassById) {
  if (!session) return '';
  const fromId = session.classId ? plannedClassById.get(session.classId) : null;
  return fromId?.name || '';
}

export function computeClassUsageCounts(sessions, plannedClassById) {
  return sessions.reduce((acc, session) => {
    const entry = session.classId && plannedClassById.get(session.classId);
    if (!entry) return acc;
    acc.set(entry.id, (acc.get(entry.id) ?? 0) + 1);
    return acc;
  }, new Map());
}

/**
 * Options for the lesson modal class dropdown (respects per-class frequency caps).
 */
export function computeAvailableClassOptions({
  plannedClasses,
  sessions,
  dayIndex,
  rowIndex,
  plannedClassById,
  currentSession = null,
}) {
  const selectedSession = currentSession ?? findSessionAt(sessions, dayIndex, rowIndex);
  const filteredSessions = selectedSession ? sessions.filter((s) => s !== selectedSession) : sessions;
  const usedCounts = computeClassUsageCounts(filteredSessions, plannedClassById);
  const currentClassId =
    (selectedSession?.classId && plannedClassById.get(selectedSession.classId)?.id) || '';

  return plannedClasses
    .filter((entry) => {
      if (entry.id === currentClassId) return true;
      const used = usedCounts.get(entry.id) ?? 0;
      return used < entry.max;
    })
    .map((entry) => ({
      id: entry.id,
      label: entry.name,
      max: entry.max,
      used:
        (usedCounts.get(entry.id) ?? 0) +
        (currentClassId && currentClassId === entry.id ? 1 : 0),
    }));
}
