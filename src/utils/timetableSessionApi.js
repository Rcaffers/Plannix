import { getSupabaseClient } from '../lib/supabase.js';
import { API_BASE_URL, ApiError, JSON_POST_HEADERS, parseJsonSafe } from './api.js';
import { CANONICAL_UUID } from './timetableLayoutPersistence.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_ID = CANONICAL_UUID;

function uuid(value, label) {
  if (!CANONICAL_UUID.test(String(value || ''))) throw new ApiError(`${label} is invalid.`);
  return value;
}

function monday(value) {
  if (!DATE.test(String(value || ''))) throw new ApiError('Week start date is invalid.');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) {
    throw new ApiError('Week start date is invalid.');
  }
  return value;
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError('Timetable session revision is invalid.');
  return value;
}

function publicSession(value, inherited = false) {
  const allowed = inherited
    ? ['day', 'periodId', 'classId', 'title', 'notes']
    : ['id', 'day', 'periodId', 'classId', 'title', 'notes'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !allowed.includes(key))
      || (!inherited && !CANONICAL_UUID.test(String(value.id || '')))
      || !Number.isInteger(value.day) || value.day < 0 || value.day > 4
      || !CANONICAL_UUID.test(String(value.periodId || ''))
      || !CANONICAL_UUID.test(String(value.classId || ''))
      || typeof value.title !== 'string' || value.title.length > 200
      || typeof value.notes !== 'string' || value.notes.length > 5000) {
    throw new ApiError('The server returned invalid timetable session data.');
  }
  return {
    ...(!inherited ? { id: value.id } : {}), day: value.day, periodId: value.periodId,
    classId: value.classId, title: value.title, notes: value.notes,
  };
}

function requestSession(value) {
  const result = publicSession(value, value.id == null);
  return { ...(value.id ? { id: value.id } : {}), ...result };
}

function requestSessions(values) {
  if (!Array.isArray(values) || values.length > 60) throw new ApiError('Timetable sessions are invalid.');
  const ids = new Set(); const slots = new Set();
  return values.map((value) => {
    const result = requestSession(value); const slot = `${result.day}:${result.periodId}`;
    if ((result.id && ids.has(result.id)) || slots.has(slot)) throw new ApiError('Timetable sessions contain duplicate identities.');
    if (result.id) ids.add(result.id); slots.add(slot); return result;
  });
}

function mapRecurring(payload) {
  revision(payload?.revision);
  if (!Array.isArray(payload?.weeks)) throw new ApiError('The server returned invalid timetable session data.');
  return {
    revision: payload.revision,
    weeks: payload.weeks.map((week) => {
      if (!CANONICAL_UUID.test(String(week?.weekId || '')) || !['A', 'B'].includes(week?.code)
          || (week.collectionId != null && !CANONICAL_UUID.test(String(week.collectionId)))
          || !Array.isArray(week.sessions)) throw new ApiError('The server returned invalid timetable session data.');
      return { weekId: week.weekId, code: week.code, collectionId: week.collectionId ?? null,
        sessions: week.sessions.map((entry) => publicSession(entry)) };
    }),
  };
}

function mapDated(payload) {
  revision(payload?.revision); monday(payload?.weekStartDate); uuid(payload?.repeatingWeekId, 'Repeating week');
  if (!['recurring', 'override'].includes(payload?.source) || typeof payload?.overrideExists !== 'boolean'
      || payload.overrideExists !== (payload.source === 'override')
      || (payload.collectionId != null && !CANONICAL_UUID.test(String(payload.collectionId)))
      || !Array.isArray(payload.sessions)) throw new ApiError('The server returned invalid timetable session data.');
  return { revision: payload.revision, weekStartDate: payload.weekStartDate,
    repeatingWeekId: payload.repeatingWeekId, source: payload.source,
    overrideExists: payload.overrideExists, collectionId: payload.collectionId ?? null,
    sessions: payload.sessions.map((entry) => publicSession(entry, !payload.overrideExists)) };
}

function mapSaved(payload, dated = false) {
  revision(payload?.revision); uuid(payload?.collectionId, 'Session collection');
  if (!Array.isArray(payload?.sessions)) throw new ApiError('The server returned invalid timetable session data.');
  return { revision: payload.revision, collectionId: payload.collectionId,
    ...(dated ? { repeatingWeekId: uuid(payload.repeatingWeekId, 'Repeating week') } : {}),
    sessions: payload.sessions.map((entry) => publicSession(entry)) };
}

async function defaultSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) throw new ApiError('Authentication is required.', { status: 401 });
  const validation = await client.auth.getUser(data.session.access_token);
  if (validation.error || !validation.data?.user) throw new ApiError('Authentication is required.', { status: 401 });
  return data.session;
}

