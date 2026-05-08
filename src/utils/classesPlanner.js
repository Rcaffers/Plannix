import { TIMETABLE_CYCLE } from './timetableLayout';

export const CLASS_CADENCE = {
  ONE_WEEK: 'week',
  TWO_WEEK: 'two-weeks',
};

const LIMITS = {
  classCountMin: 0,
  classCountMax: 60,
  frequencyMin: 0,
  frequencyMax: 50,
};

export const DEFAULT_CLASSES_PLAN = {
  cadence: CLASS_CADENCE.ONE_WEEK,
  entries: [],
};

function clampInt(value, min, max) {
  const x = Math.floor(Number(value));
  if (Number.isNaN(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function normalizeCadence(value) {
  return value === CLASS_CADENCE.TWO_WEEK ? CLASS_CADENCE.TWO_WEEK : CLASS_CADENCE.ONE_WEEK;
}

/** Align stored class-plan cadence with timetable cycle (single source of truth in settings). */
export function cadenceFromTimetableCycle(cycle) {
  return cycle === TIMETABLE_CYCLE.TWO_WEEK ? CLASS_CADENCE.TWO_WEEK : CLASS_CADENCE.ONE_WEEK;
}

function normalizeEntry(raw, index) {
  const fallbackName = `Class ${index + 1}`;
  return {
    id: String(raw?.id || `class-${index + 1}`),
    name: String(raw?.name ?? fallbackName).trim(),
    frequency: clampInt(raw?.frequency ?? 1, LIMITS.frequencyMin, LIMITS.frequencyMax),
  };
}

export function normalizeClassesPlan(raw) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const fallbackCadence =
    entries.length > 0 && entries[0] && typeof entries[0] === 'object'
      ? normalizeCadence(entries[0].cadence)
      : CLASS_CADENCE.ONE_WEEK;
  const cadence = normalizeCadence(raw?.cadence ?? fallbackCadence);
  return {
    cadence,
    entries: entries
      .slice(LIMITS.classCountMin, LIMITS.classCountMax)
      .map((entry, index) => normalizeEntry(entry, index)),
  };
}

export function setClassEntryCount(plan, count) {
  const normalized = normalizeClassesPlan(plan);
  const nextCount = clampInt(count, LIMITS.classCountMin, LIMITS.classCountMax);
  const entries = [...normalized.entries];

  while (entries.length < nextCount) {
    entries.push(
      normalizeEntry(
        {
          id: `class-${entries.length + 1}-${Date.now()}`,
          name: '',
          frequency: 1,
        },
        entries.length,
      ),
    );
  }

  return {
    cadence: normalized.cadence,
    entries: entries.slice(0, nextCount),
  };
}

function newClassId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `class-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Append one empty class row (respects max class count). */
export function addClassEntry(plan) {
  const normalized = normalizeClassesPlan(plan);
  if (normalized.entries.length >= LIMITS.classCountMax) {
    return normalized;
  }
  const index = normalized.entries.length;
  const nextEntry = normalizeEntry({ id: newClassId(), name: '', frequency: 1 }, index);
  return {
    cadence: normalized.cadence,
    entries: [...normalized.entries, nextEntry],
  };
}

/** Remove class at index. */
export function removeClassEntry(plan, index) {
  const normalized = normalizeClassesPlan(plan);
  const i = Math.floor(Number(index));
  if (!Number.isFinite(i) || i < 0 || i >= normalized.entries.length) return normalized;
  return {
    cadence: normalized.cadence,
    entries: normalized.entries.filter((_, j) => j !== i),
  };
}

