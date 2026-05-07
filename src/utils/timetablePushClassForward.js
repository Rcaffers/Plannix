import { findSessionAt } from './timetable';

/** Same timetable class/group (linked classId or identical class label). */
export function sessionsTeachingGroupEqual(a, b) {
  if (!a || !b) return false;
  const ida = String(a.classId || '').trim();
  const idb = String(b.classId || '').trim();
  if (ida && idb && ida === idb) return true;
  const na = String(a.class || '').trim();
  const nb = String(b.class || '').trim();
  return Boolean(na) && na === nb;
}

export function lessonRowsFromSegments(rowSegments) {
  return rowSegments.filter((s) => s.kind === 'lesson').map((s) => s.rowIndex);
}

function rangeMetaForTime(rowSegments, time) {
  return rowSegments.find((s) => s.rowIndex === time)?.rangeLabel ?? '';
}

function readLessonPayload(session) {
  return {
    teacher: String(session?.teacher ?? '').trim(),
    title: String(session?.title ?? '').trim(),
    notes: String(session?.notes ?? '').trim(),
  };
}

function lessonPayloadNonempty(p) {
  return Boolean(p.teacher || p.title || p.notes);
}

/** Every lesson cell in timetable column order then period order within the day. */
function buildLessonSlotTimeline(dayCount, rowSegments) {
  const lt = lessonRowsFromSegments(rowSegments);
  const timeline = [];
  for (let d = 0; d < dayCount; d += 1) {
    for (let li = 0; li < lt.length; li += 1) {
      timeline.push({ day: d, time: lt[li] });
    }
  }
  return timeline;
}

/**
 * Shifts lesson details only (`title`, `notes`, `teacher`) one step along upcoming slots where this
 * class is already taught: same timetable column order as the grid (later days come after earlier),
 * then later periods within a day — not limited to staying on Monday if the next Maths is Tuesday.
 *
 * Class placement unchanged. Pivot details clear. The furthest slot in this chain must not already
 * have lesson text, so nothing is dropped.
 */
export function pushLessonDetailsForwardAlongSameClassAhead({
  sessions,
  pivotDayIndex,
  pivotTime,
  pivotSessionRef,
  rowSegments,
  dayCount,
}) {
  if (!pivotSessionRef) {
    return { ok: false, reason: 'NO_CLASS' };
  }

  const lt = lessonRowsFromSegments(rowSegments);
  if (lt.indexOf(pivotTime) === -1) {
    return { ok: false, reason: 'NOT_LESSON_ROW' };
  }

  const timeline = buildLessonSlotTimeline(dayCount, rowSegments);
  const pivotPos = timeline.findIndex((slot) => slot.day === pivotDayIndex && slot.time === pivotTime);
  if (pivotPos === -1) {
    return { ok: false, reason: 'NOT_LESSON_ROW' };
  }

  const chain = [];
  for (let p = pivotPos; p < timeline.length; p += 1) {
    const { day, time } = timeline[p];
    const sess = findSessionAt(sessions, day, time);
    if (sess && sessionsTeachingGroupEqual(pivotSessionRef, sess)) {
      const ix = sessions.findIndex((s) => s.day === day && s.time === time);
      if (ix !== -1) {
        chain.push({ day, time, ix });
      }
    }
  }

  if (chain.length < 2) {
    return { ok: false, reason: 'NO_FURTHER_SAME_CLASS_SLOT' };
  }

  const payloadsBefore = chain.map(({ ix }) => readLessonPayload(sessions[ix]));

  if (!lessonPayloadNonempty(payloadsBefore[0])) {
    return { ok: false, reason: 'PIVOT_NOTHING_TO_SHIFT' };
  }

  const lastPayload = payloadsBefore[payloadsBefore.length - 1];
  if (lessonPayloadNonempty(lastPayload)) {
    return { ok: false, reason: 'LAST_DETAIL_WOULD_DROP' };
  }

  const next = sessions.map((s) => ({ ...s }));

  for (let k = chain.length - 1; k >= 1; k -= 1) {
    const { ix: ixDest, time } = chain[k];
    const incoming = payloadsBefore[k - 1];
    next[ixDest] = {
      ...next[ixDest],
      teacher: incoming.teacher,
      title: incoming.title,
      notes: incoming.notes,
      meta: rangeMetaForTime(rowSegments, time),
    };
  }

  const { ix: ixPivot, time: pivotT } = chain[0];
  next[ixPivot] = {
    ...next[ixPivot],
    teacher: '',
    title: '',
    notes: '',
    meta: rangeMetaForTime(rowSegments, pivotT),
  };

  return { ok: true, sessions: next };
}
