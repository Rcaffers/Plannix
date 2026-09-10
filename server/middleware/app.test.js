import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const checkAdminRouteScript = `
  const { default: app } = await import('./server/app.js');
  const routePaths = app.router.stack.flatMap((layer) => layer.route ? [layer.route.path] : []);
  if (routePaths.includes('/admin/migrate')) process.exit(1);

  const notFoundLayer = app.router.stack.find((layer) => layer.handle?.name === 'notFound');
  if (!notFoundLayer) process.exit(2);

  const req = {
    path: '/admin/migrate',
    method: 'POST',
    originalUrl: '/admin/migrate',
    accepts: () => false,
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  notFoundLayer.handle(req, res, () => process.exit(3));
  if (res.statusCode !== 404) process.exit(4);
`;

function assertAdminMigrationReturnsNotFound(migrationToken) {
  const childEnv = { ...process.env };
  if (migrationToken === undefined) {
    delete childEnv.MIGRATION_TOKEN;
  } else {
    childEnv.MIGRATION_TOKEN = migrationToken;
  }
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', checkAdminRouteScript],
    { cwd: process.cwd(), env: childEnv, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

test('POST /admin/migrate returns 404 without MIGRATION_TOKEN', () => {
  assertAdminMigrationReturnsNotFound(undefined);
});

test('POST /admin/migrate returns 404 with MIGRATION_TOKEN', () => {
  assertAdminMigrationReturnsNotFound('test-placeholder-token');
});
