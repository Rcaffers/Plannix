import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createProductionCspConfig } from '../config/csp.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { requestId } from '../middleware/requestId.js';
import {
  classifyBlockedResource,
  createCspReportRateLimiter,
  registerCspReportRoutes,
} from './csp-report-routes.js';

const requestIdValue = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';

function legacyReport(overrides = {}) {
  return {
    'csp-report': {
      'effective-directive': 'script-src',
      disposition: 'report',
      'status-code': 200,
      'blocked-uri': 'inline',
      ...overrides,
    },
  };
}

function modernReport(overrides = {}) {
  return {
    type: 'csp-violation',
    body: {
      effectiveDirective: 'script-src',
      disposition: 'report',
      statusCode: 200,
      blockedURL: 'inline',
      ...overrides,
    },
  };
}

async function createHarness(options = {}) {
  const app = express();
  app.use(requestId);
  registerCspReportRoutes({ app, ...options });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function send(baseUrl, body, contentType = 'application/csp-report') {
  return fetch(`${baseUrl}/api/csp-report`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'X-Request-ID': requestIdValue,
    },
    body,
  });
}

function assertRequestId(response) {
  assert.equal(response.headers.get('x-request-id'), requestIdValue);
}

test('production CSP configuration is exact, enforced, and uses exact HTTPS origins', () => {
  const config = createProductionCspConfig({
    supabaseUrl: 'https://project.supabase.test/rest/v1',
    frontendOrigins: ['https://app.example.test'],
  });
  assert.deepEqual(config.contentSecurityPolicy, {
    reportOnly: false,
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'"], styleSrcElem: ["'self'"], styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'"], fontSrc: ["'none'"],
      connectSrc: ["'self'", 'https://project.supabase.test'],
      frameSrc: ["'none'"], objectSrc: ["'none'"], baseUri: ["'none'"],
      formAction: ["'self'"], frameAncestors: ["'none'"], workerSrc: ["'none'"],
      manifestSrc: ["'none'"], reportUri: ['/api/csp-report'], reportTo: ['csp-endpoint'],
    },
  });
  assert.equal(
    config.reportingEndpoints,
    'csp-endpoint="https://app.example.test/api/csp-report"',
  );
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes('unsafe-eval'), false);
  assert.equal(serialized.includes('*.supabase'), false);
  assert.equal(serialized.includes('upgrade-insecure-requests'), false);
  assert.equal(config.contentSecurityPolicy.directives.scriptSrc.includes("'unsafe-inline'"), false);
  assert.deepEqual(config.contentSecurityPolicy.directives.styleSrcAttr, ["'unsafe-inline'"]);
});

test('production CSP configuration rejects non-HTTPS and ambiguous reporting origins', () => {
  assert.throws(() => createProductionCspConfig({
    supabaseUrl: 'http://project.supabase.test',
    frontendOrigins: ['https://app.example.test'],
  }), /SUPABASE_URL/);
  assert.throws(() => createProductionCspConfig({
    supabaseUrl: 'https://project.supabase.test',
    frontendOrigins: ['http://app.example.test'],
  }), /FRONTEND_ORIGIN/);
  assert.throws(() => createProductionCspConfig({
    supabaseUrl: 'https://project.supabase.test',
    frontendOrigins: ['https://app.example.test/not-an-origin'],
  }), /FRONTEND_ORIGIN/);
  assert.throws(() => createProductionCspConfig({
    supabaseUrl: 'https://project.supabase.test',
    frontendOrigins: ['https://one.example.test', 'https://two.example.test'],
  }), /exactly one/);
});

