const CANONICAL_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function safeRequestReference(error) {
  const requestId = error?.requestId;
  return typeof requestId === 'string' && CANONICAL_REQUEST_ID.test(requestId) ? requestId : '';
}
