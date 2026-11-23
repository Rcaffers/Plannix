import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createRequestSupabaseClient } from '../supabase/client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SESSIONS = 60;
const MAX_MUTATIONS = 20;

function publicError(statusCode, message) {
  return Object.assign(new Error(message), { expose: true, statusCode });
}

function onlyKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function isMonday(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf())
    && parsed.toISOString().slice(0, 10) === value
    && parsed.getUTCDay() === 1;
}

function validateScope(value) {
  for (const key of ['organisationId', 'academicYearId', 'timetableId']) {
    if (!isUuid(value?.[key])) throw publicError(400, `${key} must be a valid UUID.`);
  }
  return {
    organisationId: value.organisationId,
    academicYearId: value.academicYearId,
    timetableId: value.timetableId,
  };
}

function validateRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw publicError(400, 'expectedRevision must be a nonnegative safe integer.');
  }
  return value;
}

function validateSessions(value) {
  if (!Array.isArray(value)) throw publicError(400, 'sessions must be an array.');
  if (value.length > MAX_SESSIONS) throw publicError(400, 'sessions must contain no more than 60 entries.');
  const ids = new Set();
  const slots = new Set();
  return value.map((session) => {
    if (!onlyKeys(session, new Set(['id', 'day', 'periodId', 'classId', 'title', 'notes', 'roomId']))) {
      throw publicError(400, 'A timetable session contains unexpected fields.');
    }
    if (session.id != null && !isUuid(session.id)) throw publicError(400, 'Session IDs must be valid UUIDs when supplied.');
    if (session.id && ids.has(session.id)) throw publicError(409, 'Session IDs must be unique.');
    if (!Number.isInteger(session.day) || session.day < 0 || session.day > 4) throw publicError(400, 'Session day must be an integer from 0 to 4.');
    if (!isUuid(session.periodId)) throw publicError(400, 'periodId must be a valid UUID.');
    if (!isUuid(session.classId)) throw publicError(400, 'classId must be a valid UUID.');
    if (typeof session.title !== 'string' || session.title.length > 200) throw publicError(400, 'Session title must be a string containing no more than 200 characters.');
    if (typeof session.notes !== 'string' || session.notes.length > 5000) throw publicError(400, 'Session notes must be a string containing no more than 5000 characters.');
    const slot = `${session.day}:${session.periodId}`;
    if (slots.has(slot)) throw publicError(409, 'Timetable session slots must be unique.');
    if (Object.hasOwn(session,'roomId') && session.roomId !== null && !isUuid(session.roomId)) throw publicError(400, 'Room must be a valid UUID or null.');
    if (session.id) ids.add(session.id);
    slots.add(slot);
    return {
      ...(session.id ? { id: session.id } : {}),
      day: session.day,
      periodId: session.periodId,
      classId: session.classId,
      title: session.title,
      notes: session.notes,
      ...(Object.hasOwn(session,'roomId') ? {roomId:session.roomId} : {}),
    };
  });
}

function validateBaseBody(body, extraKeys) {
  if (!onlyKeys(body, new Set([
    'organisationId', 'academicYearId', 'timetableId', 'expectedRevision', 'includeRooms', ...extraKeys,
  ]))) throw publicError(400, 'Request body contains unexpected fields.');
  const scope = validateScope(body);
  if (Object.hasOwn(body,'includeRooms') && typeof body.includeRooms !== 'boolean') throw publicError(400,'includeRooms must be boolean.');
  return { ...scope, expectedRevision: validateRevision(body.expectedRevision), ...(body.includeRooms ? {includeRooms:true} : {}) };
}

function validateRecurringBody(body) {
  const base = validateBaseBody(body, ['weekId', 'sessions']);
  if (!isUuid(body.weekId)) throw publicError(400, 'weekId must be a valid UUID.');
  return { ...base, weekId: body.weekId, sessions: validateSessions(body.sessions) };
}

function validateDatedBody(body) {
  const base = validateBaseBody(body, ['weekStartDate', 'sessions']);
  if (!isMonday(body.weekStartDate)) throw publicError(400, 'weekStartDate must be a Monday in YYYY-MM-DD format.');
  return { ...base, weekStartDate: body.weekStartDate, sessions: validateSessions(body.sessions) };
}

