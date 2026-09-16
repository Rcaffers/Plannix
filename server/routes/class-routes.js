import { requireSupabaseAuth } from '../middleware/requireSupabaseAuth.js';
import { createRequestSupabaseClient } from '../supabase/client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CLASSES = 60;
const MAX_NAME_LENGTH = 200;

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

function validateQuery(query) {
  if (!hasOnlyKeys(query, new Set(['organisationId', 'academicYearId']))) {
    throw publicError(400, 'Unexpected query parameters are not allowed.');
  }
  if (!validUuid(query.organisationId)) {
    throw publicError(400, 'organisationId must be a valid UUID.');
  }
  if (!validUuid(query.academicYearId)) {
    throw publicError(400, 'academicYearId must be a valid UUID.');
  }
}

export function validateClassBody(body) {
  if (!hasOnlyKeys(body, new Set([
    'organisationId',
    'academicYearId',
    'expectedRevision',
    'entries',
  ]))) {
    throw publicError(400, 'Request body contains unexpected fields.');
  }
  if (!validUuid(body.organisationId)) {
    throw publicError(400, 'organisationId must be a valid UUID.');
  }
  if (!validUuid(body.academicYearId)) {
    throw publicError(400, 'academicYearId must be a valid UUID.');
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw publicError(400, 'expectedRevision must be a nonnegative safe integer.');
  }
  if (!Array.isArray(body.entries)) {
    throw publicError(400, 'entries must be an array.');
  }
  if (body.entries.length > MAX_CLASSES) {
    throw publicError(400, 'No more than 60 classes are allowed.');
  }

  const ids = new Set();
  const names = new Set();
  const entries = body.entries.map((entry) => {
    if (!hasOnlyKeys(entry, new Set(['id', 'name', 'frequency']))) {
      throw publicError(400, 'A class contains unexpected fields.');
    }
    if (entry.id != null && !validUuid(entry.id)) {
      throw publicError(400, 'Class IDs must be valid UUIDs when supplied.');
    }
    if (entry.id && ids.has(entry.id)) {
      throw publicError(400, 'Class IDs must be unique.');
    }
    if (typeof entry.name !== 'string') {
      throw publicError(400, 'Every class must have a name.');
    }
    const name = entry.name.trim();
    if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
      throw publicError(400, 'Class names must contain between 1 and 200 characters.');
    }
    if (names.has(name)) {
      throw publicError(400, 'Class names must be unique.');
    }
    if (!Number.isInteger(entry.frequency) || entry.frequency < 1 || entry.frequency > 50) {
      throw publicError(400, 'Class frequency must be an integer from 1 to 50.');
    }
    if (entry.id) ids.add(entry.id);
    names.add(name);
    return {
      ...(entry.id ? { id: entry.id } : {}),
      name,
      frequency: entry.frequency,
    };
  });

  return {
    organisationId: body.organisationId,
    academicYearId: body.academicYearId,
    expectedRevision: body.expectedRevision,
    entries,
  };
}

function mapEntry(row) {
  return {
    id: row.id,
    name: row.name,
    frequency: row.frequency,
  };
}

function validAuthoritativeEntry(row) {
  return validUuid(row?.id)
    && typeof row?.name === 'string'
    && Number.isInteger(row?.frequency);
}

function dataError(message, statusCode = 500) {
  return publicError(statusCode, message);
}

function mapRpcError(error) {
  if (error?.code === '40001') {
    return dataError('Classes changed since they were loaded. Reload and try again.', 409);
  }
  if (error?.code === '23503') {
    return dataError('A class with timetable placements cannot be removed.', 409);
  }
  if (error?.code === '42501') {
    return dataError('You do not have permission to save classes.', 403);
  }
  if (error?.code === 'P0002') {
    return dataError('Academic year was not found.', 404);
  }
  if (Number(error?.status) >= 500 || error instanceof TypeError) {
    return dataError('Class data is temporarily unavailable.', 503);
  }
  return dataError('Could not save classes.');
}

export function registerClassRoutes({
  app,
  requireAuth = requireSupabaseAuth,
  createRequestClient = (auth) => createRequestSupabaseClient(auth),
} = {}) {
  app.get('/api/classes', requireAuth, async (req, res, next) => {
    try {
      validateQuery(req.query);
      const client = createRequestClient(req.auth);
      const { data, error } = await client
        .from('plannix_academic_years')
        .select(`
          id,
          classes_revision,
          classes:plannix_classes!fk_plannix_classes_academic_year(
            id,
            name,
            frequency,
            sort_order
          )
        `)
        .eq('organisation_id', req.query.organisationId)
        .eq('id', req.query.academicYearId)
        .order('sort_order', { referencedTable: 'classes', ascending: true })
        .order('id', { referencedTable: 'classes', ascending: true })
        .maybeSingle();

      if (error) {
        const status = Number(error.status) >= 500 ? 503 : 500;
        throw dataError(status === 503
          ? 'Class data is temporarily unavailable.'
          : 'Could not load classes.', status);
      }
      if (!data) throw dataError('Academic year was not found.', 404);
      const entries = Array.isArray(data.classes) ? data.classes : [];
      const revision = Number(data.classes_revision);
      if (!Number.isSafeInteger(revision) || revision < 0
          || !entries.every(validAuthoritativeEntry)) {
        throw dataError('Could not load classes.');
      }
      res.json({
        revision,
        entries: entries.map(mapEntry),
      });
    } catch (error) {
      next(error?.expose === true
        ? error
        : error instanceof TypeError
          ? dataError('Class data is temporarily unavailable.', 503)
          : dataError('Could not load classes.'));
    }
  });

  app.put('/api/classes', requireAuth, async (req, res, next) => {
    try {
      const input = validateClassBody(req.body);
      const client = createRequestClient(req.auth);
      const { data, error } = await client.rpc('plannix_save_classes', {
        target_organisation_id: input.organisationId,
        target_academic_year_id: input.academicYearId,
        expected_revision: input.expectedRevision,
        target_classes: input.entries,
      });
      if (error) throw mapRpcError(error);

      const result = Array.isArray(data) && data.length === 1 ? data[0] : null;
      if (!Number.isSafeInteger(result?.revision)
          || result.revision < 0
          || !Array.isArray(result?.classes)
          || !result.classes.every(validAuthoritativeEntry)) {
        throw dataError('Could not save classes.');
      }
      res.json({
        revision: result.revision,
        entries: result.classes.map(mapEntry),
      });
    } catch (error) {
      next(error?.expose === true ? error : mapRpcError(error));
    }
  });
}
