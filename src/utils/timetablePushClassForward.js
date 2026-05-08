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
    title: String(session?.title ?? '').trim(),
    notes: String(session?.notes ?? '').trim(),
  };
}

function lessonPayloadNonempty(p) {
  return Boolean(p.title || p.notes);
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
 * Shifts lesson details only (`title`, `notes`) one step along upcoming slots where this
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

  const payloadsBeforeAll = chain.map(({ ix }) => readLessonPayload(sessions[ix]));

  if (!lessonPayloadNonempty(payloadsBeforeAll[0])) {
    return { ok: false, reason: 'PIVOT_NOTHING_TO_SHIFT' };
  }

  // Cascade to the first blank matching slot so later filled slots do not block.
  const firstBlankIndex = payloadsBeforeAll.findIndex((p, idx) => idx > 0 && !lessonPayloadNonempty(p));
  if (firstBlankIndex === -1) {
    return { ok: false, reason: 'LAST_DETAIL_WOULD_DROP' };
  }
  const chainUsed = chain.slice(0, firstBlankIndex + 1);
  const payloadsBefore = payloadsBeforeAll.slice(0, firstBlankIndex + 1);

  const next = sessions.map((s) => ({ ...s }));

  for (let k = chainUsed.length - 1; k >= 1; k -= 1) {
    const { ix: ixDest, time } = chainUsed[k];
    const incoming = payloadsBefore[k - 1];
    next[ixDest] = {
      ...next[ixDest],
      title: incoming.title,
      notes: incoming.notes,
      meta: rangeMetaForTime(rowSegments, time),
    };
  }

  const { ix: ixPivot, time: pivotT } = chainUsed[0];
  next[ixPivot] = {
    ...next[ixPivot],
    title: '',
    notes: '',
    meta: rangeMetaForTime(rowSegments, pivotT),
  };

  return { ok: true, sessions: next, movedCount: Math.max(0, chainUsed.length - 1) };
}

/**
 * Multi-week variant that cascades lesson details across a sequence of weeks.
 *
 * `byWeekKey` is an object mapping weekKey -> sessions[] for that week. `orderedWeekKeys` must list
 * those keys in the real calendar order you want to scan through (earliest first). The pivot week
 * key identifies which week's slot the user clicked.
 */