function validateBatchBody(body) {
  const base = validateBaseBody(body, ['mutations']);
  if (!Array.isArray(body.mutations) || body.mutations.length < 1 || body.mutations.length > MAX_MUTATIONS) {
    throw publicError(400, 'mutations must contain from 1 to 20 entries.');
  }
  const targets = new Set();
  const mutations = body.mutations.map((mutation) => {
    if (!onlyKeys(mutation, new Set(['type', 'weekId', 'weekStartDate', 'sessions']))) {
      throw publicError(400, 'A session mutation contains unexpected fields.');
    }
    let target;
    let result;
    if (mutation.type === 'recurring') {
      if (!isUuid(mutation.weekId) || mutation.weekStartDate != null) {
        throw publicError(400, 'Recurring mutations require only a valid weekId.');
      }
      target = `recurring:${mutation.weekId}`;
      result = { type: 'recurring', weekId: mutation.weekId, sessions: validateSessions(mutation.sessions) };
    } else if (mutation.type === 'date_override') {
      if (!isMonday(mutation.weekStartDate) || mutation.weekId != null) {
        throw publicError(400, 'Dated mutations require only a Monday weekStartDate.');
      }
      target = `date_override:${mutation.weekStartDate}`;
      result = { type: 'date_override', weekStartDate: mutation.weekStartDate, sessions: validateSessions(mutation.sessions) };
    } else {
      throw publicError(400, 'Session mutation type is invalid.');
    }
    if (targets.has(target)) throw publicError(409, 'Session mutation targets must be unique.');
    targets.add(target);
    return result;
  });
  return { ...base, mutations };
}

function validateQuery(query, { dated = false, remove = false } = {}) {
  const allowed = new Set(['organisationId', 'academicYearId', 'timetableId', 'includeRooms']);
  if (dated) allowed.add('weekStartDate');
  if (remove) allowed.add('expectedRevision');
  if (!onlyKeys(query, allowed)) throw publicError(400, 'Unexpected query parameters are not allowed.');
  const scope = validateScope(query);
  if (query.includeRooms !== undefined && query.includeRooms !== 'true') throw publicError(400,'includeRooms must be true.');
  if (query.includeRooms === 'true') scope.includeRooms = true;
  if (dated && !isMonday(query.weekStartDate)) throw publicError(400, 'weekStartDate must be a Monday in YYYY-MM-DD format.');
  if (remove) {
    if (!/^(?:0|[1-9]\d*)$/.test(query.expectedRevision || '')) throw publicError(400, 'expectedRevision must be a nonnegative safe integer.');
    const revision = Number(query.expectedRevision);
    if (!Number.isSafeInteger(revision)) throw publicError(400, 'expectedRevision must be a nonnegative safe integer.');
    return { ...scope, weekStartDate: query.weekStartDate, expectedRevision: revision };
  }
  return { ...scope, ...(dated ? { weekStartDate: query.weekStartDate } : {}) };
}

function mapSession(session, { inherited = false } = {}) {
  const allowed = inherited
    ? new Set(['day', 'periodId', 'classId', 'title', 'notes'])
    : new Set(['id', 'day', 'periodId', 'classId', 'title', 'notes']);
  if (!onlyKeys(session, allowed)
      || (!inherited && !isUuid(session.id))
      || !Number.isInteger(session.day) || session.day < 0 || session.day > 4
      || !isUuid(session.periodId) || !isUuid(session.classId)
      || typeof session.title !== 'string' || typeof session.notes !== 'string'
      || (inherited && (session.id != null || session.title !== '' || session.notes !== ''))) {
    throw new TypeError('Invalid authoritative timetable session.');
  }
  return {
    ...(!inherited ? { id: session.id } : {}),
    day: session.day,
    periodId: session.periodId,
    classId: session.classId,
    title: session.title,
    notes: session.notes,
  };
}

function oneRow(data) {
  return Array.isArray(data) && data.length === 1 ? data[0] : null;
}