export function createTimetableSessionApi({ fetchImpl = fetch, getSession = defaultSession } = {}) {
  async function request(path, options, fallback, mapper) {
    try {
      const session = await getSession();
      if (!session?.access_token) throw new ApiError('Authentication is required.', { status: 401 });
      const response = await fetchImpl(`${API_BASE_URL}${path}`, { ...options, credentials: 'omit',
        headers: { ...options?.headers, Authorization: `Bearer ${session.access_token}` } });
      const payload = await parseJsonSafe(response);
      const rawRequestId = response.headers?.get?.('x-request-id');
      const requestId = REQUEST_ID.test(String(rawRequestId || '')) ? rawRequestId : null;
      if (!response.ok) throw new ApiError(payload?.message || fallback, { status: response.status, requestId });
      return { ...mapper(payload), requestId };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(fallback);
    }
  }
  function scope(value) {
    return { organisationId: uuid(value.organisationId, 'Organisation'),
      academicYearId: uuid(value.academicYearId, 'Academic year'), timetableId: uuid(value.timetableId, 'Timetable') };
  }
  const query = (value, extras = {}) => new URLSearchParams({ ...scope(value), ...extras });
  const body = (value, extras = {}) => ({ ...scope(value), ...extras });
  return {
    loadRecurring(value) { return request(`/api/timetable/sessions/recurring?${query(value)}`, { method: 'GET' }, 'Could not load timetable sessions.', mapRecurring); },
    saveRecurring(value) { return request('/api/timetable/sessions/recurring', { method: 'PUT', headers: JSON_POST_HEADERS,
      body: JSON.stringify(body(value, { weekId: uuid(value.weekId, 'Week'), expectedRevision: revision(value.expectedRevision), sessions: requestSessions(value.sessions) })) }, 'Could not save timetable sessions.', (payload) => mapSaved(payload)); },
    loadDate(value) { return request(`/api/timetable/sessions/date?${query(value, { weekStartDate: monday(value.weekStartDate) })}`, { method: 'GET' }, 'Could not load timetable sessions.', mapDated); },
    saveDate(value) { return request('/api/timetable/sessions/date', { method: 'PUT', headers: JSON_POST_HEADERS,
      body: JSON.stringify(body(value, { weekStartDate: monday(value.weekStartDate), expectedRevision: revision(value.expectedRevision), sessions: requestSessions(value.sessions) })) }, 'Could not save timetable sessions.', (payload) => mapSaved(payload, true)); },
    removeDate(value) { const q = query(value, { weekStartDate: monday(value.weekStartDate), expectedRevision: String(revision(value.expectedRevision)) });
      return request(`/api/timetable/sessions/date?${q}`, { method: 'DELETE' }, 'Could not restore the repeating timetable.', mapDated); },
    saveBatch(value) { if (!Array.isArray(value.mutations) || value.mutations.length < 1 || value.mutations.length > 20) throw new ApiError('Session mutations are invalid.');
      const targets = new Set(); const mutations = value.mutations.map((mutation) => { if (!['recurring', 'date_override'].includes(mutation.type)) throw new ApiError('Session mutation type is invalid.'); const target = mutation.type === 'recurring' ? `recurring:${mutation.weekId}` : `date:${mutation.weekStartDate}`; if (targets.has(target)) throw new ApiError('Session mutation targets must be unique.'); targets.add(target); return ({ type: mutation.type,
      ...(mutation.type === 'recurring' ? { weekId: uuid(mutation.weekId, 'Week') } : { weekStartDate: monday(mutation.weekStartDate) }),
      sessions: requestSessions(mutation.sessions) }); });
      return request('/api/timetable/sessions/batch', { method: 'PUT', headers: JSON_POST_HEADERS,
        body: JSON.stringify(body(value, { expectedRevision: revision(value.expectedRevision), mutations })) }, 'Could not save timetable sessions.', (payload) => {
        revision(payload?.revision); if (!Array.isArray(payload?.collections)) throw new ApiError('The server returned invalid timetable session data.');
        return { revision: payload.revision, collections: payload.collections.map((collection) => ({
          type: collection.type, collectionId: uuid(collection.collectionId, 'Session collection'),
          weekId: uuid(collection.weekId, 'Week'), ...(collection.type === 'date_override' ? { weekStartDate: monday(collection.weekStartDate) } : {}),
          sessions: collection.sessions.map((entry) => publicSession(entry)),
        })) };
      }); },
  };
}

const timetableSessionApi = createTimetableSessionApi();
export const fetchRecurringTimetableSessions = (scope) => timetableSessionApi.loadRecurring(scope);
export const saveRecurringTimetableSessions = (input) => timetableSessionApi.saveRecurring(input);
export const fetchDatedTimetableSessions = (input) => timetableSessionApi.loadDate(input);
export const saveDatedTimetableSessions = (input) => timetableSessionApi.saveDate(input);
export const removeDatedTimetableOverride = (input) => timetableSessionApi.removeDate(input);
export const saveTimetableSessionBatch = (input) => timetableSessionApi.saveBatch(input);
