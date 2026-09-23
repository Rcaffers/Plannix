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

  return Object.freeze({
    applicationOrigin,
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
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        workerSrc: ["'none'"],
        manifestSrc: ["'none'"],
        reportUri: [REPORT_PATH],
        reportTo: ['csp-endpoint'],
      }),
    }),
  });
}

export function reportingEndpoints(config) {
  return function setReportingEndpoints(_req, res, next) {
    res.setHeader('Reporting-Endpoints', config.reportingEndpoints);
    next();
  };
}
