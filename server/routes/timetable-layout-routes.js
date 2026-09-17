import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createRequestSupabaseClient } from '../supabase/client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const KIND_ORDER = { teaching: 0, registration: 1, break: 2, lunch: 3 };

function publicError(statusCode, message) {
  return Object.assign(new Error(message), { expose: true, statusCode });
}

function objectWithOnly(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.has(key));
}

function isUuid(value) { return typeof value === 'string' && UUID.test(value); }
function toMinutes(value) { const [h, m] = value.split(':').map(Number); return h * 60 + m; }
function toTime(value) {
  if (value < 0 || value >= 1440) throw publicError(400, 'Timetable periods must remain within one day.');
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function validateQuery(query) {
  if (!objectWithOnly(query, new Set(['organisationId', 'academicYearId', 'timetableId']))) throw publicError(400, 'Unexpected query parameters are not allowed.');
  if (!isUuid(query.organisationId)) throw publicError(400, 'organisationId must be a valid UUID.');
  if (!isUuid(query.academicYearId)) throw publicError(400, 'academicYearId must be a valid UUID.');
  if (query.timetableId != null && !isUuid(query.timetableId)) throw publicError(400, 'timetableId must be a valid UUID when supplied.');
}

function validateBlock(value, { registration = false, minimum, maximum, name }) {
  const keys = registration
    ? new Set(['id', 'enabled', 'startTime', 'lengthMinutes'])
    : new Set(['id', 'startTime', 'lengthMinutes']);
  if (!objectWithOnly(value, keys)) throw publicError(400, `${name} contains unexpected fields.`);
  if (value.id != null && !isUuid(value.id)) throw publicError(400, `${name} ID must be a valid UUID.`);
  if (!TIME.test(value.startTime)) throw publicError(400, `${name} start time must use HH:MM.`);
  if (!Number.isInteger(value.lengthMinutes) || value.lengthMinutes < minimum || value.lengthMinutes > maximum) throw publicError(400, `${name} length is invalid.`);
  if (registration && typeof value.enabled !== 'boolean') throw publicError(400, 'Registration enabled must be a boolean.');
  toTime(toMinutes(value.startTime) + value.lengthMinutes);
  return { ...value };
}

function teachingPeriods(layout, blockers) {
  const rows = [];
  let cursor = toMinutes(layout.schoolStartTime);
  const enabled = blockers.filter((row) => row.enabled && row.end > row.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (let number = 1; number <= layout.periodsPerDay; number += 1) {
    let end = cursor + layout.periodLengthMinutes;
    for (let attempts = 0; attempts < 50; attempts += 1) {
      const conflict = enabled.find((row) => cursor < row.end && row.start < end);
      if (!conflict) break;
      cursor = conflict.end;
      end = cursor + layout.periodLengthMinutes;
    }
    rows.push({
      type: 'teaching', label: `Period ${number}`,
      startTime: toTime(cursor), endTime: toTime(end),
      enabled: true, visible: true, periodNumber: number,
    });
    cursor = end;
  }
  return rows;
}

export function validateTimetableLayoutBody(body) {
  if (!objectWithOnly(body, new Set(['organisationId', 'academicYearId', 'timetableId', 'expectedRevision', 'layout']))) throw publicError(400, 'Request body contains unexpected fields.');
  if (!isUuid(body.organisationId)) throw publicError(400, 'organisationId must be a valid UUID.');
  if (!isUuid(body.academicYearId)) throw publicError(400, 'academicYearId must be a valid UUID.');
  if (body.timetableId != null && !isUuid(body.timetableId)) throw publicError(400, 'timetableId must be a valid UUID when supplied.');
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw publicError(400, 'expectedRevision must be a nonnegative safe integer.');
  const layout = body.layout;
  if (!objectWithOnly(layout, new Set(['name', 'cycle', 'periodsPerDay', 'periodLengthMinutes', 'schoolStartTime', 'registration', 'breaks', 'lunch', 'showBreaksInTimetable', 'showLunchInTimetable']))) throw publicError(400, 'Timetable layout contains unexpected fields.');
  if (typeof layout.name !== 'string' || layout.name.trim().length < 1 || layout.name.trim().length > 200) throw publicError(400, 'Timetable name must contain between 1 and 200 characters.');
  if (!['one-week', 'two-week'].includes(layout.cycle)) throw publicError(400, 'Timetable cycle is invalid.');
  if (!Number.isInteger(layout.periodsPerDay) || layout.periodsPerDay < 1 || layout.periodsPerDay > 12) throw publicError(400, 'periodsPerDay must be an integer from 1 to 12.');
  if (!Number.isInteger(layout.periodLengthMinutes) || layout.periodLengthMinutes < 20 || layout.periodLengthMinutes > 120) throw publicError(400, 'periodLengthMinutes must be an integer from 20 to 120.');
  if (!TIME.test(layout.schoolStartTime)) throw publicError(400, 'schoolStartTime must use HH:MM.');
  if (typeof layout.showBreaksInTimetable !== 'boolean' || typeof layout.showLunchInTimetable !== 'boolean') throw publicError(400, 'Visibility settings must be booleans.');

  const registration = validateBlock(layout.registration, { registration: true, minimum: 5, maximum: 120, name: 'Registration' });
  if (!Array.isArray(layout.breaks) || layout.breaks.length > 6) throw publicError(400, 'breaks must contain no more than six entries.');
  const breaks = layout.breaks.map((value) => validateBlock(value, { minimum: 5, maximum: 120, name: 'A break' }));
  const lunch = validateBlock(layout.lunch, { minimum: 0, maximum: 180, name: 'Lunch' });
  const ids = [registration.id, ...breaks.map((row) => row.id), lunch.id].filter(Boolean);
  if (new Set(ids).size !== ids.length) throw publicError(400, 'Timetable period IDs must be unique.');

  const fixed = [
    { ...registration, type: 'registration', label: 'Registration', visible: registration.enabled, start: toMinutes(registration.startTime), end: toMinutes(registration.startTime) + registration.lengthMinutes },
    ...breaks.map((row, index) => ({ ...row, type: 'break', label: `Break ${index + 1}`, enabled: true, visible: layout.showBreaksInTimetable, start: toMinutes(row.startTime), end: toMinutes(row.startTime) + row.lengthMinutes })),
    { ...lunch, type: 'lunch', label: 'Lunch', enabled: lunch.lengthMinutes > 0, visible: layout.showLunchInTimetable, start: toMinutes(lunch.startTime), end: toMinutes(lunch.startTime) + lunch.lengthMinutes },
  ];
  const periods = [
    ...teachingPeriods(layout, fixed),
    ...fixed.map((row) => ({
      ...(row.id ? { id: row.id } : {}), type: row.type, label: row.label,
      startTime: row.startTime, endTime: toTime(row.end), enabled: row.enabled,
      visible: row.visible, periodNumber: null,
    })),
  ].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)
    || KIND_ORDER[a.type] - KIND_ORDER[b.type]
    || (a.periodNumber || 0) - (b.periodNumber || 0));

  return {
    organisationId: body.organisationId,
    academicYearId: body.academicYearId,
    timetableId: body.timetableId || null,
    expectedRevision: body.expectedRevision,
    publicLayout: { ...layout, name: layout.name.trim(), registration, breaks, lunch },
    rpcLayout: {
      name: layout.name.trim(), cadence: layout.cycle,
      schoolStartTime: layout.schoolStartTime,
      teachingPeriodMinutes: layout.periodLengthMinutes,
      periods,
    },
  };
}

