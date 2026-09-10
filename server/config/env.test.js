import assert from 'node:assert/strict';
import test from 'node:test';
import { env, validateProductionEnv } from './env.js';

test('production validation rejects demo-user creation', () => {
  assert.throws(
    () => validateProductionEnv({ nodeEnv: 'production', enableDemoUser: true }),
    /ENABLE_DEMO_USER/,
  );
});

test('production validation allows demo-user creation to remain disabled', () => {
  assert.doesNotThrow(() =>
    validateProductionEnv({ nodeEnv: 'production', enableDemoUser: false }),
  );
});

test('legacy automatic migration configuration is absent', () => {
  assert.equal(Object.hasOwn(env, 'autoRunMigrations'), false);
});
