import crypto from 'node:crypto';

export const REQUEST_ID_HEADER = 'X-Request-ID';

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isCanonicalRequestId(value) {
  return typeof value === 'string' &&
    value.length === 36 &&
    CANONICAL_UUID_PATTERN.test(value);
}

export function requestId(req, res, next) {
  const suppliedRequestId = req.headers?.['x-request-id'];
  req.id = isCanonicalRequestId(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
}
