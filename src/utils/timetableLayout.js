export const TIMETABLE_CYCLE = {
  ONE_WEEK: 'one-week',
  TWO_WEEK: 'two-week',
};

export const DEFAULT_LUNCH = {
  startTime: '12:30',
  lengthMinutes: 45,
};

export const DEFAULT_REGISTRATION = {
  enabled: false,
  startTime: '08:40',
  lengthMinutes: 15,
};

export const DEFAULT_TIMETABLE_LAYOUT = {
  cycle: TIMETABLE_CYCLE.ONE_WEEK,
  periodsPerDay: 5,
  periodLengthMinutes: 60,
  schoolStartTime: '09:00',
  registration: { ...DEFAULT_REGISTRATION },
  breaks: [],
  lunch: { ...DEFAULT_LUNCH },
  showBreaksInTimetable: true,
  showLunchInTimetable: true,
};

const LIMITS = {
  periodsMin: 1,
  periodsMax: 12,
  periodLengthMin: 20,
  periodLengthMax: 120,
  breaksMax: 6,
  breakLengthMin: 5,
  breakLengthMax: 120,
  lunchLengthMax: 180,
  registrationLengthMin: 5,
  registrationLengthMax: 120,
};

export function getDayCount(layout) {
  return layout.cycle === TIMETABLE_CYCLE.TWO_WEEK ? 10 : 5;
}

