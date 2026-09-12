import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const checkMigrationRemovalScript = `
  process.env.AUTO_RUN_MIGRATIONS = 'true';
  process.env.ENABLE_DEMO_USER = 'false';
  process.env.SUPABASE_DB_URL = '';
  process.env.SUPABASE_POOLER_URL = '';
  process.env.DATABASE_URL = '';
  const database = await import('./server/db.js');
  if ('runMigrations' in database) process.exit(1);
  const { default: app } = await import('./server/app.js');
  const { initializeApplication } = await import('./server/auth-server.js');
  if (!app || typeof initializeApplication !== 'function') process.exit(2);
  if (String(initializeApplication).toLowerCase().includes('migration')) process.exit(3);
  await initializeApplication();
`;

test('application import and startup have no automatic legacy migration path', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', checkMigrationRemovalScript],
    { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

const checkRemovedRoutesScript = `
  const { default: app } = await import('./server/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const { port } = server.address();
    const routes = [
      ['POST', '/admin/migrate'],
      ['POST', '/stripe/webhook'],
      ['GET', '/billing/subscription-summary'],
      ['POST', '/billing/portal-session'],
      ['POST', '/auth/signup/config'],
      ['POST', '/auth/signup/promotion'],
      ['POST', '/auth/signup/complete'],
    ];
    for (const [method, path] of routes) {
      const response = await fetch('http://127.0.0.1:' + port + path, { method });
      if (response.status !== 404) process.exit(1);
      const payload = await response.json();
      if (!String(payload?.message || '').includes('No API route found')) process.exit(2);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
`;

function assertRemovedRoutesReturnNotFound(migrationToken) {
  const childEnv = { ...process.env };
  if (migrationToken === undefined) {
    delete childEnv.MIGRATION_TOKEN;
  } else {
    childEnv.MIGRATION_TOKEN = migrationToken;
  }
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', checkRemovedRoutesScript],
    { cwd: process.cwd(), env: childEnv, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

test('removed routes return 404 through Express without MIGRATION_TOKEN', () => {
  assertRemovedRoutesReturnNotFound(undefined);
});

test('removed routes return 404 through Express with MIGRATION_TOKEN', () => {
  assertRemovedRoutesReturnNotFound('test-placeholder-token');
});

const checkObservabilityScript = `
  process.env.FRONTEND_ORIGIN = 'https://frontend.example.test';
  process.env.ENABLE_DEMO_USER = 'true';
  process.env.NODE_ENV = 'development';
  process.env.SUPABASE_DB_URL = '';
  process.env.SUPABASE_POOLER_URL = '';
  process.env.DATABASE_URL = '';

  const capturedErrors = [];
  const capturedLogs = [];
  console.error = (entry) => capturedErrors.push(String(entry));
  console.log = (entry) => capturedLogs.push(String(entry));

  const { default: app } = await import('./server/app.js');
  const { logStartupStatus } = await import('./server/auth-server.js');
  logStartupStatus();
  if (capturedLogs.some((entry) => /Password123|Demo login:/i.test(entry))) process.exit(1);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const validRequestId = '8e6ddc18-d0d9-4fbc-a036-b02028e9f421';
  const isUuid = (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value || '');

  try {
    const { port } = server.address();
    const baseUrl = 'http://127.0.0.1:' + port;
    const health = await fetch(baseUrl + '/health', {
      headers: {
        Origin: 'https://frontend.example.test',
        'X-Request-ID': validRequestId,
      },
    });
    if (health.status !== 200) process.exit(2);
    if (health.headers.get('x-request-id') !== validRequestId) process.exit(3);
    const exposed = health.headers.get('access-control-expose-headers') || '';
    if (!exposed.toLowerCase().split(',').map((value) => value.trim()).includes('x-request-id')) {
      process.exit(4);
    }

    const firstGenerated = await fetch(baseUrl + '/health');
    const secondGenerated = await fetch(baseUrl + '/health');
    const firstId = firstGenerated.headers.get('x-request-id');
    const secondId = secondGenerated.headers.get('x-request-id');
    if (!isUuid(firstId) || !isUuid(secondId) || firstId === secondId) process.exit(5);

    const invalidHeader = await fetch(baseUrl + '/health', {
      headers: { 'X-Request-ID': validRequestId.toUpperCase() },
    });
    const replacementId = invalidHeader.headers.get('x-request-id');
    if (!isUuid(replacementId) || replacementId === validRequestId.toUpperCase()) process.exit(6);

    const notFound = await fetch(baseUrl + '/admin/migrate', {
      method: 'POST',
      headers: { 'X-Request-ID': validRequestId },
    });
    if (notFound.status !== 404 || notFound.headers.get('x-request-id') !== validRequestId) {
      process.exit(16);
    }

    const malformedSecret = 'payload-secret-must-not-be-logged';
    const malformed = await fetch(baseUrl + '/auth/login?token=query-secret', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': validRequestId,
      },
      body: '{"password":"' + malformedSecret + '"',
    });
    if (malformed.status !== 400) process.exit(7);
    if (malformed.headers.get('x-request-id') !== validRequestId) process.exit(8);
    const malformedBody = await malformed.json();
    if (malformedBody.message !== 'Request body contains invalid JSON.') process.exit(9);

    const oversizedSecret = 'oversized-secret-must-not-be-logged';
    const oversized = await fetch(baseUrl + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: oversizedSecret.repeat(15000) }),
    });
    if (oversized.status !== 413) process.exit(10);
    if (!isUuid(oversized.headers.get('x-request-id'))) process.exit(11);
    const oversizedBody = await oversized.json();
    if (oversizedBody.message !== 'Request body is too large.') process.exit(12);

    for (const entry of capturedErrors) {
      JSON.parse(entry);
      if (entry.includes(malformedSecret) || entry.includes(oversizedSecret)) process.exit(13);
      if (entry.includes('query-secret')) process.exit(14);
    }
    if (!capturedErrors.some((entry) => JSON.parse(entry).requestId === validRequestId)) {
      process.exit(15);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
`;

test('configured application applies request IDs, CORS exposure, and safe JSON limits', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', checkObservabilityScript],
    { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
