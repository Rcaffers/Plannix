import { MAX_PERSONAL_EVENTS, eventIdentityKey, normalizeEventFields, normalizeEventText, realEventDate } from '../../shared/personalEvent.js';

export const blankEventDraft = () => ({ title: '', date: '', allDay: true, startTime: '', endTime: '', location: '', notes: '' });

export function draftFromEvent(event) {
  return { title: event.title, date: event.date, allDay: event.startTime === null,
    startTime: event.startTime || '', endTime: event.endTime || '',
    location: event.location || '', notes: event.notes || '' };
}

export function validateEventDraft(draft, year) {
  if (!draft.title.trim()) return { field: 'title', message: 'Enter an event title.' };
  if (!realEventDate(draft.date)) return { field: 'date', message: 'Enter a valid event date.' };
  if (draft.date < year.startDate || draft.date > year.endDate) {
    return { field: 'date', message: 'Choose a date within the selected academic year.' };
  }
  if (!draft.allDay && (!draft.startTime || !draft.endTime)) {
    return { field: draft.startTime ? 'endTime' : 'startTime', message: 'Enter both start and end times.' };
  }
  const textFields = [
    ['title', draft.title, 200, { required: true }],
    ['location', draft.location, 200, {}],
    ['notes', draft.notes, 2000, { multiline: true }],
  ];
  for (const [field, value, limit, options] of textFields) {
    try { normalizeEventText(value, limit, options); }
    catch { return { field, message: `Check the ${field} for unsupported characters or length.` }; }
  }
  try {
    return { event: normalizeEventFields({ title: draft.title, date: draft.date,
      startTime: draft.allDay ? null : draft.startTime,
      endTime: draft.allDay ? null : draft.endTime,
      location: draft.location, notes: draft.notes }) };
  } catch { return { field: 'endTime', message: 'End time must be after start time.' }; }
}

export function matchingCreatedEvents(events, attempted) {
  const key = eventIdentityKey(attempted);
  return events.filter(event => eventIdentityKey(event) === key);
}

export function confirmedDraftUnchanged(confirmation, version, editor) {
  return confirmation.version === version && confirmation.serializedEditor === JSON.stringify(editor);
}

export function sortPersonalEvents(events) {
  return [...events].sort((a, b) => a.date.localeCompare(b.date)
    || (a.startTime === null ? -1 : b.startTime === null ? 1 : a.startTime.localeCompare(b.startTime))
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function canAddEvent(events) { return events.length < MAX_PERSONAL_EVENTS; }