function normalizeTime(value) { return String(value).slice(0, 5); }
function lengthMinutes(start, end) { return toMinutes(normalizeTime(end)) - toMinutes(normalizeTime(start)); }
function mapPeriod(row, index) {
  return {
    id: row.id, type: row.period_type ?? row.type,
    number: row.period_number ?? row.periodNumber ?? null,
    label: row.label, startTime: normalizeTime(row.start_time ?? row.startTime),
    endTime: normalizeTime(row.end_time ?? row.endTime),
    enabled: row.is_enabled ?? row.enabled, visible: row.is_visible ?? row.visible,
    order: row.sort_order ?? index,
  };
}

function mapLayout(row) {
  const weeks = [...(row.weeks || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id));
  const sourcePeriods = [...(row.periods || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id));
  const periods = sourcePeriods.map(mapPeriod);
  if (!isUuid(row.id) || !Number.isSafeInteger(Number(row.layout_revision))
      || !weeks.every((week) => isUuid(week?.id))
      || !periods.every((period) => isUuid(period.id) && KIND_ORDER[period.type] != null)) throw new TypeError('Invalid authoritative timetable layout.');
  const registration = periods.find((row) => row.type === 'registration');
  const lunch = periods.find((row) => row.type === 'lunch');
  const breaks = periods.filter((row) => row.type === 'break');
  return {
    timetableId: row.id, revision: Number(row.layout_revision), name: row.name,
    cycle: row.cadence, periodsPerDay: periods.filter((period) => period.type === 'teaching').length,
    periodLengthMinutes: Number(row.teaching_period_minutes), schoolStartTime: normalizeTime(row.school_start_time),
    registration: registration ? { id: registration.id, enabled: registration.enabled, startTime: registration.startTime, lengthMinutes: lengthMinutes(registration.startTime, registration.endTime) } : null,
    breaks: breaks.map((row) => ({ id: row.id, startTime: row.startTime, lengthMinutes: lengthMinutes(row.startTime, row.endTime) })),
    lunch: lunch ? { id: lunch.id, startTime: lunch.startTime, lengthMinutes: lengthMinutes(lunch.startTime, lunch.endTime) } : null,
    showBreaksInTimetable: breaks.every((row) => row.visible),
    showLunchInTimetable: lunch?.visible ?? false,
    weeks: weeks.map((week) => ({ id: week.id, code: week.code, name: week.name })),
    periods,
  };
}

