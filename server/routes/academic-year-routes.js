import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createRequestSupabaseClient } from '../supabase/client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME_LENGTH = 200;
const MAX_HOLIDAYS = 100;

function publicError(statusCode, message) {
  return Object.assign(new Error(message), { expose: true, statusCode });
}

function hasOnlyKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function validUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validName(value) {
  return typeof value === 'string'
    && value.trim().length >= 1
    && value.trim().length <= MAX_NAME_LENGTH;
}

function validateQuery(query, requiredKeys) {
  const allowed = new Set(requiredKeys);
  if (!Object.keys(query || {}).every((key) => allowed.has(key))) {
    throw publicError(400, 'Unexpected query parameters are not allowed.');
  }
  for (const key of requiredKeys) {
    if (!validUuid(query?.[key])) {
      throw publicError(400, `${key} must be a valid UUID.`);
    }
  }
}

export function validateAcademicYearBody(body) {
  if (!hasOnlyKeys(body, new Set(['organisationId', 'plan']))) {
    throw publicError(400, 'Request body contains unexpected fields.');
  }
  if (!validUuid(body.organisationId)) {
    throw publicError(400, 'organisationId must be a valid UUID.');
  }
  const plan = body.plan;
  if (!hasOnlyKeys(plan, new Set(['id', 'label', 'startDate', 'endDate', 'holidays']))) {
    throw publicError(400, 'Academic-year plan contains unexpected fields.');
  }
  if (plan.id != null && !validUuid(plan.id)) {
    throw publicError(400, 'plan.id must be a valid UUID when supplied.');
  }
  if (!validName(plan.label)) {
    throw publicError(400, 'Academic-year label must contain between 1 and 200 characters.');
  }
  if (!validDate(plan.startDate) || !validDate(plan.endDate) || plan.endDate <= plan.startDate) {
    throw publicError(400, 'Academic-year dates are invalid.');
  }
  if (!Array.isArray(plan.holidays) || plan.holidays.length > MAX_HOLIDAYS) {
    throw publicError(400, 'holidays must be an array containing no more than 100 entries.');
  }

  const holidayIds = new Set();
  const holidays = plan.holidays.map((holiday) => {
    if (!hasOnlyKeys(holiday, new Set(['id', 'label', 'startDate', 'endDate']))) {
      throw publicError(400, 'A holiday contains unexpected fields.');
    }
    if (holiday.id != null && !validUuid(holiday.id)) {
      throw publicError(400, 'Holiday IDs must be valid UUIDs when supplied.');
    }
    if (holiday.id && holidayIds.has(holiday.id)) {
      throw publicError(400, 'Holiday IDs must be unique.');
    }
    if (holiday.id) holidayIds.add(holiday.id);
    if (!validName(holiday.label)) {
      throw publicError(400, 'Holiday labels must contain between 1 and 200 characters.');
    }
    if (!validDate(holiday.startDate) || !validDate(holiday.endDate)
      || holiday.endDate < holiday.startDate
      || holiday.startDate < plan.startDate || holiday.endDate > plan.endDate) {
      throw publicError(400, 'Holiday dates must fall within the academic year.');
    }
    return {
      ...(holiday.id ? { id: holiday.id } : {}),
      name: holiday.label.trim(),
      start_date: holiday.startDate,
      end_date: holiday.endDate,
    };
  });

  return {
    organisationId: body.organisationId,
    academicYearId: plan.id || null,
    name: plan.label.trim(),
    startDate: plan.startDate,
    endDate: plan.endDate,
    holidays,
  };
}

function mapAcademicYear(row) {
  return {
    id: row.id,
    label: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

function mapHoliday(row) {
  return {
    id: row.id,
    label: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

function dataFailure(message) {
  return publicError(500, message);
}

export function registerAcademicYearRoutes({
  app,
  requireAuth = requireSupabaseAuth,
  createRequestClient = (auth) => createRequestSupabaseClient(auth),
} = {}) {
  app.get('/api/academic-years', requireAuth, async (req, res, next) => {
    try {
      validateQuery(req.query, ['organisationId']);
      const client = createRequestClient(req.auth);
      const { data, error } = await client
        .from('plannix_academic_years')
        .select('id, name, start_date, end_date')
        .eq('organisation_id', req.query.organisationId)
        .order('start_date', { ascending: false })
        .order('id', { ascending: true });
      if (error) throw dataFailure('Could not load academic years.');
      res.json({ academicYears: (data || []).map(mapAcademicYear) });
    } catch (error) {
      next(error?.expose === true ? error : dataFailure('Could not load academic years.'));
    }
  });

  app.get('/api/academic-year', requireAuth, async (req, res, next) => {
    try {
      validateQuery(req.query, ['organisationId', 'academicYearId']);
      const client = createRequestClient(req.auth);
      const { data: academicYear, error: academicYearError } = await client
        .from('plannix_academic_years')
        .select('id, name, start_date, end_date')
        .eq('organisation_id', req.query.organisationId)
        .eq('id', req.query.academicYearId)
        .maybeSingle();
      if (academicYearError) throw dataFailure('Could not load the academic year.');
      if (!academicYear) throw publicError(404, 'Academic year was not found.');

      const { data: holidays, error: holidaysError } = await client
        .from('plannix_holidays')
        .select('id, name, start_date, end_date')
        .eq('academic_year_id', academicYear.id)
        .order('start_date', { ascending: true })
        .order('id', { ascending: true });
      if (holidaysError) throw dataFailure('Could not load the academic year.');
      res.json({
        plan: {
          ...mapAcademicYear(academicYear),
          holidays: (holidays || []).map(mapHoliday),
        },
      });
    } catch (error) {
      next(error?.expose === true ? error : dataFailure('Could not load the academic year.'));
    }
  });

  app.put('/api/academic-year', requireAuth, async (req, res, next) => {
    try {
      const input = validateAcademicYearBody(req.body);
      const client = createRequestClient(req.auth);
      const { data, error } = await client.rpc('plannix_save_academic_year', {
        target_organisation_id: input.organisationId,
        target_academic_year_id: input.academicYearId,
        target_name: input.name,
        target_start_date: input.startDate,
        target_end_date: input.endDate,
        target_holidays: input.holidays,
      });
      if (error || !validUuid(data)) throw dataFailure('Could not save the academic year.');
      res.json({ ok: true, academicYearId: data });
    } catch (error) {
      next(error?.expose === true ? error : dataFailure('Could not save the academic year.'));
    }
  });
}