function mapRecurring(row) {
  const revision = Number(row?.revision);
  if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(row?.weeks)) throw new TypeError('Invalid recurring timetable response.');
  const weeks = row.weeks.map((week) => {
    if (!onlyKeys(week, new Set(['weekId', 'code', 'collectionId', 'sessions']))
        || !isUuid(week.weekId) || !['A', 'B'].includes(week.code)
        || (week.collectionId != null && !isUuid(week.collectionId)) || !Array.isArray(week.sessions)) {
      throw new TypeError('Invalid authoritative recurring week.');
    }
    return {
      weekId: week.weekId,
      code: week.code,
      collectionId: week.collectionId ?? null,
      sessions: week.sessions.map((session) => mapSession(session)),
    };
  });
  return { revision, weeks };
}

function mapDated(row) {
  const revision = Number(row?.revision);
  const source = row?.source;
  const overrideExists = row?.override_exists ?? row?.overrideExists;
  const collectionId = row?.collection_id ?? row?.collectionId ?? null;
  const weekStartDate = row?.week_start_date ?? row?.weekStartDate;
  const repeatingWeekId = row?.repeating_week_id ?? row?.repeatingWeekId;
  if (!Number.isSafeInteger(revision) || revision < 0 || !isMonday(weekStartDate)
      || !isUuid(repeatingWeekId) || !['recurring', 'override'].includes(source)
      || typeof overrideExists !== 'boolean' || (collectionId != null && !isUuid(collectionId))
      || !Array.isArray(row?.sessions) || (overrideExists !== (source === 'override'))
      || (!overrideExists && collectionId != null)) throw new TypeError('Invalid dated timetable response.');
  return {
    revision,
    weekStartDate,
    repeatingWeekId,
    source,
    overrideExists,
    collectionId,
    sessions: row.sessions.map((session) => mapSession(session, { inherited: !overrideExists })),
  };
}

function mapSavedCollection(row, type) {
  const revision = Number(row?.revision);
  const collectionId = row?.collection_id ?? row?.collectionId;
  if (!Number.isSafeInteger(revision) || revision < 0 || !isUuid(collectionId) || !Array.isArray(row?.sessions)) {
    throw new TypeError('Invalid saved timetable session collection.');
  }
  const result = { revision, collectionId, sessions: row.sessions.map((session) => mapSession(session)) };
  if (type === 'date_override') {
    const repeatingWeekId = row?.repeating_week_id ?? row?.repeatingWeekId;
    if (!isUuid(repeatingWeekId)) throw new TypeError('Invalid saved dated timetable collection.');
    result.repeatingWeekId = repeatingWeekId;
  }
  return result;
}

function mapBatch(row) {
  const revision = Number(row?.revision);
  if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(row?.collections)) throw new TypeError('Invalid timetable session batch response.');
  return {
    revision,
    collections: row.collections.map((collection) => {
      if (!onlyKeys(collection, new Set(['type', 'collectionId', 'weekId', 'weekStartDate', 'sessions']))
          || !['recurring', 'date_override'].includes(collection.type)
          || !isUuid(collection.collectionId) || !isUuid(collection.weekId)
          || !Array.isArray(collection.sessions)) throw new TypeError('Invalid authoritative batch collection.');
      if (collection.type === 'date_override' && !isMonday(collection.weekStartDate)) throw new TypeError('Invalid authoritative dated batch collection.');
      return {
        type: collection.type,
        collectionId: collection.collectionId,
        weekId: collection.weekId,
        ...(collection.type === 'date_override' ? { weekStartDate: collection.weekStartDate } : {}),
        sessions: collection.sessions.map((session) => mapSession(session)),
      };
    }),
  };
}

