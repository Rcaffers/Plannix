import { validMeasurementId } from '../../shared/gaMeasurementId.js';
import { parseAnalyticsFrameOrigin } from '../../shared/analyticsOrigin.js';

const REPORT_PATH = '/api/csp-report';

function httpsOrigin(value, label, { requireOrigin = false } = {}) {
  const input = String(value || '').trim();
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${label} must be a valid HTTPS origin.`);
  }
  if (url.protocol !== 'https:' || url.origin === 'null'
      || url.username || url.password
      || (requireOrigin && input !== url.origin)) {
    throw new Error(`${label} must be a valid HTTPS origin.`);
  }
  return url.origin;
}

export function createProductionCspConfig(config) {
  const supabaseOrigin = httpsOrigin(config?.supabaseUrl, 'SUPABASE_URL');
  const frontendOrigins = Array.isArray(config?.frontendOrigins) ? config.frontendOrigins : [];
  if (frontendOrigins.length !== 1) {
    throw new Error('FRONTEND_ORIGIN must contain exactly one HTTPS origin for CSP reporting.');
  }
  const applicationOrigin = httpsOrigin(frontendOrigins[0], 'FRONTEND_ORIGIN', {
    requireOrigin: true,
  });
  const configuredFrameOrigin = config?.analyticsFrameOrigin;
  const analyticsFrameOrigin = configuredFrameOrigin
    ? parseAnalyticsFrameOrigin(configuredFrameOrigin, applicationOrigin) : null;
  if (configuredFrameOrigin && !analyticsFrameOrigin) {
    throw new Error('ANALYTICS_FRAME_ORIGIN must be a distinct HTTPS origin.');
  }
  const analyticsEnabled = Boolean(validMeasurementId(config?.gaMeasurementId) && analyticsFrameOrigin);

  return Object.freeze({
    applicationOrigin,
    analyticsFrameOrigin: analyticsEnabled ? analyticsFrameOrigin : null,
    reportingEndpoints: `csp-endpoint="${applicationOrigin}${REPORT_PATH}"`,
    contentSecurityPolicy: Object.freeze({
      reportOnly: false,
      useDefaults: false,
      directives: Object.freeze({
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        styleSrcElem: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'"],
        fontSrc: ["'none'"],
        connectSrc: ["'self'", supabaseOrigin],
        frameSrc: analyticsEnabled ? [analyticsFrameOrigin] : ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        reportUri: [REPORT_PATH],
        reportTo: ['csp-endpoint'],
      }),
    }),
    analyticsFrameContentSecurityPolicy: analyticsEnabled ? Object.freeze({
      useDefaults: false,
      directives: Object.freeze({
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'", 'https://www.googletagmanager.com'],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ['https://www.googletagmanager.com', 'https://*.google-analytics.com'],
        connectSrc: ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.google.com'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: [applicationOrigin],
      }),
    }) : null,
  });
}

export function reportingEndpoints(config) {
  return function setReportingEndpoints(_req, res, next) {
    res.setHeader('Reporting-Endpoints', config.reportingEndpoints);
    next();
  };
}