test('legacy and modern reports are accepted and logged using only safe fields', async () => {
  const logs = [];
  const harness = await createHarness({
    applicationOrigin: 'https://app.example.test',
    log: (entry) => logs.push(entry),
    timestamp: () => Date.parse('2026-09-18T12:00:00.000Z'),
  });
  try {
    const sensitive = 'https://project.supabase.test/path?token=sensitive#fragment';
    const legacy = await send(harness.baseUrl, JSON.stringify(legacyReport({
      'blocked-uri': sensitive,
      'document-uri': 'https://app.example.test/private?email=user@example.test',
      'source-file': 'https://app.example.test/secret.js?token=sensitive',
      'script-sample': 'password=sensitive',
      'original-policy': 'secret-policy',
      'line-number': 7,
    })));
    assert.equal(legacy.status, 204);
    assertRequestId(legacy);

    const modern = await send(
      harness.baseUrl,
      JSON.stringify([modernReport({ blockedURL: 'https://app.example.test/asset.js?secret=yes' })]),
      'application/reports+json',
    );
    assert.equal(modern.status, 204);
    assertRequestId(modern);
    assert.equal(logs.length, 2);
    assert.deepEqual(JSON.parse(logs[0]), {
      timestamp: '2026-09-18T12:00:00.000Z', level: 'warn', event: 'csp_violation',
      requestId: requestIdValue, effectiveDirective: 'script-src', disposition: 'report',
      statusCode: 200, blockedResourceCategory: 'cross-origin',
    });
    assert.equal(JSON.parse(logs[1]).blockedResourceCategory, 'self');
    const output = logs.join('\n');
    for (const forbidden of [
      sensitive, 'user@example.test', 'secret.js', 'password=', 'secret-policy',
      'project.supabase.test', 'app.example.test', 'token=', 'document-uri', 'source-file',
    ]) assert.equal(output.includes(forbidden), false, forbidden);
  } finally {
    await harness.close();
  }
});

test('standards-compliant browser reports accept element-specific directives', async () => {
  const logs = [];
  const harness = await createHarness({
    applicationOrigin: 'https://app.example.test',
    log: (entry) => logs.push(JSON.parse(entry)),
  });
  try {
    const legacy = await send(harness.baseUrl, JSON.stringify({
      'csp-report': {
        'document-uri': 'https://app.example.test/',
        referrer: '',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'original-policy': "default-src 'none'; report-uri /api/csp-report",
        disposition: 'report',
        'blocked-uri': 'inline',
        'status-code': 200,
      },
    }));
    assert.equal(legacy.status, 204);
    assertRequestId(legacy);

    const modern = await send(harness.baseUrl, JSON.stringify([{
      age: 0,
      type: 'csp-violation',
      url: 'https://app.example.test/',
      user_agent: 'browser fixture',
      body: {
        documentURL: 'https://app.example.test/',
        referrer: '',
        blockedURL: 'inline',
        effectiveDirective: 'script-src-elem',
        originalPolicy: "default-src 'none'; report-to csp-endpoint",
        disposition: 'report',
        statusCode: 200,
      },
    }]), 'application/reports+json');
    assert.equal(modern.status, 204);
    assertRequestId(modern);

    assert.equal(logs.length, 2);
    for (const entry of logs) {
      assert.equal(entry.effectiveDirective, 'script-src-elem');
      assert.equal(entry.disposition, 'report');
      assert.equal(entry.statusCode, 200);
      assert.equal(entry.blockedResourceCategory, 'inline');
      assert.equal(Object.hasOwn(entry, 'documentURL'), false);
      assert.equal(Object.hasOwn(entry, 'originalPolicy'), false);
    }
  } finally {
    await harness.close();
  }
});

test('blocked resources are reduced to the seven safe categories', () => {
  const origin = 'https://app.example.test';
  assert.deepEqual([
    classifyBlockedResource('inline', origin), classifyBlockedResource('eval', origin),
    classifyBlockedResource('self', origin), classifyBlockedResource('data:text/plain,x', origin),
    classifyBlockedResource('blob:https://app.example.test/id', origin),
    classifyBlockedResource('https://other.example.test/file.js', origin),
    classifyBlockedResource('not a URL', origin),
  ], ['inline', 'eval', 'self', 'data', 'blob', 'cross-origin', 'unknown']);
});

