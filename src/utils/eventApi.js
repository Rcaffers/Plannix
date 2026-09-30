import { getSupabaseClient } from '../lib/supabase.js';
import { API_BASE_URL, ApiError, JSON_POST_HEADERS, parseJsonSafe } from './api.js';
import { CANONICAL_EVENT_UUID, normalizeEventFields, realEventDate } from '../../shared/personalEvent.js';

const REQUEST_ID = CANONICAL_EVENT_UUID;
const uuid = (value, name) => {
  if (typeof value !== 'string' || !CANONICAL_EVENT_UUID.test(value)) throw new ApiError(`${name} is invalid.`);
  return value;
};
const revision = value => {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError('Event revision is invalid.');
  return value;
};
function eventFields(value) {
  try { return normalizeEventFields(value); }
  catch { throw new ApiError('Event details are invalid.'); }
}
function publicEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'academicYearId,date,endTime,id,location,notes,revision,startTime,title') {
    throw new ApiError('The server returned invalid event data.');
  }
  try {
    const fields = normalizeEventFields({ date: value.date, title: value.title,
      startTime: value.startTime, endTime: value.endTime,
      location: value.location, notes: value.notes });
    if (fields.title !== value.title || fields.location !== value.location || fields.notes !== value.notes) throw 0;
    return { id: uuid(value.id, 'Event'), academicYearId: uuid(value.academicYearId, 'Academic year'),
      ...fields, revision: revision(value.revision) };
  } catch { throw new ApiError('The server returned invalid event data.'); }
}
async function defaultSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) throw new ApiError('Authentication is required.', { status: 401 });
  const checked = await client.auth.getUser(data.session.access_token);
  if (checked.error || !checked.data?.user?.email_confirmed_at) throw new ApiError('Confirmed authentication is required.', { status: 403 });
  return data.session;
}

export function createEventApi({ fetchImpl = fetch, getSession = defaultSession } = {}) {
  async function request(path, options, fallback) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const session = await getSession();
    if (!session?.access_token) throw new ApiError('Authentication is required.', { status: 401 });
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let response;
    try {
      response = await fetchImpl(`${API_BASE_URL}${path}`, {
        ...options, credentials: 'omit', headers: { ...options.headers, Authorization: `Bearer ${session.access_token}` },
      });
    } catch (error) {
      if (options.signal?.aborted || error?.name === 'AbortError') throw error;
      throw new ApiError(fallback);
    }
    const payload = await parseJsonSafe(response);
    const requestId = response.headers?.get?.('x-request-id');
    const safeId = REQUEST_ID.test(String(requestId || '')) ? requestId : null;
    if (!response.ok) {
      const safeMessage = typeof payload?.message === 'string' && payload.message.length <= 250
        ? payload.message : fallback;
      throw new ApiError(safeMessage, { status: response.status, requestId: safeId });
    }
    return { payload, requestId: safeId };
  }
  return {
    async list(academicYearId, { from, to, signal } = {}) {
      uuid(academicYearId, 'Academic year');
      if ((from === undefined) !== (to === undefined)) throw new ApiError('Both event date filters are required.');
      const query = new URLSearchParams({ academicYearId });
      if (from !== undefined) {
        if (!realEventDate(from) || !realEventDate(to) || from > to
          || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 31) {
          throw new ApiError('Event date filters are invalid.');
        }
        query.set('from', from); query.set('to', to);
      }
      const { payload, requestId } = await request(`/api/events?${query}`, { method: 'GET', signal }, 'Could not load events.');
      if (!Array.isArray(payload?.events) || payload.events.length > 500) throw new ApiError('The server returned invalid event data.');
      const events = payload.events.map(publicEvent);
      const ids = new Set();
      if (events.some(event => {
        if (ids.has(event.id) || event.academicYearId !== academicYearId
          || (from && (event.date < from || event.date > to))) return true;
        ids.add(event.id);
        return false;
      })) throw new ApiError('The server returned invalid event data.');
      return { events, requestId };
    },
    async create(academicYearId, event, { signal } = {}) {
      uuid(academicYearId, 'Academic year');
      const fields = eventFields(event);
      const { payload, requestId } = await request('/api/events', { method: 'POST', headers: JSON_POST_HEADERS,
        body: JSON.stringify({ academicYearId, event: fields }), signal }, 'Could not save event.');
      const saved = publicEvent(payload?.event);
      if (saved.academicYearId !== academicYearId) throw new ApiError('The server returned invalid event data.');
      return { event: saved, requestId };
    },
    async update(eventId, expectedRevision, event, { signal } = {}) {
      uuid(eventId, 'Event'); revision(expectedRevision);
      const fields = eventFields(event);
      const { payload, requestId } = await request(`/api/events/${eventId}`, { method: 'PUT', headers: JSON_POST_HEADERS,
        body: JSON.stringify({ expectedRevision, event: fields }), signal }, 'Could not save event.');
      const saved = publicEvent(payload?.event);
      if (saved.id !== eventId || saved.revision !== expectedRevision + 1) throw new ApiError('The server returned invalid event data.');
      return { event: saved, requestId };
    },
    async remove(eventId, expectedRevision, { signal } = {}) {
      uuid(eventId, 'Event'); revision(expectedRevision);
      const { payload, requestId } = await request(`/api/events/${eventId}`, { method: 'DELETE', headers: JSON_POST_HEADERS,
        body: JSON.stringify({ expectedRevision }), signal }, 'Could not delete event.');
      if (payload?.ok !== true || Object.keys(payload).length !== 1) throw new ApiError('The server returned invalid event data.');
      return { ok: true, requestId };
    },
  };
}

export const eventApi = createEventApi();
