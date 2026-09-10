export function logRouteError(label, error) {
  // eslint-disable-next-line no-console
  console.error(`[server] ${label}`, error);
}

export function sendError(res, error, fallbackMessage, statusCode = 500) {
  logRouteError(`${res.req?.method || 'REQUEST'} ${res.req?.originalUrl || res.req?.url || ''}`, error);
  const message =
    error?.expose === true
      ? error.message
      : fallbackMessage || 'Something went wrong.';
  return res.status(error?.statusCode || statusCode).json({ message });
}

export function errorHandler(error, req, res, next) {
  logRouteError(`${req.method} ${req.originalUrl}`, error);
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(error?.statusCode || 500).json({
    message: error?.expose ? error.message : 'Unexpected server error. Check server logs for details.',
  });
}