function mappedError(error, operation) {
  if (error?.code === '40001') return publicError(409, 'Timetable sessions changed since they were loaded. Reload and try again.');
  if (error?.code === '23514' && error.message === 'TIMETABLE_CLASS_FREQUENCY_EXCEEDED') return publicError(409, 'A class exceeds its allowed recurring frequency.');
  if (error?.code === '23514' && /Archived rooms/.test(error.message || '')) return publicError(422,'This room is archived. Choose an active room or explicitly select No room.');
  if (error?.code === '23505') return publicError(409, 'Timetable session data conflicts with an existing slot.');
  if (error?.code === '22023') return publicError(400, 'Timetable session data is invalid.');
  if (error?.code === '42501') return publicError(403, 'You do not have permission to access these timetable sessions.');
  if (error?.code === 'P0002' || error?.code === '23503') return publicError(404, 'Timetable session data was not found.');
  if (Number(error?.status) >= 500 || error instanceof TypeError) return publicError(503, 'Timetable session service is temporarily unavailable.');
  return publicError(500, `Could not ${operation} timetable sessions.`);
}

async function rpc(client, name, input, operation) {
  const { data, error } = await client.rpc(name, input);
  if (error) throw mappedError(error, operation);
  const row = oneRow(data);
  if (!row) throw publicError(404, 'Timetable session data was not found.');
  return row;
}

export function registerTimetableSessionRoutes({
  app,
  requireAuth = requireSupabaseAuth,
  createRequestClient = (auth) => createRequestSupabaseClient(auth),
} = {}) {
  const route = (method, path, handler) => app[method](path, requireAuth, async (req, res, next) => {
    try { await handler(req, res); } catch (error) { next(error?.expose === true ? error : mappedError(error, method === 'get' ? 'load' : 'save')); }
  });

  route('get', '/api/timetable/sessions/recurring', async (req, res) => {
    const input = validateQuery(req.query);
    const row = await rpc(createRequestClient(req.auth), 'plannix_get_recurring_timetable_sessions', {
      target_organisation_id: input.organisationId,
      target_academic_year_id: input.academicYearId,
      target_timetable_id: input.timetableId,
    }, 'load');
    res.json(input.includeRooms ? await attachRoomAssignments(createRequestClient(req.auth), input, mapRecurring(row)) : mapRecurring(row));
  });

  route('put', '/api/timetable/sessions/recurring', async (req, res) => {
    const input = validateRecurringBody(req.body);
    const row = await rpc(createRequestClient(req.auth), 'plannix_save_recurring_timetable_sessions', {
      target_organisation_id: input.organisationId,
      target_academic_year_id: input.academicYearId,
      target_timetable_id: input.timetableId,
      target_week_id: input.weekId,
      expected_revision: input.expectedRevision,
      target_sessions: input.sessions,
    }, 'save');
    res.json(input.includeRooms ? await attachRoomAssignments(createRequestClient(req.auth), input, mapSavedCollection(row, 'recurring')) : mapSavedCollection(row, 'recurring'));
  });

  route('get', '/api/timetable/sessions/date', async (req, res) => {
    const input = validateQuery(req.query, { dated: true });
    const row = await rpc(createRequestClient(req.auth), 'plannix_get_dated_timetable_sessions', {
      target_organisation_id: input.organisationId,
      target_academic_year_id: input.academicYearId,
      target_timetable_id: input.timetableId,
      target_week_start_date: input.weekStartDate,
    }, 'load');
    res.json(input.includeRooms ? await attachRoomAssignments(createRequestClient(req.auth), input, mapDated(row)) : mapDated(row));
  });

  route('put', '/api/timetable/sessions/date', async (req, res) => {
    const input = validateDatedBody(req.body);
    const row = await rpc(createRequestClient(req.auth), 'plannix_save_dated_timetable_sessions', {
      target_organisation_id: input.organisationId,
      target_academic_year_id: input.academicYearId,
      target_timetable_id: input.timetableId,
      target_week_start_date: input.weekStartDate,
      expected_revision: input.expectedRevision,
      target_sessions: input.sessions,
    }, 'save');
    res.json(input.includeRooms ? await attachRoomAssignments(createRequestClient(req.auth), input, mapSavedCollection(row, 'date_override')) : mapSavedCollection(row, 'date_override'));
  });

  route('delete', '/api/timetable/sessions/date', async (req, res) => {
    const input = validateQuery(req.query, { dated: true, remove: true });
    const row = await rpc(createRequestClient(req.auth), 'plannix_remove_dated_timetable_override', {
      target_organisation_id: input.organisationId,
      target_academic_year_id: input.academicYearId,
      target_timetable_id: input.timetableId,
      target_week_start_date: input.weekStartDate,
      expected_revision: input.expectedRevision,
    }, 'remove');
    res.json(input.includeRooms ? await attachRoomAssignments(createRequestClient(req.auth), input, mapDated(row)) : mapDated(row));
  });

  route('put', '/api/timetable/sessions/batch', async (req, res) => {
    const input = validateBatchBody(req.body);
    const row = await rpc(createRequestClient(req.auth), 'plannix_apply_timetable_session_batch', {
      target_organisation_id: input.organisationId,
      target_academic_year_id: input.academicYearId,
      target_timetable_id: input.timetableId,
      expected_revision: input.expectedRevision,
      target_mutations: input.mutations,
    }, 'save');
    res.json(input.includeRooms ? await attachRoomAssignments(createRequestClient(req.auth), input, mapBatch(row)) : mapBatch(row));
  });
}

