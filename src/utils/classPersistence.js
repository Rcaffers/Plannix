const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const CLASS_LIMITS = Object.freeze({
  count: 60,
  name: 200,
  frequencyMin: 1,
  frequencyMax: 50,
});

export function isCanonicalUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function clientKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function toDraftClass(entry = {}) {
  return {
    ...(isCanonicalUuid(entry.id) ? { id: entry.id } : {}),
    clientKey: String(entry.clientKey || (isCanonicalUuid(entry.id) ? entry.id : clientKey())),
    name: String(entry.name ?? ''),
    frequency: entry.frequency ?? 1,
  };
}

export function toDraftClasses(entries) {
  return (Array.isArray(entries) ? entries : []).map(toDraftClass);
}

export function validateClassDraft(entries) {
  if (!Array.isArray(entries)) return 'Classes must be supplied as a list.';
  if (entries.length > CLASS_LIMITS.count) return 'You can add no more than 60 classes.';
  const ids = new Set();
  const names = new Set();
  for (const entry of entries) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (name.length < 1 || name.length > CLASS_LIMITS.name) {
      return 'Each class name must contain between 1 and 200 characters.';
    }
    if (names.has(name)) return 'Class names must be unique.';
    names.add(name);
    if (entry.id != null && !isCanonicalUuid(entry.id)) return 'A saved class has an invalid ID.';
    if (entry.id && ids.has(entry.id)) return 'Class IDs must be unique.';
    if (entry.id) ids.add(entry.id);
    const frequency = Number(entry.frequency);
    if (!Number.isInteger(frequency)
        || frequency < CLASS_LIMITS.frequencyMin
        || frequency > CLASS_LIMITS.frequencyMax) {
      return 'Each class frequency must be an integer from 1 to 50.';
    }
  }
  return '';
}

export function toClassRequestEntries(entries) {
  const error = validateClassDraft(entries);
  if (error) throw new Error(error);
  return entries.map((entry) => ({
    ...(isCanonicalUuid(entry.id) ? { id: entry.id } : {}),
    name: entry.name.trim(),
    frequency: Number(entry.frequency),
  }));
}

export function classEntriesEqual(left, right) {
  const comparable = (entries) => (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: isCanonicalUuid(entry.id) ? entry.id : null,
    name: String(entry.name ?? ''),
    frequency: Number(entry.frequency),
  }));
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function addDraftClass(entries) {
  if (entries.length >= CLASS_LIMITS.count) return entries;
  return [...entries, toDraftClass({ name: '', frequency: 1 })];
}

export function safeClassError(error, fallback) {
  if (error?.status === 409) {
    if (String(error.message || '').includes('timetable placements')) {
      return 'This class still has timetable placements. Remove or reassign those placements, then save again.';
    }
    return 'Classes changed elsewhere after you loaded them. Reload before saving again.';
  }
  return String(error?.message || fallback || 'Could not update classes.');
}
