const SAFE_POSTGRES_ERRORS = new Map([
  ['23505', { status: 409, message: 'A record with those details already exists.' }],
  ['23503', { status: 409, message: 'The requested change conflicts with related data.' }],
  ['23502', { status: 400, message: 'A required value is missing.' }],
  ['23514', { status: 400, message: 'One or more values are invalid.' }],
  ['22P02', { status: 400, message: 'One or more values are invalid.' }],
]);

const SAFE_POSTGRES_CONSTRAINTS = new Set([
  'plannix_users_email_key',
  'uq_plannix_organisation_users',
  'uq_plannix_organisation_user_access_roles',
]);

const DEFAULT_INTERNAL_MESSAGE =
  'Unexpected server error. Check server logs for details.';

function safeStatus(value, fallback = 500) {
  return Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : fallback;
}

function safePath(req) {
  const path = String(req?.path || req?.originalUrl || req?.url || '/')
    .split('?')[0];
  return path.slice(0, 2048);
}

function safeEvent(value) {
  const normalized = String(value || 'server_error')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return normalized || 'server_error';
}

export function classifyError(error, fallbackMessage, fallbackStatus = 500) {
  if (error?.type === 'entity.parse.failed') {
    return {
      status: 400,
      message: 'Request body contains invalid JSON.',
      category: 'invalid_json',
    };
  }

  if (error?.type === 'entity.too.large') {
    return {
      status: 413,
      message: 'Request body is too large.',
      category: 'payload_too_large',
    };
  }

  const postgresCode =
    typeof error?.code === 'string' && SAFE_POSTGRES_ERRORS.has(error.code)
      ? error.code
      : null;
  if (postgresCode) {
    return {
      ...SAFE_POSTGRES_ERRORS.get(postgresCode),
      category: 'postgres',
      postgresCode,
      constraint: SAFE_POSTGRES_CONSTRAINTS.has(error?.constraint)
        ? error.constraint
        : undefined,
    };
  }

  if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return {
      status: 500,
      message: DEFAULT_INTERNAL_MESSAGE,
      category: 'postgres_unknown',
    };
  }

  if (error?.expose === true) {
    return {
      status: safeStatus(error.statusCode, safeStatus(fallbackStatus)),
      message: String(error.message || fallbackMessage || 'Something went wrong.'),
      category: 'exposed_error',
    };
  }

  return {
    status: safeStatus(fallbackStatus),
    message: fallbackMessage || DEFAULT_INTERNAL_MESSAGE,
    category: 'internal_error',
  };
}

export function logRouteError(label, error, req, classification) {
  const result = classification || classifyError(error);
  const record = {
    timestamp: new Date().toISOString(),
    level: 'error',
    event: req ? 'request_failed' : safeEvent(label),
    requestId: req?.id || null,
    method: req?.method || null,
    path: req ? safePath(req) : null,
    status: result.status,
    errorType: result.category,
  };

  if (result.postgresCode) record.postgresCode = result.postgresCode;
  if (result.constraint) record.constraint = result.constraint;

  // eslint-disable-next-line no-console
  console.error(JSON.stringify(record));
}

export function sendPublicError(res, message, statusCode) {
  return res.status(statusCode).json({ message });
}

export function sendError(res, error, fallbackMessage, statusCode = 500) {
  const req = res.req;
  const classification = classifyError(error, fallbackMessage, statusCode);
  logRouteError('request_failed', error, req, classification);
  return sendPublicError(res, classification.message, classification.status);
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  const classification = classifyError(error);
  logRouteError('request_failed', error, req, classification);
  sendPublicError(res, classification.message, classification.status);
}
