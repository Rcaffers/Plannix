const STORAGE_KEY = 'plannix_classes_plan_v1';

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

function normalizeEntry(raw, index) {
  const fallbackName = `Class ${index + 1}`;
  return {
    id: String(raw?.id || `class-${index + 1}`),
    name: String(raw?.name ?? fallbackName).trim(),
    frequency: clampInt(raw?.frequency ?? 0, LIMITS.frequencyMin, LIMITS.frequencyMax),
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
          frequency: 0,
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

export function loadClassesPlanFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeClassesPlan(DEFAULT_CLASSES_PLAN);
    const parsed = JSON.parse(raw);
    return normalizeClassesPlan(parsed);
  } catch {
    return normalizeClassesPlan(DEFAULT_CLASSES_PLAN);
  }
}

export function saveClassesPlanToStorage(plan) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeClassesPlan(plan)));
  } catch {
    /* ignore */
  }
}