function mappedError(error, operation) {
  if (error?.code === '40001') return publicError(409, 'Timetable layout changed since it was loaded. Reload and try again.');
  if (error?.code === '23503' && error.message === 'TIMETABLE_LAYOUT_WEEK_IN_USE') return publicError(409, 'Week B contains timetable sessions and cannot be removed.');
  if (error?.code === '23503' && error.message === 'TIMETABLE_LAYOUT_PERIOD_IN_USE') return publicError(409, 'A period containing timetable sessions cannot be removed.');
  if (error?.code === '23505') return publicError(409, 'A default timetable already exists for this academic year.');
  if (error?.code === '42501') return publicError(403, 'You do not have permission to save this timetable layout.');
  if (error?.code === 'P0002') return publicError(404, 'Timetable or academic year was not found.');
  if (Number(error?.status) >= 500 || error instanceof TypeError) return publicError(503, 'Timetable layout service is temporarily unavailable.');
  return publicError(500, `Could not ${operation} timetable layout.`);
}

export function registerTimetableLayoutRoutes({ app, requireAuth = requireSupabaseAuth, createRequestClient = (auth) => createRequestSupabaseClient(auth) } = {}) {
  app.get('/api/timetable/layout', requireAuth, async (req, res, next) => {
    try {
      validateQuery(req.query);
      const client = createRequestClient(req.auth);
      let query = client.from('plannix_timetables').select(`
        id, name, cadence, school_start_time, teaching_period_minutes, layout_revision,
        weeks:plannix_timetable_weeks!fk_plannix_timetable_weeks_timetable(id, code, name, sort_order),
        periods:plannix_timetable_periods!fk_plannix_timetable_periods_timetable(id, period_type, period_number, label, start_time, end_time, sort_order, is_enabled, is_visible)
      `).eq('organisation_id', req.query.organisationId).eq('academic_year_id', req.query.academicYearId);
      query = req.query.timetableId ? query.eq('id', req.query.timetableId) : query.eq('is_default', true);
      const { data, error } = await query
        .order('sort_order', { referencedTable: 'weeks', ascending: true })
        .order('id', { referencedTable: 'weeks', ascending: true })
        .order('sort_order', { referencedTable: 'periods', ascending: true })
        .order('id', { referencedTable: 'periods', ascending: true }).maybeSingle();
      if (error) throw mappedError(error, 'load');
      if (!data) {
        if (req.query.timetableId) throw publicError(404, 'Timetable was not found.');
        res.json({ layout: null });
        return;
      }
      res.json({ layout: mapLayout(data) });
    } catch (error) { next(error?.expose === true ? error : mappedError(error, 'load')); }
  });

  app.put('/api/timetable/layout', requireAuth, async (req, res, next) => {
    try {
      const input = validateTimetableLayoutBody(req.body);
      const client = createRequestClient(req.auth);
      const { data, error } = await client.rpc('plannix_save_timetable_layout', {
        target_organisation_id: input.organisationId,
        target_academic_year_id: input.academicYearId,
        target_timetable_id: input.timetableId,
        expected_revision: input.expectedRevision,
        target_layout: input.rpcLayout,
      });
      if (error) throw mappedError(error, 'save');
      const result = Array.isArray(data) && data.length === 1 ? data[0] : null;
      if (!isUuid(result?.timetable_id) || !Number.isSafeInteger(Number(result?.revision)) || !Array.isArray(result?.weeks) || !Array.isArray(result?.periods)) throw new TypeError('Invalid authoritative result.');
      res.json({ layout: mapLayout({
        id: result.timetable_id, layout_revision: Number(result.revision),
        name: input.publicLayout.name, cadence: input.publicLayout.cycle,
        school_start_time: input.publicLayout.schoolStartTime,
        teaching_period_minutes: input.publicLayout.periodLengthMinutes,
        weeks: result.weeks.map((week, index) => ({ ...week, sort_order: index })),
        periods: result.periods.map((period, index) => ({ ...period, sort_order: index })),
      }) });
    } catch (error) { next(error?.expose === true ? error : mappedError(error, 'save')); }
  });
}
