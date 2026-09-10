const API_PREFIXES = ['/account', '/admin', '/api', '/auth', '/billing', '/holidays', '/stripe'];

export function notFound(req, res, next) {
  const isApiRequest = API_PREFIXES.some(
    (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
  );
  if (!isApiRequest && req.accepts('html')) {
    next();
    return;
  }
  res.status(404).json({ message: `No API route found for ${req.method} ${req.originalUrl}.` });
}
