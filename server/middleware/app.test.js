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