export function parseTimeToMinutes(time) {
  const m = String(time || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return 9 * 60;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return h * 60 + min;
}

export function formatMinutesAsTime(totalMinutes) {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** @deprecated use segment range from buildRowSegments for lessons */
export function periodRangeMeta(layout, periodIndex) {
  const startM = parseTimeToMinutes(layout.schoolStartTime) + periodIndex * layout.periodLengthMinutes;
  const endM = startM + layout.periodLengthMinutes;
  return `${formatMinutesAsTime(startM)} – ${formatMinutesAsTime(endM)}`;
}

function clampInt(n, min, max) {
  const x = Math.floor(Number(n));
  if (Number.isNaN(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function normalizeTimeString(value, fallback = DEFAULT_TIMETABLE_LAYOUT.schoolStartTime) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  if (Number.isNaN(h) || Number.isNaN(min)) return fallback;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizeBreakEntry(raw, index) {
  const startFallback = index === 0 ? '10:40' : '14:15';
  return {
    startTime: normalizeTimeString(raw?.startTime, startFallback),
    lengthMinutes: clampInt(raw?.lengthMinutes ?? 15, LIMITS.breakLengthMin, LIMITS.breakLengthMax),
  };
}

function normalizeLunch(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const lengthMinutes = clampInt(obj.lengthMinutes ?? DEFAULT_LUNCH.lengthMinutes, 0, LIMITS.lunchLengthMax);
  return {
    startTime: normalizeTimeString(obj.startTime, DEFAULT_LUNCH.startTime),
    lengthMinutes,
  };
}

function normalizeRegistration(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const enabled = Boolean(obj.enabled);
  const lengthMinutes = clampInt(
    obj.lengthMinutes ?? DEFAULT_REGISTRATION.lengthMinutes,
    LIMITS.registrationLengthMin,
    LIMITS.registrationLengthMax,
  );
  return {
    enabled,
    startTime: normalizeTimeString(obj.startTime, DEFAULT_REGISTRATION.startTime),
    lengthMinutes,
  };
}

function normalizeBreaksList(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.slice(0, LIMITS.breaksMax).map((b, i) => normalizeBreakEntry(b, i));
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function mergeFixedIntervals(blocks) {
  if (!blocks.length) return [];
  const sorted = [...blocks].sort((x, y) => x.startM - y.startM);
  const out = [{ startM: sorted[0].startM, endM: sorted[0].endM }];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (cur.startM <= prev.endM) {
      prev.endM = Math.max(prev.endM, cur.endM);
    } else {
      out.push({ startM: cur.startM, endM: cur.endM });
    }
  }
  return out;
}

/** Registration, breaks, and lunch (merged overlaps) — teaching periods are placed in the gaps between these. */
function collectMergedFixedIntervals(normalized) {
  const {
    registration,
    breaks,
    lunch,
    showBreaksInTimetable,
    showLunchInTimetable,
  } = normalized;
  const raw = [];

  const regLen = clampInt(
    registration.lengthMinutes,
    LIMITS.registrationLengthMin,
    LIMITS.registrationLengthMax,
  );
  if (registration.enabled && regLen > 0) {
    const startM = parseTimeToMinutes(registration.startTime);
    raw.push({ startM, endM: startM + regLen });
  }

  if (showBreaksInTimetable) {
    breaks.forEach((b) => {
      const startM = parseTimeToMinutes(b.startTime);
      const len = clampInt(b.lengthMinutes, LIMITS.breakLengthMin, LIMITS.breakLengthMax);
      raw.push({ startM, endM: startM + len });
    });
  }

  const lunchLen = clampInt(lunch.lengthMinutes, 0, LIMITS.lunchLengthMax);
  if (lunchLen > 0 && showLunchInTimetable) {
    const startM = parseTimeToMinutes(lunch.startTime);
    raw.push({ startM, endM: startM + lunchLen });
  }

  return mergeFixedIntervals(raw);
}

function advancePastFixedBlocks(cursorM, merged) {
  let t = cursorM;
  let progress = true;
  while (progress) {
    progress = false;
    for (const b of merged) {
      if (t >= b.startM && t < b.endM) {
        t = b.endM;
        progress = true;
      }
    }
  }
  return t;
}

/** Next teaching block of length L from startSearchM, not overlapping fixed blocks. */
function findNextLessonInterval(startSearchM, L, merged) {
  let t = advancePastFixedBlocks(startSearchM, merged);
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const endM = t + L;
    const conflict = merged.find((b) => intervalsOverlap(t, endM, b.startM, b.endM));
    if (!conflict) return { startM: t, endM };
    t = advancePastFixedBlocks(conflict.endM, merged);
  }
  return { startM: t, endM: t + L };
}

export function normalizeLayout(partial) {
  const base = { ...DEFAULT_TIMETABLE_LAYOUT, ...partial };
  const cycle =
    base.cycle === TIMETABLE_CYCLE.TWO_WEEK ? TIMETABLE_CYCLE.TWO_WEEK : TIMETABLE_CYCLE.ONE_WEEK;
  const periodsPerDay = clampInt(
    base.periodsPerDay,
    LIMITS.periodsMin,
    LIMITS.periodsMax,
  );
  const periodLengthMinutes = clampInt(
    base.periodLengthMinutes,
    LIMITS.periodLengthMin,
    LIMITS.periodLengthMax,
  );
  const schoolStartTime = normalizeTimeString(base.schoolStartTime);
  const registration = normalizeRegistration(base.registration);
  const breaks = normalizeBreaksList(base.breaks);
  const lunch = normalizeLunch(base.lunch);
  const showBreaksInTimetable = base.showBreaksInTimetable !== false;
  const showLunchInTimetable = base.showLunchInTimetable !== false;

  return {
    cycle,
    periodsPerDay,
    periodLengthMinutes,
    schoolStartTime,
    registration,
    breaks,
    lunch,
    showBreaksInTimetable,
    showLunchInTimetable,
  };
}

/**
 * Ordered rows: teaching periods (packed between registration, breaks, and lunch), then those fixed rows,
 * sorted by start time. Sessions use `time` as rowIndex into this list (lesson rows only).
 */
export function buildRowSegments(layout) {
  const normalized = normalizeLayout(layout);
  const {
    periodsPerDay,
    periodLengthMinutes,
    schoolStartTime,
    registration,
    breaks,
    lunch,
    showBreaksInTimetable,
    showLunchInTimetable,
  } = normalized;
  const T0 = parseTimeToMinutes(schoolStartTime);
  const L = periodLengthMinutes;
  const segments = [];

  const fixedMerged = collectMergedFixedIntervals(normalized);

  let cursor = T0;
  for (let i = 0; i < periodsPerDay; i += 1) {
    const { startM, endM } = findNextLessonInterval(cursor, L, fixedMerged);
    segments.push({
      kind: 'lesson',
      lessonIndex: i,
      startM,
      endM,
    });
    cursor = endM;
  }

  const regLen = clampInt(
    registration.lengthMinutes,
    LIMITS.registrationLengthMin,
    LIMITS.registrationLengthMax,
  );
  if (registration.enabled && regLen > 0) {
    const startM = parseTimeToMinutes(registration.startTime);
    segments.push({
      kind: 'registration',
      startM,
      endM: startM + regLen,
    });
  }

  if (showBreaksInTimetable) {
    breaks.forEach((b, breakIndex) => {
      const startM = parseTimeToMinutes(b.startTime);
      const len = clampInt(b.lengthMinutes, LIMITS.breakLengthMin, LIMITS.breakLengthMax);
      segments.push({
        kind: 'break',
        breakIndex,
        startM,
        endM: startM + len,
      });
    });
  }

  const lunchLen = clampInt(lunch.lengthMinutes, 0, LIMITS.lunchLengthMax);
  if (lunchLen > 0 && showLunchInTimetable) {
    const startM = parseTimeToMinutes(lunch.startTime);
    segments.push({
      kind: 'lunch',
      startM,
      endM: startM + lunchLen,
    });
  }

  const kindOrder = { lesson: 0, registration: 1, break: 2, lunch: 3 };
  segments.sort((a, b) => {
    if (a.startM !== b.startM) return a.startM - b.startM;
    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  return segments.map((s, rowIndex) => ({
    ...s,
    rowIndex,
    timeLabel: formatMinutesAsTime(s.startM),
    rangeLabel: `${formatMinutesAsTime(s.startM)} – ${formatMinutesAsTime(s.endM)}`,
  }));
}

export function buildDayColumnLabels(layout) {
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  if (layout.cycle === TIMETABLE_CYCLE.TWO_WEEK) {
    return [
      ...weekdays.map((d) => `${d} A`),
      ...weekdays.map((d) => `${d} B`),
    ];
  }
  return [...weekdays];
}

export function makeLayoutKey(layout) {
  const n = normalizeLayout(layout);
  return JSON.stringify({
    c: n.cycle,
    p: n.periodsPerDay,
    l: n.periodLengthMinutes,
    s: n.schoolStartTime,
    b: n.breaks,
    u: n.lunch,
    reg: n.registration,
    sb: n.showBreaksInTimetable,
    sl: n.showLunchInTimetable,
  });
}

function lessonRowIndexMap(segments) {
  const map = new Map();
  segments.forEach((seg) => {
    if (seg.kind === 'lesson') {
      map.set(seg.lessonIndex, seg.rowIndex);
    }
  });
  return map;
}

/** Demo lessons; `time` on template = lesson index, mapped to row index. */
export function buildDefaultSessions(layout) {
  const dayCount = getDayCount(layout);
  const segments = buildRowSegments(layout);
  const lessonToRow = lessonRowIndexMap(segments);

  const templates = [];

  return templates
    .filter((t) => t.day < dayCount && lessonToRow.has(t.time))
    .map((t) => {
      const rowIndex = lessonToRow.get(t.time);
      const seg = segments[rowIndex];
      return {
        ...t,
        time: rowIndex,
        meta: seg?.rangeLabel ?? periodRangeMeta(layout, t.time),
      };
    });
}

export function pruneSessionsToGrid(sessions, layout) {
  const dayCount = getDayCount(layout);
  const segments = buildRowSegments(layout);
  const rowCount = segments.length;

  return sessions
    .filter((s) => {
      if (s.day >= dayCount || s.time < 0 || s.time >= rowCount) return false;
      const seg = segments[s.time];
      return seg && seg.kind === 'lesson';
    })
    .map((s) => {
      const seg = segments[s.time];
      return {
        ...s,
        meta: seg.rangeLabel,
      };
    });
}