test('modern batches accept 1 and 20 reports and reject 21', async () => {
  const harness = await createHarness({ log: () => {} });
  try {
    for (const count of [1, 20]) {
      const response = await send(
        harness.baseUrl,
        JSON.stringify(Array.from({ length: count }, () => modernReport())),
        'application/reports+json',
      );
      assert.equal(response.status, 204);
      assertRequestId(response);
    }
    const excessive = await send(
      harness.baseUrl,
      JSON.stringify(Array.from({ length: 21 }, () => modernReport())),
      'application/reports+json',
    );
    assert.equal(excessive.status, 400);
    assertRequestId(excessive);
    assert.deepEqual(await excessive.json(), { message: 'CSP report is invalid.' });
  } finally {
    await harness.close();
  }
});

function legacyBodyWithBytes(size) {
  const value = legacyReport({ padding: '' });
  const initial = JSON.stringify(value);
  const padding = size - Buffer.byteLength(initial);
  assert.ok(padding >= 0);
  value['csp-report'].padding = 'x'.repeat(padding);
  const body = JSON.stringify(value);
  assert.equal(Buffer.byteLength(body), size);
  return body;
}

test('dedicated parser accepts exactly 16kb and safely rejects larger or malformed input', async () => {
  const harness = await createHarness({ log: () => {} });
  try {
    const boundary = await send(harness.baseUrl, legacyBodyWithBytes(16 * 1024));
    assert.equal(boundary.status, 204);
    assertRequestId(boundary);

    const oversized = await send(harness.baseUrl, legacyBodyWithBytes((16 * 1024) + 1));
    assert.equal(oversized.status, 413);
    assertRequestId(oversized);
    assert.deepEqual(await oversized.json(), { message: 'Request body is too large.' });

    const malformedJson = await send(harness.baseUrl, '{"csp-report":');
    assert.equal(malformedJson.status, 400);
    assertRequestId(malformedJson);
    assert.deepEqual(await malformedJson.json(), { message: 'Request body contains invalid JSON.' });

    const malformedShape = await send(harness.baseUrl, JSON.stringify({ unexpected: {} }));
    assert.equal(malformedShape.status, 400);
    assertRequestId(malformedShape);

    const unsupported = await send(harness.baseUrl, '{}', 'application/json');
    assert.equal(unsupported.status, 415);
    assertRequestId(unsupported);
    assert.deepEqual(await unsupported.json(), { message: 'Unsupported CSP report content type.' });
  } finally {
    await harness.close();
  }
});

test('rate limiting runs before parsing and its expiring store remains bounded', async () => {
  let clock = 0;
  const limiter = createCspReportRateLimiter({ maxEntries: 2, now: () => clock });
  const harness = await createHarness({ limiter, log: () => {} });
  try {
    for (let index = 0; index < 30; index += 1) {
      const response = await send(harness.baseUrl, JSON.stringify(legacyReport()));
      assert.equal(response.status, 204);
      assertRequestId(response);
    }
    const limited = await send(harness.baseUrl, '{', 'text/plain');
    assert.equal(limited.status, 429);
    assertRequestId(limited);
    assert.equal(limited.headers.get('retry-after'), '60');
  } finally {
    await harness.close();
  }

  function invoke(ip) {
    const req = { ip };
    const res = {
      setHeader() {},
      status() { return this; },
      json() {},
    };
    limiter.middleware(req, res, () => {});
  }
  invoke('one'); invoke('two'); invoke('three');
  assert.equal(limiter.size(), 2);
  clock = 60_001;
  invoke('fresh');
  assert.equal(limiter.size(), 1);
});

test('production app registers the CSP report route exactly once', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('../app.js', import.meta.url),
    'utf8',
  ));
  assert.equal((source.match(/registerCspReportRoutes\(\{/g) || []).length, 1);
  const orderedRegistrations = [
    'app.use(requestId)',
    'app.use(helmet(',
    'app.use(cors(corsDelegate))',
    'registerCspReportRoutes({',
    "app.use(express.json({ limit: '100kb' }))",
  ].map((entry) => source.indexOf(entry));
  assert.equal(orderedRegistrations.every((index) => index >= 0), true);
  assert.deepEqual(orderedRegistrations, [...orderedRegistrations].sort((a, b) => a - b));
});
