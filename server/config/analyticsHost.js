import { readFileSync } from 'node:fs';
import helmet from 'helmet';

const html = readFileSync(new URL('../analytics/analytics-frame.html', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../analytics/analytics-frame.js', import.meta.url), 'utf8');
const reservedHost = 'analytics.plannix.co.uk';

function frameAssetPath(rawUrl) {
  let decoded = rawUrl;
  try {
    for (let pass = 0; pass < 3; pass += 1) decoded = decodeURIComponent(decoded);
  } catch { return true; }
  return /(?:^|\/)analytics-frame(?:\.html|\.js)(?:[?#]|$)/i.test(decoded);
}

export function analyticsHostBoundary({ analyticsFrameOrigin, applicationOrigin, measurementId, frameCsp }) {
  const configuredHost = analyticsFrameOrigin ? new URL(analyticsFrameOrigin).host.toLowerCase() : null;
  const configuredHostname = analyticsFrameOrigin ? new URL(analyticsFrameOrigin).hostname.toLowerCase() : null;
  if (analyticsFrameOrigin && analyticsFrameOrigin === applicationOrigin) {
    throw new Error('The analytics frame must use a separate origin.');
  }
  const enabled = Boolean(configuredHost && frameCsp && measurementId && applicationOrigin);
  const frameHeaders = helmet({ contentSecurityPolicy: frameCsp || false, frameguard: false,
    crossOriginResourcePolicy: { policy: 'same-origin' } });
  const renderedHtml = enabled ? html.replace('%APP_ORIGIN%', applicationOrigin)
    .replace('%MEASUREMENT_ID%', measurementId) : null;

  return (req, res, next) => {
    // Use the transport Host, never X-Forwarded-Host or req.hostname.
    const host = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : '';
    const hostCount = req.rawHeaders.filter((_, index, headers) => index % 2 === 0
      && headers[index].toLowerCase() === 'host').length;
    const analyticsHost = host.includes(reservedHost)
      || (configuredHostname && host.includes(configuredHostname));
    if (!analyticsHost) {
      // Old dist builds may still contain these assets; never expose them from the app origin.
      if (frameAssetPath(req.url)) return res.status(404).end();
      return next();
    }
    if (hostCount !== 1 || host !== configuredHost) return res.status(404).end();
    return frameHeaders(req, res, () => {
      res.setHeader('Cache-Control', 'no-store');
      if (!enabled || (req.method !== 'GET' && req.method !== 'HEAD')) return res.status(404).end();
      if (req.url === '/analytics-frame.html') return res.type('html').send(renderedHtml);
      if (req.url === '/analytics-frame.js') return res.type('application/javascript').send(bootstrap);
      return res.status(404).end();
    });
  };
}