// A failed/incomplete room read never becomes an empty mapping. Revision fencing
// detects writes between the session snapshot and assignment read.
export async function attachRoomAssignments(client, scope, payload) {
  const args={target_organisation_id:scope.organisationId,target_academic_year_id:scope.academicYearId,target_timetable_id:scope.timetableId};
  const assignments={data:[]};let total=null;
  for(let offset=0;;){
    const page=await client.rpc('plannix_get_timetable_room_assignments',args,{count:'exact'}).range(offset,offset+199);
    if(page.error||!Array.isArray(page.data))throw publicError(503,'Could not confirm room assignments. Reload the timetable before editing.');
    if(!Number.isSafeInteger(page.count)||page.count<0||(total!==null&&total!==page.count))throw publicError(503,'Room assignment completeness could not be confirmed. Reload the timetable.');
    total=page.count;assignments.data.push(...page.data);offset+=page.data.length;
    if(offset===total)break;
    if(!page.data.length||offset>total)throw publicError(503,'Room assignment data is incomplete. Reload the timetable.');
  }
  const byId=new Map(), bySlot=new Map();
  for(const a of assignments.data){
    if(!isUuid(a.session_id)||!isUuid(a.collection_id)||!isUuid(a.timetable_week_id)||!isUuid(a.period_id)||!Number.isInteger(a.day)||a.day<0||a.day>4||!['recurring','date_override'].includes(a.collection_type)||!Object.hasOwn(a,'room_id')||(a.room_id!==null&&!isUuid(a.room_id))) throw publicError(503,'Room assignment data is incomplete. Reload the timetable.');
    const key=`${a.collection_id}:${a.day}:${a.period_id}`;
    if(byId.has(a.session_id)||bySlot.has(key)) throw publicError(503,'Room assignment data is inconsistent. Reload the timetable.');
    byId.set(a.session_id,a);bySlot.set(key,a);
  }
  const fill=(sessions,collectionId,weekId,inherited=false)=>sessions.map(session=>{
    const a=inherited ? assignments.data.find(row=>row.collection_type==='recurring'&&row.timetable_week_id===weekId&&row.day===session.day&&row.period_id===session.periodId) : byId.get(session.id);
    if(!a||a.day!==session.day||a.period_id!==session.periodId||(!inherited&&a.collection_id!==collectionId)) throw publicError(503,'An existing room assignment could not be confirmed. Reload the timetable.');
    return {...session,roomId:a.room_id};
  });
  let result;
  if(payload.weeks)result={...payload,weeks:payload.weeks.map(w=>({...w,sessions:fill(w.sessions,w.collectionId,w.weekId)}))};
  else if(payload.collections)result={...payload,collections:payload.collections.map(c=>({...c,sessions:fill(c.sessions,c.collectionId,c.weekId)}))};
  else result={...payload,sessions:fill(payload.sessions,payload.collectionId,payload.repeatingWeekId,payload.source==='recurring')};
  const latest=await client.rpc('plannix_get_recurring_timetable_sessions',args);
  const current=oneRow(latest.data);
  if(latest.error||!current||Number(current.revision)!==payload.revision) throw publicError(503,'Timetable changed while room assignments were loading. Reload before editing.');
  return {...result,roomAssignmentsLoaded:true};
}
