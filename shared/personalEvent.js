// Personal event dates/times are local calendar values, not UTC instants.
export const MAX_PERSONAL_EVENTS = 500;
export const CANONICAL_EVENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

export function realEventDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeEventText(value, limit, { multiline = false, required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new Error('Event text is invalid.');
    return null;
  }
  if (typeof value !== 'string') throw new Error('Event text is invalid.');
  let text = value.normalize('NFC');
  if (multiline) {
    text = text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
    if (/[\p{Cc}\p{Cf}]/u.test(text.replace(/\n/g, ''))) throw new Error('Event text is invalid.');
    text = text.trim();
  } else {
    if (CONTROL_OR_FORMAT.test(text) || /[<>`]/.test(text)) throw new Error('Event text is invalid.');
    text = text.replace(/\p{White_Space}+/gu, ' ').trim();
  }
  if ((required && !text) || [...text].length > limit) throw new Error('Event text is invalid.');
  return text || null;
}

export function normalizeEventFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['date', 'title', 'startTime', 'endTime', 'location', 'notes'].includes(key))
    || !Object.hasOwn(value, 'date') || !Object.hasOwn(value, 'title')) throw new Error('Event fields are invalid.');
  if (!realEventDate(value.date)) throw new Error('Event date is invalid.');
  const startTime = value.startTime ?? null;
  const endTime = value.endTime ?? null;
  if ((startTime === null) !== (endTime === null)
    || (startTime !== null && (!CLOCK.test(startTime) || !CLOCK.test(endTime) || endTime <= startTime))
    || (value.startTime !== undefined && value.startTime !== null && typeof value.startTime !== 'string')
    || (value.endTime !== undefined && value.endTime !== null && typeof value.endTime !== 'string')) {
    throw new Error('Event times must be paired HH:MM values with end after start.');
  }
  return {
    date: value.date,
    title: normalizeEventText(value.title, 200, { required: true }),
    startTime, endTime,
    location: normalizeEventText(value.location ?? null, 200),
    notes: normalizeEventText(value.notes ?? null, 2000, { multiline: true }),
  };
}

export function eventIdentityKey(event) {
  return JSON.stringify([event.date, event.title.normalize('NFC').toLowerCase(), event.startTime, event.endTime]);
}
