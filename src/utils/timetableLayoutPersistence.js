import { DEFAULT_TIMETABLE_LAYOUT, normalizeLayout } from './timetableLayout.js';

export const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createDefaultLayoutDraft() {
  return { name: 'My timetable', ...normalizeLayout(DEFAULT_TIMETABLE_LAYOUT) };
}

export function editableLayout(value) {
  const normalized = normalizeLayout(value || DEFAULT_TIMETABLE_LAYOUT);
  return {
    name: String(value?.name || 'My timetable'),
    ...normalized,
    registration: { ...normalized.registration, ...(value?.registration?.id ? { id: value.registration.id } : {}) },
    breaks: normalized.breaks.map((entry, index) => ({
      ...entry,
      ...(value?.breaks?.[index]?.id ? { id: value.breaks[index].id } : {}),
    })),
    lunch: { ...normalized.lunch, ...(value?.lunch?.id ? { id: value.lunch.id } : {}) },
  };
}

export function publicLayout(value) {
  if (!value || !CANONICAL_UUID.test(String(value.timetableId || ''))
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.weeks) || !Array.isArray(value.periods)) {
    throw new Error('The server returned invalid timetable layout data.');
  }
  const weeks = value.weeks.map((week) => {
    if (!CANONICAL_UUID.test(String(week?.id || '')) || !['A', 'B'].includes(week?.code)) throw new Error('The server returned invalid timetable layout data.');
    return { id: week.id, code: week.code, name: String(week.name || '') };
  });
  const periods = value.periods.map((period) => {
    if (!CANONICAL_UUID.test(String(period?.id || ''))) throw new Error('The server returned invalid timetable layout data.');
    return {
      id: period.id, type: period.type, number: period.number ?? null, label: String(period.label || ''),
      startTime: period.startTime, endTime: period.endTime, enabled: Boolean(period.enabled),
      visible: Boolean(period.visible), order: Number(period.order),
    };
  });
  return { ...editableLayout(value), timetableId: value.timetableId, revision: value.revision, weeks, periods };
}

export function layoutDraftEqual(left, right) {
  return JSON.stringify(editableLayout(left)) === JSON.stringify(editableLayout(right));
}

export function safeLayoutError(error, fallback = 'Could not save the timetable layout.') {
  if (error?.status === 409) {
    if (/Week B/i.test(error.message || '')) return 'Week B still contains timetable sessions. Remove or move those sessions before changing to one week.';
    if (/period/i.test(error.message || '')) return 'A teaching period still contains timetable sessions. Remove or move those sessions before reducing the layout.';
    if (/default timetable/i.test(error.message || '')) return 'Another default timetable already exists for this academic year. Reload before trying again.';
    return 'The timetable layout changed since it was loaded. Reload it before saving again.';
  }
  return String(error?.message || fallback);
}
