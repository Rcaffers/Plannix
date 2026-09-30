import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createRequestSupabaseClient } from '../supabase/client.js';
import { CANONICAL_EVENT_UUID, normalizeEventFields, realEventDate } from '../../shared/personalEvent.js';

const failure = (statusCode, message) => Object.assign(new Error(message), { expose: true, statusCode });
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
const uuid = value => typeof value === 'string' && CANONICAL_EVENT_UUID.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 1;
function listQuery(query) {
  if (!only(query, ['academicYearId', 'from', 'to']) || !uuid(query.academicYearId)) throw failure(400, 'Event query is invalid.');
  if (Object.hasOwn(query, 'from') !== Object.hasOwn(query, 'to')) throw failure(400, 'Both event date filters are required.');
  if (query.from !== undefined) {
    if (!realEventDate(query.from) || !realEventDate(query.to) || query.from > query.to) throw failure(400, 'Event date filters are invalid.');
    const days = Math.round((Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86400000);
    if (days > 31) throw failure(400, 'Event date range must be no longer than 32 days.');
  }
  return query;
}
function bodyEvent(value) {
  try { return normalizeEventFields(value); } catch { throw failure(400, 'Event fields are invalid.'); }
}
function mapEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'academicYearId,date,endTime,id,location,notes,revision,startTime,title'
    || !uuid(value.id) || !uuid(value.academicYearId) || !revision(value.revision)) throw failure(500, 'Could not read event data.');
  try {
    const fields = normalizeEventFields({ date: value.date, title: value.title,
      startTime: value.startTime, endTime: value.endTime,
      location: value.location, notes: value.notes });
    if (fields.title !== value.title || fields.location !== value.location || fields.notes !== value.notes) throw 0;
    return { id: value.id, academicYearId: value.academicYearId, ...fields, revision: value.revision };
  } catch { throw failure(500, 'Could not read event data.'); }
}
function rpcError(error, action) {
  if (error?.code === 'P0002') return failure(404, 'Event or academic year was not found.');
  if (error?.code === '42501') return failure(403, 'Personal events are unavailable for this account.');
  if (error?.code === '40001') return failure(409, 'This event changed elsewhere. Reload and try again.');
  if (error?.code === '23505') return failure(409, 'An event with the same title, date and times already exists.');
  if (error?.code === 'P1001') return failure(409, 'This academic year already has 500 events.');
  if (error?.code === '22023' || error?.code === '23514' || error?.code === '22007') return failure(400, 'Event details are invalid.');
  return failure(500, `Could not ${action} events.`);
}
const rpcFields = event => ({ target_date: event.date, target_title: event.title,
  target_start_time: event.startTime, target_end_time: event.endTime,
  target_location: event.location, target_notes: event.notes });

export function registerEventRoutes({ app, requireAuth = requireSupabaseAuth,
  createRequestClient = auth => createRequestSupabaseClient(auth) } = {}) {
  app.get('/api/events', requireAuth, async (req, res, next) => {
    try {
      const query = listQuery(req.query);
      const { data, error } = await createRequestClient(req.auth).rpc('plannix_list_personal_events', {
        target_academic_year_id: query.academicYearId, date_from: query.from ?? null, date_to: query.to ?? null,
      });
      if (error) throw rpcError(error, 'load');
      if (!Array.isArray(data) || data.length > 500) throw failure(500, 'Could not read event data.');
      const events = data.map(mapEvent);
      if (events.some(event => event.academicYearId !== query.academicYearId
        || (query.from && (event.date < query.from || event.date > query.to)))) {
        throw failure(500, 'Could not read event data.');
      }
      res.json({ events });
    } catch (error) { next(error?.expose ? error : failure(500, 'Could not load events.')); }
  });
  app.post('/api/events', requireAuth, async (req, res, next) => {
    try {
      if (Object.keys(req.query).length || !only(req.body, ['academicYearId', 'event']) || !uuid(req.body.academicYearId)
        || !Object.hasOwn(req.body, 'event')) throw failure(400, 'Event request is invalid.');
      const event = bodyEvent(req.body.event);
      const { data, error } = await createRequestClient(req.auth).rpc('plannix_create_personal_event', {
        target_academic_year_id: req.body.academicYearId, ...rpcFields(event),
      });
      if (error) throw rpcError(error, 'save');
      res.status(201).json({ event: mapEvent(data) });
    } catch (error) { next(error?.expose ? error : failure(500, 'Could not save event.')); }
  });
  app.put('/api/events/:id', requireAuth, async (req, res, next) => {
    try {
      if (Object.keys(req.query).length || !uuid(req.params.id) || !only(req.body, ['expectedRevision', 'event'])
        || !revision(req.body.expectedRevision) || !Object.hasOwn(req.body, 'event')) throw failure(400, 'Event request is invalid.');
      const event = bodyEvent(req.body.event);
      const { data, error } = await createRequestClient(req.auth).rpc('plannix_update_personal_event', {
        target_event_id: req.params.id, expected_revision: req.body.expectedRevision, ...rpcFields(event),
      });
      if (error) throw rpcError(error, 'save');
      res.json({ event: mapEvent(data) });
    } catch (error) { next(error?.expose ? error : failure(500, 'Could not save event.')); }
  });
  app.delete('/api/events/:id', requireAuth, async (req, res, next) => {
    try {
      if (Object.keys(req.query).length || !uuid(req.params.id) || !only(req.body, ['expectedRevision'])
        || !revision(req.body.expectedRevision)) throw failure(400, 'Event request is invalid.');
      const { data, error } = await createRequestClient(req.auth).rpc('plannix_delete_personal_event', {
        target_event_id: req.params.id, expected_revision: req.body.expectedRevision,
      });
      if (error) throw rpcError(error, 'delete');
      if (data !== true) throw failure(500, 'Could not delete event.');
      res.json({ ok: true });
    } catch (error) { next(error?.expose ? error : failure(500, 'Could not delete event.')); }
  });
}
