import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

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