export function pushLessonDetailsForwardAcrossWeeks({
  byWeekKey,
  orderedWeekKeys,
  pivotWeekKey,
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

  const timeline = [];
  for (let wi = 0; wi < orderedWeekKeys.length; wi += 1) {
    const weekKey = orderedWeekKeys[wi];
    for (let d = 0; d < dayCount; d += 1) {
      for (let li = 0; li < lt.length; li += 1) {
        timeline.push({ weekKey, day: d, time: lt[li] });
      }
    }
  }

  const pivotPos = timeline.findIndex(
    (slot) => slot.weekKey === pivotWeekKey && slot.day === pivotDayIndex && slot.time === pivotTime,
  );
  if (pivotPos === -1) {
    return { ok: false, reason: 'NOT_LESSON_ROW' };
  }

  const chain = [];
  for (let p = pivotPos; p < timeline.length; p += 1) {
    const { weekKey, day, time } = timeline[p];
    const sessions = byWeekKey[weekKey] || [];
    const sess = findSessionAt(sessions, day, time);
    if (sess && sessionsTeachingGroupEqual(pivotSessionRef, sess)) {
      const ix = sessions.findIndex((s) => s.day === day && s.time === time);
      if (ix !== -1) {
        chain.push({ weekKey, day, time, ix });
      }
    }
  }

  if (chain.length < 2) {
    return { ok: false, reason: 'NO_FURTHER_SAME_CLASS_SLOT' };
  }

  const payloadsBeforeAll = chain.map(({ weekKey, ix }) =>
    readLessonPayload((byWeekKey[weekKey] || [])[ix]),
  );

  if (!lessonPayloadNonempty(payloadsBeforeAll[0])) {
    return { ok: false, reason: 'PIVOT_NOTHING_TO_SHIFT' };
  }

  // Cascade to the first blank matching slot so later filled slots do not block.
  const firstBlankIndex = payloadsBeforeAll.findIndex((p, idx) => idx > 0 && !lessonPayloadNonempty(p));
  if (firstBlankIndex === -1) {
    return { ok: false, reason: 'LAST_DETAIL_WOULD_DROP' };
  }
  const chainUsed = chain.slice(0, firstBlankIndex + 1);
  const payloadsBefore = payloadsBeforeAll.slice(0, firstBlankIndex + 1);

  const nextByWeekKey = {};
  orderedWeekKeys.forEach((wk) => {
    const arr = byWeekKey[wk] || [];
    nextByWeekKey[wk] = arr.map((s) => ({ ...s }));
  });

  for (let k = chainUsed.length - 1; k >= 1; k -= 1) {
    const { weekKey, ix: ixDest, time } = chainUsed[k];
    const incoming = payloadsBefore[k - 1];
    const nextSessions = nextByWeekKey[weekKey];
    nextSessions[ixDest] = {
      ...nextSessions[ixDest],
      title: incoming.title,
      notes: incoming.notes,
      meta: rangeMetaForTime(rowSegments, time),
    };
  }

  const { weekKey: pivotWK, ix: ixPivot, time: pivotT } = chainUsed[0];
  const pivotSessions = nextByWeekKey[pivotWK];
  pivotSessions[ixPivot] = {
    ...pivotSessions[ixPivot],
    title: '',
    notes: '',
    meta: rangeMetaForTime(rowSegments, pivotT),
  };

  return { ok: true, byWeekKey: nextByWeekKey, movedCount: Math.max(0, chainUsed.length - 1) };
}

/**
 * Pulls lesson details (`title`, `notes`) back one step from later matching class slots
 * towards the selected slot, then clears the last moved-from slot.
 */
export function pullLessonDetailsBackwardAlongSameClassAhead({
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

  const payloadsBeforeAll = chain.map(({ ix }) => readLessonPayload(sessions[ix]));
  const lastFilledIndex = payloadsBeforeAll.reduce(
    (acc, payload, idx) => (idx > 0 && lessonPayloadNonempty(payload) ? idx : acc),
    -1,
  );
  if (lastFilledIndex === -1) {
    return { ok: false, reason: 'NO_LATER_DETAIL_TO_PULL' };
  }

  const chainUsed = chain.slice(0, lastFilledIndex + 1);
  const payloadsBefore = payloadsBeforeAll.slice(0, lastFilledIndex + 1);
  const next = sessions.map((s) => ({ ...s }));

  for (let k = 0; k < chainUsed.length - 1; k += 1) {
    const { ix: ixDest, time } = chainUsed[k];
    const incoming = payloadsBefore[k + 1];
    next[ixDest] = {
      ...next[ixDest],
      title: incoming.title,
      notes: incoming.notes,
      meta: rangeMetaForTime(rowSegments, time),
    };
  }

  const { ix: ixTail, time: tailT } = chainUsed[chainUsed.length - 1];
  next[ixTail] = {
    ...next[ixTail],
    title: '',
    notes: '',
    meta: rangeMetaForTime(rowSegments, tailT),
  };

  return { ok: true, sessions: next, movedCount: Math.max(0, chainUsed.length - 1) };
}

export function pullLessonDetailsBackwardAcrossWeeks({
  byWeekKey,
  orderedWeekKeys,
  pivotWeekKey,
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

  const timeline = [];
  for (let wi = 0; wi < orderedWeekKeys.length; wi += 1) {
    const weekKey = orderedWeekKeys[wi];
    for (let d = 0; d < dayCount; d += 1) {
      for (let li = 0; li < lt.length; li += 1) {
        timeline.push({ weekKey, day: d, time: lt[li] });
      }
    }
  }

  const pivotPos = timeline.findIndex(
    (slot) => slot.weekKey === pivotWeekKey && slot.day === pivotDayIndex && slot.time === pivotTime,
  );
  if (pivotPos === -1) {
    return { ok: false, reason: 'NOT_LESSON_ROW' };
  }

  const chain = [];
  for (let p = pivotPos; p < timeline.length; p += 1) {
    const { weekKey, day, time } = timeline[p];
    const sessions = byWeekKey[weekKey] || [];
    const sess = findSessionAt(sessions, day, time);
    if (sess && sessionsTeachingGroupEqual(pivotSessionRef, sess)) {
      const ix = sessions.findIndex((s) => s.day === day && s.time === time);
      if (ix !== -1) {
        chain.push({ weekKey, day, time, ix });
      }
    }
  }

  if (chain.length < 2) {
    return { ok: false, reason: 'NO_FURTHER_SAME_CLASS_SLOT' };
  }

  const payloadsBeforeAll = chain.map(({ weekKey, ix }) =>
    readLessonPayload((byWeekKey[weekKey] || [])[ix]),
  );
  const lastFilledIndex = payloadsBeforeAll.reduce(
    (acc, payload, idx) => (idx > 0 && lessonPayloadNonempty(payload) ? idx : acc),
    -1,
  );
  if (lastFilledIndex === -1) {
    return { ok: false, reason: 'NO_LATER_DETAIL_TO_PULL' };
  }

  const chainUsed = chain.slice(0, lastFilledIndex + 1);
  const payloadsBefore = payloadsBeforeAll.slice(0, lastFilledIndex + 1);

  const nextByWeekKey = {};
  orderedWeekKeys.forEach((wk) => {
    const arr = byWeekKey[wk] || [];
    nextByWeekKey[wk] = arr.map((s) => ({ ...s }));
  });

  for (let k = 0; k < chainUsed.length - 1; k += 1) {
    const { weekKey, ix: ixDest, time } = chainUsed[k];
    const incoming = payloadsBefore[k + 1];
    const nextSessions = nextByWeekKey[weekKey];
    nextSessions[ixDest] = {
      ...nextSessions[ixDest],
      title: incoming.title,
      notes: incoming.notes,
      meta: rangeMetaForTime(rowSegments, time),
    };
  }

  const { weekKey: tailWK, ix: ixTail, time: tailT } = chainUsed[chainUsed.length - 1];
  const tailSessions = nextByWeekKey[tailWK];
  tailSessions[ixTail] = {
    ...tailSessions[ixTail],
    title: '',
    notes: '',
    meta: rangeMetaForTime(rowSegments, tailT),
  };

  return { ok: true, byWeekKey: nextByWeekKey, movedCount: Math.max(0, chainUsed.length - 1) };
}
