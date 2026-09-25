import { computeClassUsageCounts } from './timetablePlannedClasses.js';

export function classPlacementUsage(plannedClasses, sessions) {
  const counts = computeClassUsageCounts(sessions, new Map(plannedClasses.map((entry) => [entry.id, entry])));
  return plannedClasses.map((entry) => ({ ...entry, used: counts.get(entry.id) || 0,
    remaining: Math.max(0, entry.max - (counts.get(entry.id) || 0)) }));
}

const at = (session, slot) => session.day === slot.day && session.periodId === slot.periodId;
export function isPlacementSlotAvailable(slot, { weekId, slots }) {
  return Boolean(weekId && slot?.weekId === weekId && slots.some((candidate) =>
    candidate.weekId === weekId && at(candidate, slot)));
}

// Operate on canonical sessions, retaining IDs and all lesson details when moving.
export function applyClassPlacement({ sessions, frequencySessions, plannedClasses, weekId, slots,
  safe, destination, action }) {
  if (!safe || !weekId) return { ok: false, reason: 'UNSAFE' };
  if (!isPlacementSlotAvailable(destination, { weekId, slots })) return { ok: false, reason: 'UNAVAILABLE' };
  if (!action || action.weekId !== weekId) return { ok: false, reason: 'WRONG_WEEK' };
  const occupied = sessions.find((session) => at(session, destination));
  if (action.type === 'class') {
    if (occupied) return { ok: false, reason: 'OCCUPIED' };
    const entry = classPlacementUsage(plannedClasses, frequencySessions).find((item) => item.id === action.classId);
    if (!entry) return { ok: false, reason: 'UNKNOWN_CLASS' };
    if (!entry.remaining) return { ok: false, reason: 'LIMIT' };
    return { ok: true, sessions: [...sessions, { day: destination.day, periodId: destination.periodId,
      classId: entry.id, title: '', notes: '' }] };
  }
  if (action.type !== 'session' || !isPlacementSlotAvailable(action.source, { weekId, slots })) {
    return { ok: false, reason: 'UNAVAILABLE' };
  }
  const source = sessions.find((session) => at(session, action.source));
  // Reject a stale drag if the source was replaced while dragging.
  if (!source || source !== action.session) return { ok: false, reason: 'STALE' };
  if (at(source, destination)) return { ok: true, sessions, unchanged: true };
  return { ok: true, sessions: sessions.map((session) => session === source
    ? { ...session, day: destination.day, periodId: destination.periodId }
    : session === occupied ? { ...session, day: source.day, periodId: source.periodId } : session) };
}

// Only authoritative timetable readiness blocks placement. An unrelated layout
// draft does not change the saved layout or the teaching periods used here.
export function classPlacementUnavailableReason({ target, sessionState, classesLoading, classesError,
  layoutLoading, layoutSaving, layoutError, modalSlot, slots }) {
  if (classesLoading || layoutLoading || sessionState.isLoading) return 'Loading classes or timetable…';
  if (layoutSaving || sessionState.isSaving) return 'Saving timetable changes…';
  if (classesError || layoutError || sessionState.error || sessionState.conflict) return 'Resolve the loading or save error before placing classes.';
  if (sessionState.unsaved) return 'Save or reload pending timetable changes before placing classes.';
  if (!target || !sessionState.scope || sessionState.revision == null || !slots.length) return 'Load a saved timetable with available lesson slots to place classes.';
  if (modalSlot) return 'Close lesson details to place classes.';
  return '';
}

export function removeClassPlacement({ sessions, weekId, slots, safe, action, classId }) {
  if (!safe || !weekId) return { ok: false, reason: 'UNSAFE' };
  if (action?.type !== 'session') return { ok: false, reason: 'NOT_SESSION' };
  if (action.weekId !== weekId) return { ok: false, reason: 'WRONG_WEEK' };
  if (!isPlacementSlotAvailable(action.source, { weekId, slots })) return { ok: false, reason: 'UNAVAILABLE' };
  const removed = sessions.find((session) => at(session, action.source));
  if (!removed || removed !== action.session) return { ok: false, reason: 'STALE' };
  if (removed.classId !== classId) return { ok: false, reason: 'WRONG_CLASS' };
  return { ok: true, removed, sessions: sessions.filter((session) => session !== removed) };
}
