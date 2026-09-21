import express from 'express';

const REPORT_CONTENT_TYPES = ['application/csp-report', 'application/reports+json'];
const EFFECTIVE_DIRECTIVES = new Set([
  'base-uri',
  'connect-src',
  'default-src',
  'font-src',
  'form-action',
  'frame-ancestors',
  'frame-src',
  'img-src',
  'manifest-src',
  'object-src',
  'script-src',
  'script-src-attr',
  'script-src-elem',
  'style-src',
  'style-src-attr',
  'style-src-elem',
  'worker-src',
]);
const DISPOSITIONS = new Set(['enforce', 'report']);
const WINDOW_MS = 60_000;
const REQUEST_LIMIT = 30;
const MAX_RATE_LIMIT_ENTRIES = 1_000;
const MAX_REPORTS_PER_BATCH = 20;

function publicError(statusCode, message) {
  return Object.assign(new Error(message), { expose: true, statusCode });
}

function cleanupExpiredEntries(entries, now) {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

export function createCspReportRateLimiter({
  limit = REQUEST_LIMIT,
  maxEntries = MAX_RATE_LIMIT_ENTRIES,
  now = () => Date.now(),
  windowMs = WINDOW_MS,
} = {}) {
  const entries = new Map();

  function middleware(req, res, next) {
    const timestamp = now();
    cleanupExpiredEntries(entries, timestamp);
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    let entry = entries.get(key);
    if (!entry) {
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entry = { count: 0, expiresAt: timestamp + windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.expiresAt - timestamp) / 1000))));
      res.status(429).json({ message: 'Too many CSP reports.' });
      return;
    }
    next();
  }

  return Object.freeze({ middleware, size: () => entries.size });
}

function reportContentType(req, res, next) {
  if (!REPORT_CONTENT_TYPES.some((type) => req.is(type))) {
    res.status(415).json({ message: 'Unsupported CSP report content type.' });
    return;
  }
  next();
}

function reportBodies(body, contentType) {
  if (contentType === 'application/csp-report') {
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || !body['csp-report'] || typeof body['csp-report'] !== 'object'
        || Array.isArray(body['csp-report'])) return null;
    return [body['csp-report']];
  }
  if (!Array.isArray(body) || body.length < 1 || body.length > MAX_REPORTS_PER_BATCH) return null;
  const reports = [];
  for (const entry of body) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || entry.type !== 'csp-violation'
        || !entry.body || typeof entry.body !== 'object' || Array.isArray(entry.body)) return null;
    reports.push(entry.body);
  }
  return reports;
}

function effectiveDirective(report) {
  const value = String(report.effectiveDirective ?? report['effective-directive'] ?? '').trim();
  return EFFECTIVE_DIRECTIVES.has(value) ? value : 'unknown';
}

function disposition(report) {
  const value = String(report.disposition ?? '').trim();
  return DISPOSITIONS.has(value) ? value : 'unknown';
}

function statusCode(report) {
  const value = Number(report.statusCode ?? report['status-code']);
  return Number.isInteger(value) && value >= 0 && value <= 599 ? value : null;
}

export function classifyBlockedResource(value, applicationOrigin = '') {
  const candidate = String(value || '').trim();
  if (candidate === 'inline') return 'inline';
  if (candidate === 'eval') return 'eval';
  if (candidate === 'self') return 'self';
  if (candidate.startsWith('data:')) return 'data';
  if (candidate.startsWith('blob:')) return 'blob';
  try {
    const origin = new URL(candidate).origin;
    if (applicationOrigin && origin === applicationOrigin) return 'self';
    return 'cross-origin';
  } catch {
    return 'unknown';
  }
}

function sanitizedLog(report, req, applicationOrigin, timestamp) {
  return {
    timestamp: new Date(timestamp()).toISOString(),
    level: 'warn',
    event: 'csp_violation',
    requestId: req.id,
    effectiveDirective: effectiveDirective(report),
    disposition: disposition(report),
    statusCode: statusCode(report),
    blockedResourceCategory: classifyBlockedResource(
      report.blockedURL ?? report['blocked-uri'],
      applicationOrigin,
    ),
  };
}

export function registerCspReportRoutes({
  app,
  applicationOrigin = '',
  limiter = createCspReportRateLimiter(),
  log = (entry) => console.warn(entry),
  timestamp = () => Date.now(),
} = {}) {
  const parser = express.json({
    limit: '16kb',
    strict: true,
    type: REPORT_CONTENT_TYPES,
  });

  app.post('/api/csp-report', limiter.middleware, reportContentType, parser, (req, res, next) => {
    const contentType = req.is('application/csp-report')
      ? 'application/csp-report'
      : 'application/reports+json';
    const reports = reportBodies(req.body, contentType);
    if (!reports || reports.some((report) => effectiveDirective(report) === 'unknown')) {
      next(publicError(400, 'CSP report is invalid.'));
      return;
    }
    for (const report of reports) {
      log(JSON.stringify(sanitizedLog(report, req, applicationOrigin, timestamp)));
    }
    res.status(204).end();
  });
}
